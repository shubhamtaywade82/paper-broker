import { create } from 'zustand';

export type WorkspaceTab =
  | 'dashboard'
  | 'markets'
  | 'trading'
  | 'agent'
  | 'research'
  | 'risk'
  | 'activity'
  | 'system';

export interface ClosedCandle {
  symbol: string;
  interval: string;
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Position {
  symbol: string;
  side: 'LONG' | 'SHORT';
  quantity: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  leverage: number;
  liquidationPrice?: number;
  margin?: number;
  roe?: number;
  slPrice?: number;
  tpPrice?: number;
}

export interface Order {
  id: string;
  clientOrderId?: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'TAKE_PROFIT_MARKET';
  quantity: number;
  price?: number;
  stopPrice?: number;
  status: 'NEW' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELED' | 'REJECTED' | 'EXPIRED';
  leverage?: number;
  reduceOnly?: boolean;
  postOnly?: boolean;
  filledQty?: number;
  avgFillPrice?: number;
  submittedAtUtc?: string;
}

export interface AgentCycle {
  cycleId: string;
  symbol: string;
  startedAt: number;
  completedAt?: number;
  executed: boolean;
  action: string;
  confidence: number;
  verdict: string;
  rationale: string;
}

export interface AccountInfo {
  balance?: number;
  walletBalance?: number;
  equity: number;
  unrealizedPnl: number;
  marginUsed?: number;
  freeMargin?: number;
}

export interface PerformanceMetrics {
  period: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  sharpeRatio: number;
  maxDrawdown: number;
  currentEquity: number;
}

export interface DebateEntry {
  role: 'BULL' | 'BEAR';
  round: number;
  argument: string;
}

export interface RiskOpinion {
  persona: string;
  verdict: string;
  rationale: string;
}

export interface ToolCallTrace {
  tool: string;
  input: Record<string, unknown>;
  outputSummary: Record<string, unknown>;
  durationMs: number;
  status: 'SUCCESS' | 'FAILED';
}

export interface CycleDetail extends AgentCycle {
  analystReports: Array<{
    agent: string;
    summary: string;
    bullishSignals: string[];
    bearishSignals: string[];
    confidence: number;
  }>;
  debate: DebateEntry[];
  riskOpinions: RiskOpinion[];
  toolCalls?: ToolCallTrace[];
  fundManagerApproval: {
    approved: boolean;
    rationale: string;
    finalDecision: {
      action: string;
      leverage: number;
      sizePct: number;
      stopLoss?: number;
      takeProfit?: number;
    };
  };
}

export interface LiveEventItem {
  id?: string;
  type: string;
  stream?: string;
  payload: Record<string, unknown>;
  timestamp: number;
  traceId?: string;
}

export interface TickerData {
  symbol: string;
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  fundingRate?: number;
  markPrice?: number;
}

export interface OrderbookDepth {
  symbol: string;
  bid: number;
  ask: number;
  bidQty: number;
  askQty: number;
  spread: number;
  last: number;
  mark: number;
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
}

export interface RiskSummary {
  riskRating: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  exposurePct: number;
  marginUsagePct: number;
  openPositionsCount: number;
  maxOpenPositions: number;
  dailyLossLimitPct: number;
  dailyLossRemainingPct: number;
  safeMode: boolean;
  liveArmed: boolean;
  mode: string;
  limits: {
    maxLeverage: number;
    maxRiskPerTradePct: number;
    maxDrawdownPct: number;
    divergenceLimitPct: number;
  };
}

interface StoreState {
  activeTab: WorkspaceTab;
  selectedSymbol: string;
  timeframe: string;
  account: AccountInfo | null;
  positions: Position[];
  openOrders: Order[];
  selectedPosition: Position | null;
  cycles: AgentCycle[];
  selectedCycle: CycleDetail | null;
  agentTab: 'overview' | 'pipeline' | 'runs' | 'fleet' | 'adaptive-supertrend';
  tradingTab: 'positions' | 'orders' | 'form' | 'fills' | 'journal';
  riskSummary: RiskSummary | null;
  performance: PerformanceMetrics | null;
  wsConnected: boolean;
  operatingMode: 'paper' | 'shadow' | 'live';
  liveArmed: boolean;
  aggressiveMode: boolean;
  liveEvents: LiveEventItem[];
  livePrice: Record<string, number>;
  closedCandle: Record<string, ClosedCandle>;
  tickers: Record<string, TickerData>;
  orderbook: OrderbookDepth | null;

  setActiveTab: (tab: WorkspaceTab) => void;
  setSelectedSymbol: (symbol: string) => void;
  setTimeframe: (tf: string) => void;
  setAccount: (account: AccountInfo) => void;
  setPositions: (positions: Position[]) => void;
  setOpenOrders: (orders: Order[]) => void;
  setSelectedPosition: (pos: Position | null) => void;
  setCycles: (cycles: AgentCycle[]) => void;
  setSelectedCycle: (cycle: CycleDetail | null) => void;
  setAgentTab: (tab: 'overview' | 'pipeline' | 'runs' | 'fleet' | 'adaptive-supertrend') => void;
  setTradingTab: (tab: 'positions' | 'orders' | 'form' | 'fills' | 'journal') => void;
  setRiskSummary: (risk: RiskSummary) => void;
  setPerformance: (perf: PerformanceMetrics) => void;
  setWsConnected: (connected: boolean) => void;
  setOperatingMode: (mode: 'paper' | 'shadow' | 'live', armed?: boolean) => void;
  setAggressiveMode: (aggressive: boolean) => void;
  addLiveEvent: (event: { type: string; payload: Record<string, unknown>; stream?: string; id?: string }) => void;
  setLivePrice: (symbol: string, price: number) => void;
  setClosedCandle: (candle: ClosedCandle) => void;
  setTickers: (tickers: Record<string, TickerData>) => void;
  setOrderbook: (orderbook: OrderbookDepth | null) => void;
}

export const SUPPORTED_SYMBOLS = [
  'SOLUSDT',
  'BTCUSDT',
  'ETHUSDT',
  'BNBUSDT',
  'XRPUSDT',
  'DOGEUSDT',
];

const VALID_TABS: WorkspaceTab[] = [
  'dashboard',
  'markets',
  'trading',
  'agent',
  'research',
  'risk',
  'activity',
  'system',
];

function getInitialTab(): WorkspaceTab {
  if (typeof window !== 'undefined') {
    const hash = window.location.hash.replace(/^#\/?/, '').toLowerCase();
    if (VALID_TABS.includes(hash as WorkspaceTab)) {
      return hash as WorkspaceTab;
    }
    const saved = localStorage.getItem('nemesis_active_tab');
    if (saved && VALID_TABS.includes(saved as WorkspaceTab)) {
      return saved as WorkspaceTab;
    }
  }
  return 'dashboard';
}

function getInitialSymbol(): string {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('nemesis_selected_symbol');
    if (saved && typeof saved === 'string') {
      return saved;
    }
  }
  return 'SOLUSDT';
}

function getInitialOperatingMode(): 'paper' | 'shadow' | 'live' {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('nemesis_operating_mode');
    if (saved === 'paper' || saved === 'shadow' || saved === 'live') {
      return saved;
    }
  }
  return 'paper';
}

function getInitialLiveArmed(): boolean {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('nemesis_live_armed') === 'true';
  }
  return false;
}

function getInitialAggressiveMode(): boolean {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('nemesis_aggressive_mode') === 'true';
  }
  return false;
}

export function getPricePrecision(price?: number | null, symbol?: string): number {
  if (symbol) {
    const sym = symbol.toUpperCase();
    if (sym.startsWith('BTC') || sym.startsWith('ETH')) return 2;
    if (sym.startsWith('SOL') || sym.startsWith('BNB')) return 2;
    if (sym.startsWith('XRP') || sym.startsWith('ADA')) return 4;
    if (sym.startsWith('DOGE')) return 5;
    if (sym.includes('PEPE') || sym.includes('SHIB')) return 8;
  }
  if (price === undefined || price === null || isNaN(price) || price === 0) return 2;
  const abs = Math.abs(price);
  if (abs >= 1000) return 2;
  if (abs >= 10) return 2;
  if (abs >= 1) return 4;
  if (abs >= 0.01) return 5;
  if (abs >= 0.0001) return 6;
  return 8;
}

export function formatPrice(price?: number | null, symbol?: string): string {
  if (price === undefined || price === null || isNaN(price)) return '—';
  const precision = getPricePrecision(price, symbol);
  return price.toLocaleString('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

export function formatCurrency(price?: number | null, symbol?: string): string {
  if (price === undefined || price === null || isNaN(price)) return '—';
  return `$${formatPrice(price, symbol)}`;
}

export const useStore = create<StoreState>((set) => ({
  activeTab: getInitialTab(),
  selectedSymbol: getInitialSymbol(),
  timeframe: '15m',
  account: null,
  positions: [],
  openOrders: [],
  selectedPosition: null,
  cycles: [],
  selectedCycle: null,
  agentTab: 'overview',
  tradingTab: 'positions',
  riskSummary: null,
  performance: null,
  wsConnected: false,
  operatingMode: getInitialOperatingMode(),
  liveArmed: getInitialLiveArmed(),
  aggressiveMode: getInitialAggressiveMode(),
  liveEvents: [],
  livePrice: {},
  closedCandle: {},
  tickers: {},
  orderbook: null,

  setActiveTab: (tab) => {
    if (typeof window !== 'undefined') {
      window.location.hash = `#${tab}`;
      localStorage.setItem('nemesis_active_tab', tab);
    }
    set({ activeTab: tab });
  },
  setSelectedSymbol: (selectedSymbol) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('nemesis_selected_symbol', selectedSymbol);
    }
    set({ selectedSymbol });
  },
  setTimeframe: (timeframe) => set({ timeframe }),
  setAccount: (account) => set({ account }),
  setPositions: (positions) => set({ positions }),
  setOpenOrders: (openOrders) => set({ openOrders }),
  setSelectedPosition: (selectedPosition) => set({ selectedPosition }),
  setCycles: (cycles) => set({ cycles }),
  setSelectedCycle: (cycle) => set({ selectedCycle: cycle }),
  setAgentTab: (agentTab) => set({ agentTab }),
  setTradingTab: (tradingTab) => set({ tradingTab }),
  setRiskSummary: (riskSummary) => set({ riskSummary }),
  setPerformance: (perf) => set({ performance: perf }),
  setWsConnected: (wsConnected) => set({ wsConnected }),
  setOperatingMode: (operatingMode, armed) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('nemesis_operating_mode', operatingMode);
      if (armed !== undefined) {
        localStorage.setItem('nemesis_live_armed', String(armed));
      }
    }
    set((state) => ({
      operatingMode,
      liveArmed: armed !== undefined ? armed : state.liveArmed,
    }));
  },
  setAggressiveMode: (aggressiveMode) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('nemesis_aggressive_mode', String(aggressiveMode));
    }
    set({ aggressiveMode });
  },
  addLiveEvent: (event) =>
    set((state) => ({
      liveEvents: [
        {
          ...event,
          id: event.id || `evt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          timestamp: Date.now(),
        },
        ...state.liveEvents.slice(0, 199),
      ],
    })),
  setLivePrice: (symbol, price) =>
    set((state) => ({ livePrice: { ...state.livePrice, [symbol]: price } })),
  setClosedCandle: (candle) =>
    set((state) => ({
      closedCandle: { ...state.closedCandle, [`${candle.symbol}:${candle.interval}`]: candle },
    })),
  setTickers: (tickers) => set({ tickers }),
  setOrderbook: (orderbook) => set({ orderbook }),
}));
