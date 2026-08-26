export type OrderSide = 'BUY' | 'SELL';

export type OrderType =
  | 'MARKET'
  | 'LIMIT'
  | 'STOP_MARKET'
  | 'TAKE_PROFIT_MARKET'
  | 'STOP'
  | 'TRAILING_STOP_MARKET';

export type OrderStatus =
  | 'NEW'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELED'
  | 'REJECTED'
  | 'EXPIRED';

export type TimeInForce =
  | 'GTC'
  | 'IOC'
  | 'FOK'
  | 'GTD';

export type Liquidity = 'MAKER' | 'TAKER';

export type PositionSide = 'BOTH' | 'LONG' | 'SHORT';

export type MarginType = 'CROSSED' | 'ISOLATED';

export type WorkingType = 'MARK_PRICE' | 'CONTRACT_PRICE';

export type AccountMode = 'PAPER' | 'TESTNET_MIRROR';

export interface Instrument {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  contractType: string;
  status: string;

  tickSize: string;
  stepSize: string;

  minQty: string;
  maxQty?: string;
  minNotional: string;

  pricePrecision: number;
  quantityPrecision: number;

  maintenanceMarginRate: string;

  canonical?: string;
  venues?: {
    binance?: string;
    coindcx?: string;
  };

  createdAtUtc: string;
  updatedAtUtc: string;
}

export type DataQualityStatus = 'VALID' | 'STALE' | 'INVALID' | 'MISSING' | 'DUPLICATE' | 'OUT_OF_ORDER';

export interface MarketState {
  symbol: string;

  bid?: number;
  ask?: number;
  bidQty?: number;
  askQty?: number;
  spread?: number;

  last?: number;
  lastQty?: number;
  mark?: number;
  index?: number;
  volume24h?: number;

  fundingRate?: number;
  nextFundingTimeUtc?: string;

  openInterest?: number;
  openInterestDelta?: number;
  openInterestTimestampUtc?: string;

  longShortRatio?: number;
  longShortTimestampUtc?: string;
  topTraderLongShortRatio?: number;
  topTraderTimestampUtc?: string;

  takerBuyVolume?: number;
  takerSellVolume?: number;
  takerDelta?: number;
  takerVolumeTimestampUtc?: string;

  exchangeTsUtc?: string;
  localTsUtc: number;
  latencyMs?: number;
  stale: boolean;

  lastQualityStatus?: DataQualityStatus;
  lastQualityReason?: string;
}

export interface OrderCommand {
  clientOrderId?: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price?: number;
  stopPrice?: number;
  activationPrice?: number;
  callbackRate?: number;
  leverage?: number;
  marginType?: MarginType;
  reduceOnly?: boolean;
  postOnly?: boolean;
  closePosition?: boolean;
  timeInForce?: TimeInForce;
  workingType?: WorkingType;
  strategyId?: string;
  signalId?: string;
}

export interface Order {
  id: string;
  clientOrderId: string;
  accountId: string;
  symbol: string;
  strategyId?: string;
  signalId?: string;
  side: OrderSide;
  type: OrderType;
  timeInForce: TimeInForce;
  status: OrderStatus;
  positionSide: PositionSide;
  quantity: number;
  filledQty: number;
  limitPrice?: number;
  stopPrice?: number;
  activationPrice?: number;
  callbackRate?: number;
  avgFillPrice: number;
  leverage: number;
  marginType?: MarginType;
  reduceOnly: boolean;
  postOnly: boolean;
  closePosition: boolean;
  workingType?: WorkingType;
  rejectReason?: string;
  submittedAtUtc: string;
  updatedAtUtc: string;
}

export interface Fill {
  id: string;
  orderId: string;
  accountId: string;
  symbol: string;
  strategyId?: string;
  signalId?: string;
  side: OrderSide;
  quantity: number;
  price: number;
  notional: number;
  fee: number;
  feeAsset: string;
  liquidity: Liquidity;
  realizedPnl: number;
  positionQtyBefore: number;
  positionQtyAfter: number;
  positionEntryBefore?: number;
  positionEntryAfter?: number;
  marketBid?: number;
  marketAsk?: number;
  marketLast?: number;
  marketMark?: number;
  expectedPrice?: number;
  slippageBps?: number;
  fillTsUtc: string;
}

export interface Position {
  accountId: string;
  symbol: string;
  positionSide: PositionSide;
  status: 'OPEN' | 'CLOSED';
  qty: number;
  entryPrice: number;
  markPrice?: number;
  indexPrice?: number;
  unrealizedPnl: number;
  realizedPnl: number;
  leverage: number;
  marginType?: MarginType;
  initialMargin: number;
  maintenanceMargin: number;
  maintenanceMarginRate: number;
  totalFees: number;
  totalFunding: number;
  openedAtUtc?: string;
  updatedAtUtc: string;
  closedAtUtc?: string;
}

export interface PositionEvent {
  id: string;
  accountId: string;
  symbol: string;
  positionSide: PositionSide;
  eventType:
    | 'OPEN'
    | 'INCREASE'
    | 'REDUCE'
    | 'CLOSE'
    | 'FLIP'
    | 'FUNDING'
    | 'MARGIN_CHANGE'
    | 'LIQUIDATION'
    | 'ADL'
    | 'SNAPSHOT';
  fillId?: string;
  orderId?: string;
  qtyBefore: number;
  qtyAfter: number;
  price?: number;
  markPrice?: number;
  realizedPnl?: number;
  fee?: number;
  funding?: number;
  entryPriceBefore?: number;
  entryPriceAfter?: number;
  payload?: Record<string, unknown>;
  createdAtUtc: string;
}

export interface AccountState {
  walletBalance: number;
  unrealizedPnl: number;
  equity: number;
  initialMargin: number;
  maintenanceMargin: number;
  availableBalance: number;
  marginRatio?: number;
  totalFees: number;
  totalFunding: number;
  totalRealizedPnl: number;
  openPositionsCount: number;
  openOrdersCount: number;
  dailyRealizedPnl?: number;
  dailyFunding?: number;
  dailyFees?: number;
  peakEquity?: number;
  drawdown?: number;
  liquidations: number;
}

export interface Wallet {
  accountId: string;
  currency: string;
  startingBalance: number;
  currentBalance: number;
  totalFees: number;
  totalFunding: number;
  totalRealizedPnl: number;
  updatedAtUtc: string;
}

export interface LedgerEntry {
  id: string;
  accountId: string;
  eventId: string;
  eventType: string;
  currency: string;
  accountCode: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: number;
  balanceAfter?: number;
  relatedOrderId?: string;
  relatedFillId?: string;
  relatedPositionSymbol?: string;
  description?: string;
  createdAtUtc: string;
}

export interface FundingPayment {
  id: string;
  accountId: string;
  symbol: string;
  positionSide: PositionSide;
  qty: number;
  markPrice: number;
  fundingRate: number;
  payment: number;
  walletBalanceAfter: number;
  fundingTimeUtc: string;
  createdAtUtc: string;
}

export interface RiskLimits {
  maxLeverage: number;
  maxOrderNotional: number;
  maxPositionNotional: number;
  maxDailyLoss: number;
  maxOpenOrders: number;
  allowMarketOrders: boolean;
  allowLimitOrders: boolean;
  allowStopOrders: boolean;
  staleMarketMaxAgeMs: number;
}

export interface MarketStateProvider {
  getState(symbol: string): MarketState | undefined;
}

export interface OrderEventSink {
  appendOrderEvent(event: OrderEventType): void;
  appendFill(fill: Fill): void;
  appendPositionEvent(event: PositionEvent): void;
  appendFundingPayment(payment: FundingPayment): void;
}

export interface BrokerPersister {
  saveOrder(order: Order): void;
  saveFill(fill: Fill): void;
  savePosition(position: Position): void;
  loadOpenPositions?(accountId?: string): Position[];
  loadOpenOrders?(accountId?: string): Order[];
}

export interface PaperBrokerConfig {
  dataDir: string;
  accountId: string;
  startingUsdt: number;
  instruments: Instrument[];
  takerFeeRate?: number;
  makerFeeRate?: number;
  marketSlippageBps?: number;
  risk?: Partial<RiskLimits>;
  marketState?: MarketStateProvider;
  eventLog?: OrderEventSink;
  persister?: BrokerPersister;
  /**
   * Called after every fill is recorded and the account has been
   * recalculated. Carries the realized PnL and originating strategyId, which
   * is what profit-goal tracking and per-strategy performance feedback are
   * driven from. Never throws into the fill path — the broker isolates it.
   */
  onFill?: (fill: Fill) => void;
}

export interface RiskCheckResult {
  ok: boolean;
  reason?: string;
}

export interface OrderEventType {
  eventType:
    | 'ORDER_RECEIVED'
    | 'ORDER_VALIDATED'
    | 'ORDER_REJECTED'
    | 'ORDER_ACCEPTED'
    | 'ORDER_TRIGGERED'
    | 'ORDER_PARTIALLY_FILLED'
    | 'ORDER_FILLED'
    | 'ORDER_CANCELED'
    | 'ORDER_EXPIRED';
  orderId: string;
  accountId: string;
  symbol: string;
  oldStatus?: OrderStatus;
  newStatus?: OrderStatus;
  filledQty?: number;
  executionPrice?: number;
  reason?: string;
  payload?: Record<string, unknown>;
  createdAtUtc: string;
}

export interface SystemEventType {
  eventType:
    | 'WS_CONNECTED'
    | 'WS_DISCONNECTED'
    | 'WS_RECONNECTING'
    | 'WS_RESUBSCRIBED'
    | 'REST_REQUEST'
    | 'REST_ERROR'
    | 'STALE_MARKET'
    | 'SNAPSHOT_CREATED'
    | 'ENGINE_STARTED'
    | 'ENGINE_STOPPED'
    | 'CLOCK_DRIFT_WARNING'
    | 'PROVIDER_SWITCHED'
    | 'RECONCILIATION_OK'
    | 'RECONCILIATION_MISMATCH'
    | 'STRATEGY_QUARANTINED'
    | 'SETUP_TYPE_QUARANTINED'
    | 'PROFIT_GOAL_ACHIEVED'
    | 'PROFIT_GOAL_RESET'
    | 'TRAILING_STOP_MOVED'
    | 'AUTONOMOUS_AGENT_STARTED'
    | 'AUTONOMOUS_AGENT_STOPPED'
    | 'AUTONOMOUS_AGENT_SIGNAL'
    | 'AUTONOMOUS_AGENT_REJECTED'
    | 'AUTONOMOUS_REGIME_CHANGE'
    | 'AUTONOMOUS_CYCLE_COMPLETED'
    | 'AUTONOMOUS_CIRCUIT_BREAKER_TRIPPED'
    | 'AUTONOMOUS_CIRCUIT_BREAKER_CLEARED'
    | 'AUTONOMOUS_HEALTH_DEGRADED'
    | 'AUTONOMOUS_HEALTH_RECOVERED'
    | 'AUTONOMOUS_EXIT_SIGNAL'
    | 'AUTONOMOUS_LEARNING_PARAMETER_ADJUSTED'
    | 'AUTONOMOUS_SCALE_IN'
    | 'AUTONOMOUS_SCALE_OUT'
    | 'AUTONOMOUS_LLM_VETO';
  payload?: Record<string, unknown>;
  createdAtUtc: string;
}

export interface ExecutionBroker {
  submitOrder(command: OrderCommand): Promise<Order> | Order;
  cancelOrder(orderId: string, reason?: string, nowIso?: string): Promise<Order | undefined> | Order | undefined;
  cancelAllOrders(symbol?: string): Promise<void> | void;
  getOpenOrders(symbol?: string): Promise<Order[]> | Order[];
  getPositions(): Promise<Position[]> | Position[];
  getPosition(symbol: string): Promise<Position | undefined> | Position | undefined;
  getAccount(): Promise<AccountState> | AccountState;
}

export type MarketDataProviderType = 'BINANCE' | 'COINDCX';
export type ProviderHealthStatus = 'HEALTHY' | 'DEGRADED' | 'STALE' | 'DISCONNECTED' | 'RECOVERING';

export interface ProviderHealth {
  provider: MarketDataProviderType;
  status: ProviderHealthStatus;
  lastEventTimeMs: number;
  latencyMs: number;
  stale: boolean;
  divergenceBps?: number;
}

export interface TradingContext {
  signalVenue: MarketDataProviderType;
  executionVenue: 'PAPER' | 'COINDCX';
}