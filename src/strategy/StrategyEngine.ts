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
  /**
   * Performance feedback gate. When supplied, a strategy that returns true is
   * skipped entirely — it receives no candles and no ticks, so it cannot emit
   * further signals. Used by StrategyPerformanceTracker to quarantine a
   * strategy that has breached its drawdown or win-rate limits.
   */
  isQuarantined?: (strategyId: string) => boolean;
}

export interface StrategyEngineListeners {
  onSignal?: (signal: Signal) => void;
  onSignalRejected?: (signal: Signal, reason: string) => void;
  onSignalExpired?: (signal: Signal) => void;
}

/** Active symbol lock — one strategy owns the entry rights to a symbol. */
export interface SymbolLockState {
  symbol: string;
  /** Strategy that holds the lock. */
  strategyId: string;
  /** Epoch ms when the lock was acquired (refreshed on every accepted signal). */
  acquiredAt: number;
  /** Epoch ms after which the lock is stale and may be taken over. */
  until: number;
}

export interface StrategyEngineOptions {
  /**
   * Multi-strategy orchestration (AUTONOMY_AUDIT Finding 3): when enabled,
   * the first strategy whose OPEN signal is accepted acquires an exclusive
   * lock on that symbol for `symbolLockTtlMs`. Other strategies' OPEN signals
   * on the same symbol are rejected while the lock is held, so the
   * autonomous agent and candle-driven strategies (e.g. smc-agent) can never
   * submit conflicting entries on the same symbol. CLOSE / CANCEL_ALL
   * signals always pass — reducing risk is never blocked.
   *
   * Default: enabled (autonomous-first). Disable via SYMBOL_LOCK_ENABLED=false.
   */
  symbolLockEnabled?: boolean;
  /** How long an accepted OPEN signal owns the symbol. Default 300_000 (5 min). */
  symbolLockTtlMs?: number;
}

export class StrategyEngine {
  private strategies = new Map<string, Strategy>();
  private contexts = new Map<string, StrategyContext>();
  private lastEmitted = new Map<string, number>();
  private lastSignalByKey = new Map<string, Signal>();
  private symbolLocks = new Map<string, SymbolLockState>();
  private running = false;

  private config: StrategyEngineConfig;
  private deps: StrategyEngineDeps;
  private listeners: StrategyEngineListeners;
  private readonly symbolLockEnabled: boolean;
  private readonly symbolLockTtlMs: number;

  constructor(
    config: StrategyEngineConfig,
    deps: StrategyEngineDeps,
    listeners: StrategyEngineListeners = {},
    options: StrategyEngineOptions = {}
  ) {
    this.config = config;
    this.deps = deps;
    this.listeners = listeners;
    this.symbolLockEnabled = options.symbolLockEnabled ?? true;
    this.symbolLockTtlMs = options.symbolLockTtlMs ?? 300_000;
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
    this.symbolLocks.clear();
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
      .filter((s) => !this.deps.isQuarantined?.(s.id))
      .sort((a, b) => a.priority - b.priority);
  }

  /** Strategies currently held back by the performance gate. */
  listQuarantined(): string[] {
    return Array.from(this.strategies.values())
      .filter((s) => this.deps.isQuarantined?.(s.id) === true)
      .map((s) => s.id);
  }

  // ---------------------------------------------------------------------
  // Symbol lock — multi-strategy orchestration (AUTONOMY_AUDIT Finding 3)
  // ---------------------------------------------------------------------

  /**
   * Active lock on a symbol, or null when free. Expired locks are pruned and
   * treated as absent. Read-only — callers must not mutate the returned object.
   */
  getSymbolLock(symbol: string): SymbolLockState | null {
    const lock = this.symbolLocks.get(symbol);
    if (!lock) return null;
    if (lock.until <= Date.now()) {
      this.symbolLocks.delete(symbol);
      return null;
    }
    return { ...lock };
  }

  /**
   * Manually acquire the lock on behalf of a strategy. Returns false when
   * another strategy holds a live lock (the caller should stand aside).
   * Re-acquisition by the current holder refreshes the TTL.
   */
  acquireSymbolLock(symbol: string, strategyId: string, ttlMs?: number): boolean {
    const now = Date.now();
    const existing = this.symbolLocks.get(symbol);
    if (existing && existing.until > now && existing.strategyId !== strategyId) {
      return false;
    }
    this.symbolLocks.set(symbol, {
      symbol,
      strategyId,
      acquiredAt: now,
      until: now + (ttlMs ?? this.symbolLockTtlMs),
    });
    return true;
  }

  /** Release a lock — only the holder (or a force release with no strategyId). */
  releaseSymbolLock(symbol: string, strategyId?: string): void {
    const existing = this.symbolLocks.get(symbol);
    if (!existing) return;
    if (strategyId === undefined || existing.strategyId === strategyId) {
      this.symbolLocks.delete(symbol);
    }
  }

  /** Snapshot of all live locks — surfaced by the API / diagnostics. */
  listSymbolLocks(): SymbolLockState[] {
    const now = Date.now();
    for (const [symbol, lock] of this.symbolLocks) {
      if (lock.until <= now) this.symbolLocks.delete(symbol);
    }
    return Array.from(this.symbolLocks.values()).map((l) => ({ ...l }));
  }

  /**
   * Entry gate for OPEN signals: reject when another strategy holds a live
   * lock; otherwise acquire/refresh the lock for the signal's strategy.
   * CLOSE / CANCEL_ALL never consult the lock — flattening is always allowed.
   */
  private checkAndAcquireSymbolLock(signal: Signal, now: number): { ok: boolean; reason?: string } {
    if (!this.symbolLockEnabled) return { ok: true };
    if (!signal.action.startsWith('OPEN')) return { ok: true };

    const existing = this.symbolLocks.get(signal.symbol);
    if (existing && existing.until > now && existing.strategyId !== signal.strategyId) {
      const remainingMs = existing.until - now;
      return {
        ok: false,
        reason: `symbol locked by strategy ${existing.strategyId} (${Math.ceil(remainingMs / 1000)}s remaining)`,
      };
    }
    this.symbolLocks.set(signal.symbol, {
      symbol: signal.symbol,
      strategyId: signal.strategyId,
      acquiredAt: now,
      until: now + this.symbolLockTtlMs,
    });
    return { ok: true };
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

    // Multi-strategy orchestration: only one strategy may OPEN on a symbol
    // within the lock TTL. Acquired here so both the candle-driven path and
    // the autonomous agent's submitSignal path are covered identically.
    const lockCheck = this.checkAndAcquireSymbolLock(signal, now);
    if (!lockCheck.ok) {
      signal.status = 'REJECTED';
      signal.rejectReason = lockCheck.reason;
      // Deliberately NOT recorded in lastSignalByKey: lock rejections are
      // transient (the lock expires) and caching them would silently
      // suppress the strategy's next identical submission after expiry —
      // the dedup map has no eviction for REJECTED signals.
      this.listeners.onSignalRejected?.(signal, lockCheck.reason ?? 'symbol locked');
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

  /**
   * Public entry-point for external decision-makers (the Autonomous Trading
   * Agent) to submit a signal through the same cooldown / dedup / conflict /
   * executor pipeline that {@link onCandleClose} uses internally.
   *
   * The agent doesn't run as a registered Strategy because it isn't driven by
   * per-candle callbacks — it polls on its own clock and surveys the whole MTF
   * stack — but it still needs the engine's guardrails (cooldown, conflict
   * check, signal repository insert, SignalExecutor hand-off). Routing through
   * here means a single source of truth for "what is allowed to become an
   * order" instead of a parallel path the engine can't see.
   */
  async submitSignal(input: SignalInput): Promise<Signal | null> {
    if (!this.running) return null;
    if (input.action === 'HOLD') return null;

    // Fast-path symbol-lock check for external submitters (the autonomous
    // agent): a transient lock rejection returns a proper REJECTED signal
    // without going through processSignal, so nothing lands in the dedup
    // map and the caller can retry once the lock expires.
    if (this.symbolLockEnabled && input.action.startsWith('OPEN')) {
      const lock = this.getSymbolLock(input.symbol);
      if (lock && lock.strategyId !== input.strategyId) {
        const now = Date.now();
        const signal = toSignal(input, now);
        signal.status = 'REJECTED';
        signal.rejectReason = `symbol locked by strategy ${lock.strategyId} (${Math.ceil(
          (lock.until - now) / 1000
        )}s remaining)`;
        this.listeners.onSignalRejected?.(signal, signal.rejectReason);
        return signal;
      }
    }
    // Synthetic strategy identity so the cooldown/dedup map keys stay
    // namespaced away from per-candle strategies. CooldownMs comes from
    // input.features['cooldownMs'] if set, otherwise a 60s default — both
    // leave the engine's per-strategy cooldowns untouched.
    const syntheticStrategy: Strategy = {
      id: input.strategyId,
      name: input.strategyId,
      enabled: true,
      symbols: [input.symbol],
      intervals: [],
      priority: 50,
      cooldownMs: Number(input.features['cooldownMs'] ?? 60_000),
    };

    await this.processSignal(syntheticStrategy, input);
    const key = `${input.strategyId}:${input.symbol}:${input.action}`;
    const stored = this.lastSignalByKey.get(key) ?? null;
    if (!stored) return null;
    if (stored.status === 'CREATED') {
      // processSignal leaves the stored signal CREATED when the executor
      // ACCEPTED it (only failures get REJECTED in-memory; SignalExecutor
      // persists EXECUTED to the signals table without mutating this
      // object). Return a terminal-status VIEW without mutating the stored
      // object — the dedup map's lifecycle (CREATED → EXPIRED via
      // expireSignals, which re-enables future identical submissions) stays
      // intact, while callers like the autonomous agent / ExitManager (which
      // gate on status === 'EXECUTED' | 'ACCEPTED') see the real outcome.
      return { ...stored, status: 'EXECUTED' as const };
    }
    return stored;
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