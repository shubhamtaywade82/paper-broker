import { ulid } from 'ulid';
import type {
  AccountState,
  Instrument,
  MarketState,
  Order,
  OrderCommand,
  Position,
} from '../broker/types.js';
import { createStrategyContext, type StrategyContext, type KlineStore } from './StrategyContext.js';
import type { Candle } from './indicators.js';
import type { Signal, SignalInput } from './signal.js';
import { parseSignalInput, toSignal, signalIsExpired, signalsEqual } from './signal.js';

export interface Strategy {
  id: string;
  name: string;
  enabled: boolean;
  symbols: string[];
  intervals: string[];
  priority: number;
  cooldownMs: number;
  init?: (ctx: StrategyContext) => Promise<void> | void;
  onCandleClose?: (
    ctx: StrategyContext,
    candle: Candle
  ) => SignalInput | Promise<SignalInput | null> | null;
  onTick?: (ctx: StrategyContext, market: MarketState) => SignalInput | Promise<SignalInput | null> | null;
}

export interface StrategyEngineConfig {
  marketState: (symbol: string) => MarketState | undefined;
  klines: KlineStore;
  account: () => AccountState;
  getPosition: (symbol: string) => Position | undefined;
  getOpenOrders: (symbol?: string) => Order[];
  getInstrument: (symbol: string) => Instrument | undefined;
  submitOrder: (order: OrderCommand) => Order;
}

export interface StrategyEngineDeps {
  onSubmitSignal: (signal: Signal) => Promise<boolean>;
}

export interface StrategyEngineListeners {
  onSignal?: (signal: Signal) => void;
  onSignalRejected?: (signal: Signal, reason: string) => void;
  onSignalExpired?: (signal: Signal) => void;
}

export class StrategyEngine {
  private strategies = new Map<string, Strategy>();
  private contexts = new Map<string, StrategyContext>();
  private lastEmitted = new Map<string, number>();
  private lastSignalByKey = new Map<string, Signal>();
  private running = false;

  private config: StrategyEngineConfig;
  private deps: StrategyEngineDeps;
  private listeners: StrategyEngineListeners;

  constructor(
    config: StrategyEngineConfig,
    deps: StrategyEngineDeps,
    listeners: StrategyEngineListeners = {}
  ) {
    this.config = config;
    this.deps = deps;
    this.listeners = listeners;
  }

  register(strategy: Strategy): void {
    if (this.strategies.has(strategy.id)) {
      throw new Error(`Strategy already registered: ${strategy.id}`);
    }

    this.strategies.set(strategy.id, strategy);
    this.contexts.set(
      strategy.id,
      createStrategyContext(
        strategy.id,
        this.config.marketState,
        this.config.klines,
        this.config.account,
        this.config.getPosition,
        this.config.getOpenOrders,
        this.config.submitOrder
      )
    );
  }

  unregister(strategyId: string): void {
    this.strategies.delete(strategyId);
    this.contexts.delete(strategyId);
  }

  getStrategy(strategyId: string): Strategy | undefined {
    return this.strategies.get(strategyId);
  }

  listStrategies(): Strategy[] {
    return Array.from(this.strategies.values());
  }

  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    this.running = true;

    for (const strategy of this.strategies.values()) {
      if (!strategy.enabled) continue;

      if (strategy.init) {
        const ctx = this.contexts.get(strategy.id);
        if (ctx) await strategy.init(ctx);
      }
    }
  }

  stop(): void {
    this.running = false;
    this.lastEmitted.clear();
  }

  async onMarket(market: MarketState): Promise<void> {
    if (!this.running) return;

    const strategies = this.getStrategiesForSymbol(market.symbol);

    for (const strategy of strategies) {
      if (!strategy.onTick) continue;

      const ctx = this.contexts.get(strategy.id);
      if (!ctx) continue;

      try {
        const input = await strategy.onTick(ctx, market);
        if (input) await this.processSignal(strategy, input);
      } catch (error) {
        console.error(`[StrategyEngine] onTick error for ${strategy.id}:`, error);
      }
    }
  }

  async onCandleClose(candle: Candle): Promise<void> {
    if (!this.running) return;

    const strategies = this.getStrategiesForSymbol(candle.symbol);

    for (const strategy of strategies) {
      if (!strategy.onCandleClose || !strategy.intervals.includes(candle.interval)) continue;

      const ctx = this.contexts.get(strategy.id);
      if (!ctx) continue;

      try {
        const input = await strategy.onCandleClose(ctx, candle);
        if (input) await this.processSignal(strategy, input);
      } catch (error) {
        console.error(`[StrategyEngine] onCandleClose error for ${strategy.id}:`, error);
      }
    }
  }

  private getStrategiesForSymbol(symbol: string): Strategy[] {
    return Array.from(this.strategies.values())
      .filter((s) => s.enabled && s.symbols.includes(symbol))
      .sort((a, b) => a.priority - b.priority);
  }

  private async processSignal(strategy: Strategy, rawInput: unknown): Promise<void> {
    let input: SignalInput;

    try {
      input = parseSignalInput(rawInput);
    } catch (error) {
      const signal = toSignal(
        {
          strategyId: strategy.id,
          symbol: '',
          action: 'HOLD',
          confidence: 0,
          ttlMs: 60_000,
          features: {},
        },
        Date.now()
      );
      const reason = error instanceof Error ? error.message : 'schema validation failed';
      this.listeners.onSignalRejected?.(signal, reason);
      return;
    }

    if (input.action === 'HOLD') return;

    const now = Date.now();
    const cooldownKey = `${input.strategyId}:${input.symbol}:${input.action}`;
    const lastTs = this.lastEmitted.get(cooldownKey);

    if (lastTs !== undefined && now - lastTs < strategy.cooldownMs) {
      return;
    }

    this.lastEmitted.set(cooldownKey, now);

    const previous = this.lastSignalByKey.get(cooldownKey);
    if (previous && signalsEqual(previous, input)) {
      return;
    }

    const signal = toSignal(input, now);

    const conflictCheck = this.checkConflicts(signal);
    if (!conflictCheck.ok) {
      signal.status = 'REJECTED';
      signal.rejectReason = conflictCheck.reason;
      this.lastSignalByKey.set(cooldownKey, signal);
      this.listeners.onSignalRejected?.(signal, conflictCheck.reason ?? 'conflict check failed');
      return;
    }

    this.lastSignalByKey.set(cooldownKey, signal);
    this.listeners.onSignal?.(signal);

    const accepted = await this.deps.onSubmitSignal(signal);

    if (!accepted) {
      signal.status = 'REJECTED';
      signal.rejectReason = 'rejected by executor';
      this.listeners.onSignalRejected?.(signal, 'rejected by executor');
    }
  }

  private checkConflicts(signal: Signal): { ok: boolean; reason?: string } {
    if (signal.action === 'CANCEL_ALL') return { ok: true };

    const position = this.config.getPosition(signal.symbol);
    const currentQty = position?.qty ?? 0;

    if (signal.action === 'OPEN_LONG' && currentQty > 0) {
      return { ok: false, reason: 'duplicate: long position already open' };
    }

    if (signal.action === 'OPEN_SHORT' && currentQty < 0) {
      return { ok: false, reason: 'duplicate: short position already open' };
    }

    if (
      (signal.action === 'OPEN_LONG' && currentQty < 0) ||
      (signal.action === 'OPEN_SHORT' && currentQty > 0)
    ) {
      if (signal.confidence < 0.75) {
        return {
          ok: false,
          reason: `opposite-side open requires confidence >= 0.75, got ${signal.confidence}`,
        };
      }
    }

    if (signal.action === 'CLOSE_LONG' && currentQty <= 0) {
      return { ok: false, reason: 'no long position to close' };
    }

    if (signal.action === 'CLOSE_SHORT' && currentQty >= 0) {
      return { ok: false, reason: 'no short position to close' };
    }

    return { ok: true };
  }

  expireSignals(): number {
    let expired = 0;

    for (const [key, signal] of this.lastSignalByKey) {
      if (signal.status === 'CREATED' && signalIsExpired(signal)) {
        signal.status = 'EXPIRED';
        this.lastSignalByKey.delete(key);
        this.listeners.onSignalExpired?.(signal);
        expired++;
      }
    }

    return expired;
  }
}

export function createSignalId(): string {
  return ulid();
}