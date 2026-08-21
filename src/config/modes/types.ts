export type TradingMode = 'paper' | 'shadow' | 'live';

export type MarketDataProviderType = 'BINANCE' | 'COINDCX';
export type ExecutionVenueType = 'PAPER' | 'COINDCX';

export interface RuntimeProfile {
  mode: TradingMode;
  executionVenue: ExecutionVenueType;
  realOrders: boolean;
  accountReadOnly: boolean;
  marketDataPrimary: MarketDataProviderType;
  marketDataFallback: MarketDataProviderType;
  failoverEnabled: boolean;
  reconciliationEnabled: boolean;
  liveGuardEnabled: boolean;
  liveArmed: boolean;
  riskEngineEnabled: boolean;
  agentEnabled: boolean;
  telegramEnabled: boolean;
}
