import type { Strategy } from '../StrategyEngine.js';
import { ema, atr, rsi } from '../indicators.js';
import type { OllamaSignalGenerator } from '../../ai/ollama.js';

export interface OllamaTrendStrategyOptions {
  generator: OllamaSignalGenerator;
  symbols: string[];
  cooldownMs?: number;
  enabled?: boolean;
}

export function createOllamaTrendStrategy(options: OllamaTrendStrategyOptions): Strategy {
  let lastSignalAt = 0;

  return {
    id: 'ollama-trend-5m',
    name: 'Ollama Trend (5m)',
    enabled: options.enabled ?? true,
    symbols: options.symbols,
    intervals: ['5m'],
    priority: 40,
    cooldownMs: options.cooldownMs ?? 300_000,

    onCandleClose: async (ctx, candle) => {
      const now = Date.now();
      if (now - lastSignalAt < (options.cooldownMs ?? 300_000)) return null;

      const candles = ctx.getCandles(candle.symbol, '5m', 40);
      if (candles.length < 30) return null;

      const closes = candles.map((c) => c.close);
      const emaFast = ema(closes, 9);
      const emaSlow = ema(closes, 21);
      const atrValues = atr(candles, 14);
      const rsiValues = rsi(closes, 14);

      const last = closes[closes.length - 1];
      const fast = emaFast[emaFast.length - 1];
      const slow = emaSlow[emaSlow.length - 1];
      const atrNow = atrValues[atrValues.length - 1];
      const rsiNow = rsiValues[rsiValues.length - 1];

      if (
        last === undefined ||
        fast === undefined ||
        slow === undefined ||
        atrNow === undefined ||
        rsiNow === undefined
      ) {
        return null;
      }

      const position = ctx.getPosition(candle.symbol);
      const account = ctx.getAccount();

      const candlesSummary = candles
        .slice(-20)
        .map((c) => `O:${c.open} H:${c.high} L:${c.low} C:${c.close} V:${c.volume}`)
        .join('\n');

      const accountSummary = [
        `equity: ${account.equity.toFixed(2)}`,
        `available: ${account.availableBalance.toFixed(2)}`,
        `position: ${position ? `${position.qty} @ ${position.entryPrice}` : 'flat'}`,
        `indicators: ema9=${fast.toFixed(2)} ema21=${slow.toFixed(2)} atr14=${atrNow.toFixed(2)} rsi14=${rsiNow.toFixed(2)}`,
      ].join('\n');

      try {
        const intent = await options.generator.generateSignal({
          symbol: candle.symbol,
          candlesSummary,
          accountSummary,
        });

        lastSignalAt = Date.now();

        if (intent.action === 'HOLD') return null;

        return {
          strategyId: 'ollama-trend-5m',
          symbol: intent.symbol,
          action: intent.action,
          confidence: intent.confidence,
          stopLossPrice: intent.stopLossPrice,
          takeProfitPrice: intent.takeProfitPrice,
          reasoning: intent.reasoning,
          ttlMs: 60_000,
          features: { emaFast: fast, emaSlow: slow, atr: atrNow, rsi: rsiNow },
        };
      } catch (error) {
        console.error(`[OllamaTrend] Generate failed for ${candle.symbol}:`, error);
        return null;
      }
    },
  };
}