import type { Instrument } from '../broker/types.js';
import { symbols } from './env.js';

function getDefaultPrecision(symbol: string): { pricePrecision: number; quantityPrecision: number; tickSize: string; stepSize: string } {
  if (symbol === 'BTCUSDT') return { pricePrecision: 2, quantityPrecision: 3, tickSize: '0.1', stepSize: '0.001' };
  if (symbol === 'ETHUSDT') return { pricePrecision: 2, quantityPrecision: 3, tickSize: '0.01', stepSize: '0.001' };
  if (symbol === 'SOLUSDT') return { pricePrecision: 2, quantityPrecision: 2, tickSize: '0.01', stepSize: '0.01' };
  if (symbol === 'BNBUSDT') return { pricePrecision: 2, quantityPrecision: 2, tickSize: '0.01', stepSize: '0.01' };
  if (symbol === 'XRPUSDT') return { pricePrecision: 4, quantityPrecision: 1, tickSize: '0.0001', stepSize: '0.1' };
  if (symbol === 'DOGEUSDT') return { pricePrecision: 5, quantityPrecision: 0, tickSize: '0.00001', stepSize: '1' };
  if (symbol.includes('PEPE') || symbol.includes('SHIB')) return { pricePrecision: 8, quantityPrecision: 0, tickSize: '0.00000001', stepSize: '1' };
  return { pricePrecision: 2, quantityPrecision: 3, tickSize: '0.01', stepSize: '0.001' };
}

export const defaultInstruments: Instrument[] = symbols.map((symbol) => {
  const baseAsset = symbol.replace('USDT', '');
  const prec = getDefaultPrecision(symbol);
  return {
    symbol,
    baseAsset,
    quoteAsset: 'USDT',
    contractType: 'PERPETUAL',
    status: 'TRADING',
    tickSize: prec.tickSize,
    stepSize: prec.stepSize,
    minQty: prec.stepSize,
    maxQty: '1000000',
    minNotional: '5',
    pricePrecision: prec.pricePrecision,
    quantityPrecision: prec.quantityPrecision,
    maintenanceMarginRate: '0.005',
    canonical: `${baseAsset}/USDT`,
    venues: {
      binance: symbol,
      coindcx: `B-${baseAsset}_USDT`,
    },
    createdAtUtc: new Date().toISOString(),
    updatedAtUtc: new Date().toISOString(),
  };
});

export function getInstrumentConfig(symbol: string): Instrument {
  const existing = defaultInstruments.find((i) => i.symbol === symbol);
  if (existing) return existing;

  const baseAsset = symbol.replace('USDT', '');
  const prec = getDefaultPrecision(symbol);
  return {
    symbol,
    baseAsset,
    quoteAsset: 'USDT',
    contractType: 'PERPETUAL',
    status: 'TRADING',
    tickSize: prec.tickSize,
    stepSize: prec.stepSize,
    minQty: prec.stepSize,
    maxQty: '1000000',
    minNotional: '5',
    pricePrecision: prec.pricePrecision,
    quantityPrecision: prec.quantityPrecision,
    maintenanceMarginRate: '0.005',
    canonical: `${baseAsset}/USDT`,
    venues: {
      binance: symbol,
      coindcx: `B-${baseAsset}_USDT`,
    },
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