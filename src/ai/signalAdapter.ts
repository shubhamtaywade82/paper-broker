import type { OrderIntent } from './schemas.js';
import type { SignalInput } from '../strategy/signal.js';
import { parseSignalInput } from '../strategy/signal.js';

export interface SignalAdapterConfig {
  strategyId: string;
}

export class SignalAdapter {
  private config: SignalAdapterConfig;

  constructor(config: SignalAdapterConfig) {
    this.config = config;
  }

  toSignalInput(intent: OrderIntent): SignalInput {
    return parseSignalInput({
      strategyId: this.config.strategyId,
      symbol: intent.symbol,
      action: intent.action,
      confidence: intent.confidence,
      stopLossPrice: intent.stopLossPrice,
      takeProfitPrice: intent.takeProfitPrice,
      reasoning: intent.reasoning,
      ttlMs: 60_000,
      features: {},
    });
  }
}