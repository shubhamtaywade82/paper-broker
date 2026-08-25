import { ulid } from 'ulid';
import type { Candle } from '../indicators.js';
import type { CandleClosedPayload, IntentPayload, MarketStateSnapshot, PositionAction, PositionLifecyclePayload, PositionLifecycleState, SetupLifecyclePayload, TradeSetup, TradingEvent, TradingEventType } from './types.js';

export type TradingEventHandler = (event: TradingEvent) => void | Promise<void>;

export class TradingEventBus {
  private handlers = new Map<TradingEventType, Set<TradingEventHandler>>();
  private allHandlers = new Set<TradingEventHandler>();
  private sequence = 0;

  create<TPayload>(type: TradingEventType, symbol: string, source: string, payload: TPayload, timestamp = Date.now()): TradingEvent<TPayload> {
    this.sequence += 1;
    return { id: ulid(), type, symbol, timestamp, source, sequence: this.sequence, payload };
  }

  subscribe(type: TradingEventType, handler: TradingEventHandler): () => void {
    const handlers = this.handlers.get(type) ?? new Set<TradingEventHandler>();
    handlers.add(handler);
    this.handlers.set(type, handlers);
    return () => handlers.delete(handler);
  }

  subscribeAll(handler: TradingEventHandler): () => void {
    this.allHandlers.add(handler);
    return () => this.allHandlers.delete(handler);
  }

  // C-07: previously awaited each handler sequentially in a for-loop, so a
  // slow handler (e.g. an LLM-backed subscriber via subscribeAll) blocked
  // every handler registered after it for this event, and a throwing handler
  // aborted the remaining handlers entirely (no isolation). Handlers now run
  // concurrently and are isolated from each other's failures/latency via
  // Promise.allSettled; publish() still resolves only once all handlers have
  // settled, preserving "await publish() to know this event was fully
  // dispatched" for callers like EventDrivenMarketStateEngine.
  async publish(event: TradingEvent): Promise<void> {
    const handlers = [...(this.handlers.get(event.type) ?? []), ...this.allHandlers];
    // Wrapped in an async IIFE so a handler that throws synchronously (not
    // just one that returns a rejected promise) is also isolated by
    // allSettled rather than escaping the .map() call and aborting publish().
    const results = await Promise.allSettled(handlers.map((handler) => (async () => handler(event))()));
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error(`[TradingEventBus] handler failed for event ${event.type}:`, result.reason);
      }
    }
  }
}

export function candleClosedEvent(bus: TradingEventBus, candle: Candle, source = 'market-data'): TradingEvent<CandleClosedPayload> {
  return bus.create('CANDLE_CLOSED', candle.symbol, source, { candle }, candle.openTime);
}

export function setupIntentPayload(setup: TradeSetup, action: IntentPayload['action']): IntentPayload {
  return {
    setupId: setup.id,
    symbol: setup.symbol,
    direction: setup.direction,
    action,
    reason: setup.type,
    entryZone: { low: setup.entry.min, high: setup.entry.max },
    invalidation: setup.invalidation.price,
    targets: setup.targets,
    confidence: setup.score / 100,
    evidence: setup.evidence,
  };
}

export interface EventDrivenMarketStateEngineOptions {
  source?: string;
  maxCandlesPerSeries?: number;
}

export class EventDrivenMarketStateEngine {
  private candles = new Map<string, Candle[]>();
  private snapshots = new Map<string, MarketStateSnapshot>();
  private setupIds = new Set<string>();
  private unsubscribe?: () => void;
  private source: string;
  private maxCandlesPerSeries: number;

  constructor(
    private readonly bus: TradingEventBus,
    private readonly buildSnapshot: (symbol: string, timeframe: string, candles: Candle[]) => MarketStateSnapshot,
    private readonly deriveSetup: (snapshot: MarketStateSnapshot) => TradeSetup | null,
    options: EventDrivenMarketStateEngineOptions = {}
  ) {
    this.source = options.source ?? 'market-state-engine';
    this.maxCandlesPerSeries = options.maxCandlesPerSeries ?? 500;
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.bus.subscribe('CANDLE_CLOSED', async (event) => {
      const payload = event.payload as CandleClosedPayload;
      await this.onCandleClosed(payload.candle);
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  async onCandleClosed(candle: Candle): Promise<TradingEvent[]> {
    const key = `${candle.symbol}:${candle.interval}`;
    const series = [...(this.candles.get(key) ?? []).filter((c) => c.openTime !== candle.openTime), candle].sort((a, b) => a.openTime - b.openTime).slice(-this.maxCandlesPerSeries);
    this.candles.set(key, series);

    const previous = this.snapshots.get(key);
    const snapshot = this.buildSnapshot(candle.symbol, candle.interval, series);
    this.snapshots.set(key, snapshot);

    const events: TradingEvent[] = [];
    const emit = async (event: TradingEvent): Promise<void> => { events.push(event); await this.bus.publish(event); };

    for (const event of snapshot.structure.events.slice(-(previous ? 1 : 5))) {
      if (event.type === 'BOS_UP' || event.type === 'BOS_DOWN') await emit(this.bus.create('BOS', candle.symbol, this.source, { event }, event.time));
      else if (event.type === 'CHOCH_UP' || event.type === 'CHOCH_DOWN') await emit(this.bus.create('CHOCH', candle.symbol, this.source, { event }, event.time));
      else await emit(this.bus.create('SWING_CONFIRMED', candle.symbol, this.source, { event }, event.time));
    }

    const latestSweep = snapshot.liquidity.latestSweep;
    if (latestSweep && latestSweep.time === candle.openTime) await emit(this.bus.create('LIQUIDITY_SWEEP', candle.symbol, this.source, { sweep: latestSweep }, latestSweep.time));

    const latestDisplacement = snapshot.displacement.latest;
    if (latestDisplacement && latestDisplacement.time === candle.openTime) await emit(this.bus.create('DISPLACEMENT', candle.symbol, this.source, { displacement: latestDisplacement }, latestDisplacement.time));

    if (!previous || previous.regime !== snapshot.regime) {
      await emit(this.bus.create('REGIME_CHANGED', candle.symbol, this.source, { previous: previous?.regime ?? 'NEUTRAL', current: snapshot.regime, snapshot }, candle.openTime));
    }

    const setup = this.deriveSetup(snapshot);
    if (setup && !this.setupIds.has(setup.id)) {
      this.setupIds.add(setup.id);
      await emit(this.bus.create<SetupLifecyclePayload>('SETUP_CREATED', setup.symbol, this.source, { setup, status: 'WATCHING' }, candle.openTime));
      await emit(this.bus.create<SetupLifecyclePayload>('SETUP_ARMED', setup.symbol, this.source, { setup, status: 'TRIGGER_ARMED', reason: 'close confirmed inside/through entry zone' }, candle.openTime));
      await emit(this.bus.create<IntentPayload>('ENTRY_INTENT', setup.symbol, this.source, setupIntentPayload(setup, 'OPEN'), candle.openTime));
    }

    return events;
  }
}

export class PositionStateMachine {
  private states = new Map<string, PositionLifecycleState>();

  constructor(private readonly bus: TradingEventBus, private readonly source = 'position-state-machine') {}

  getState(symbol: string): PositionLifecycleState {
    return this.states.get(symbol) ?? 'FLAT';
  }

  async applyIntent(intent: IntentPayload): Promise<TradingEvent<PositionLifecyclePayload> | null> {
    const previous = this.getState(intent.symbol);
    let current = previous;
    if (intent.action === 'OPEN' && previous === 'FLAT') current = 'PENDING_ENTRY';
    else if (intent.action === 'ADD' && (previous === 'LONG' || previous === 'SHORT')) current = previous;
    else if ((intent.action === 'CLOSE' || intent.action === 'REDUCE') && (previous === 'LONG' || previous === 'SHORT')) current = intent.action === 'CLOSE' ? 'EXIT_PENDING' : previous;
    else if (intent.action === 'REVERSE' && (previous === 'LONG' || previous === 'SHORT')) current = 'EXIT_PENDING';
    else return null;
    this.states.set(intent.symbol, current);
    // Medium finding: this used to hardcode 'POSITION_OPENED' regardless of
    // `intent.action` — a REDUCE or CLOSE intent (transitioning toward
    // EXIT_PENDING) was published as if it were an entry. applyIntent
    // represents intent BEFORE fill confirmation, so it emits the *_INTENT
    // event types (matching the ones EventDrivenMarketStateEngine already
    // uses for the same concept elsewhere in this file); applyFill below is
    // the one that correctly emits the fill-confirmed POSITION_* types.
    const intentEventType: Record<Exclude<PositionAction, 'HOLD'>, TradingEventType> = {
      OPEN: 'ENTRY_INTENT',
      ADD: 'ADD_INTENT',
      REDUCE: 'REDUCE_INTENT',
      CLOSE: 'EXIT_INTENT',
      REVERSE: 'REVERSE_INTENT',
    };
    const eventType = intentEventType[intent.action as Exclude<PositionAction, 'HOLD'>];
    const event = this.bus.create(eventType, intent.symbol, this.source, { previous, current, action: intent.action, reason: String(intent.reason) });
    await this.bus.publish(event);
    return event;
  }

  async applyFill(symbol: string, direction: 'LONG' | 'SHORT' | 'FLAT'): Promise<TradingEvent<PositionLifecyclePayload>> {
    const previous = this.getState(symbol);
    const current: PositionLifecycleState = direction === 'FLAT' ? 'FLAT' : direction;
    this.states.set(symbol, current);
    const type = current === 'FLAT' ? 'POSITION_CLOSED' : previous === 'PENDING_ENTRY' ? 'POSITION_OPENED' : 'POSITION_INCREASED';
    const action: PositionLifecyclePayload['action'] = current === 'FLAT' ? 'CLOSE' : 'OPEN';
    const event = this.bus.create<PositionLifecyclePayload>(type, symbol, this.source, { previous, current, action, reason: 'ORDER_FILLED' });
    await this.bus.publish(event);
    return event;
  }
}
