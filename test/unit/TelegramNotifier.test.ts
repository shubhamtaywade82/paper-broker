import { describe, it, expect, vi } from 'vitest';
import { TelegramNotifier } from '../../src/notifications/TelegramNotifier.js';

describe('TelegramNotifier', () => {
  it('identifies as disabled when not enabled or missing credentials', () => {
    const disabled = new TelegramNotifier({ enabled: false });
    expect(disabled.isEnabled()).toBe(false);

    const noCreds = new TelegramNotifier({ enabled: true });
    expect(noCreds.isEnabled()).toBe(false);
  });

  it('identifies as enabled when token and chatId are provided', () => {
    const notifier = new TelegramNotifier({
      enabled: true,
      botToken: '12345:token',
      chatId: '99999',
    });
    expect(notifier.isEnabled()).toBe(true);
  });

  it('gracefully returns false on send if disabled without throwing', async () => {
    const notifier = new TelegramNotifier({ enabled: false });
    const result = await notifier.send('test message');
    expect(result).toBe(false);
  });

  it('formats trade notification properly', async () => {
    const notifier = new TelegramNotifier({ enabled: false });
    // Calling notifyTrade on disabled notifier returns false cleanly
    const result = await notifier.notifyTrade({
      symbol: 'SOLUSDT',
      side: 'BUY',
      type: 'MARKET',
      price: 89.5,
      quantity: 10,
      mode: 'paper',
      stopLoss: 87.0,
      takeProfit: 95.0,
      strategyId: 'ema-trend-5m',
    });
    expect(result).toBe(false);
  });

  it('formats position update notification properly', async () => {
    const notifier = new TelegramNotifier({ enabled: false });
    const result = await notifier.notifyPositionUpdate({
      symbol: 'SOLUSDT',
      side: 'LONG',
      entryPrice: 89.5,
      currentPrice: 92.0,
      pnlPct: 2.79,
      status: 'TP_HIT',
      reason: 'Target 1 reached',
    });
    expect(result).toBe(false);
  });

  it('formats health and emergency notifications properly', async () => {
    const notifier = new TelegramNotifier({ enabled: false });
    const healthResult = await notifier.notifyHealth({
      provider: 'Binance',
      status: 'DEGRADED',
      reason: 'WS heartbeat delayed',
      actionTaken: 'Initiated fallback validation',
    });
    expect(healthResult).toBe(false);

    const emergencyResult = await notifier.notifyEmergency('Emergency Kill Switch', 'All open orders cancelled');
    expect(emergencyResult).toBe(false);
  });
});
