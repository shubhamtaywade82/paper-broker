import type { Instrument } from '../broker/types.js';
import { symbols } from './env.js';

export const defaultInstruments: Instrument[] = symbols.map((symbol) => ({
  symbol,
  baseAsset: symbol.replace('USDT', ''),
  quoteAsset: 'USDT',
  contractType: 'PERPETUAL',
  status: 'TRADING',
  tickSize: '0.01',
  stepSize: '0.001',
  minQty: '0.001',
  maxQty: '10000',
  minNotional: '5',
  pricePrecision: 2,
  quantityPrecision: 3,
  maintenanceMarginRate: '0.005',
  createdAtUtc: new Date().toISOString(),
  updatedAtUtc: new Date().toISOString(),
}));

export function getInstrumentConfig(symbol: string): Instrument {
  const existing = defaultInstruments.find((i) => i.symbol === symbol);
  if (existing) return existing;

  return {
    symbol,
    baseAsset: symbol.replace('USDT', ''),
    quoteAsset: 'USDT',
    contractType: 'PERPETUAL',
    status: 'TRADING',
    tickSize: '0.01',
    stepSize: '0.001',
    minQty: '0.001',
    maxQty: '10000',
    minNotional: '5',
    pricePrecision: 2,
    quantityPrecision: 3,
    maintenanceMarginRate: '0.005',
    createdAtUtc: new Date().toISOString(),
    updatedAtUtc: new Date().toISOString(),
  };
}

export const riskLimits = {
  maxLeverage: 10,
  maxOrderNotional: 5000,
  maxPositionNotional: 20000,
  maxDailyLoss: 1000,
  maxOpenOrders: 50,
  allowMarketOrders: true,
  allowLimitOrders: true,
  allowStopOrders: true,
  staleMarketMaxAgeMs: 5000,
  maxPositionSize: 0.1,
  riskPerTrade: 0.005,
};