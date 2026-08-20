import { BinanceClient } from '@nemesis-oss/binance-sdk';
import { env } from '../config/env.js';

let clientInstance: BinanceClient | null = null;

export function getBinanceClient(): BinanceClient {
  if (!clientInstance) {
    clientInstance = new BinanceClient({
      testnet: env.BINANCE_ENV === 'testnet',
      apiKey: env.BINANCE_API_KEY,
      apiSecret: env.BINANCE_API_SECRET,
    });
  }
  return clientInstance;
}

export function createBinanceClient(): BinanceClient {
  return new BinanceClient({
    testnet: env.BINANCE_ENV === 'testnet',
    apiKey: env.BINANCE_API_KEY,
    apiSecret: env.BINANCE_API_SECRET,
  });
}