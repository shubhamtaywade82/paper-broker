import type { RiskConfig } from './types.js';

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxOpenPositions: 3,
  maxPositionsPerSymbol: 1,
  maxDailyLossPct: 0.03,
  riskPerTradePct: 0.01,
  maxAccountRiskPct: 0.05,
  cooldownBars: 3,
  defaultLeverage: 5,
  maxLeverage: 10,
  maxNotionalPerTrade: 50_000,
};
