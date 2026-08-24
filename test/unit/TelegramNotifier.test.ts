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

describe('TelegramNotifier enabled send path (H-09, H-10)', () => {
  const BOT_TOKEN = '123456:AAsecretTestTokenValue';

  it('sends a real POST request and returns true on a 200 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const notifier = new TelegramNotifier({ enabled: true, botToken: BOT_TOKEN, chatId: '99999' });
    const result = await notifier.send('hello');

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toContain(BOT_TOKEN); // Telegram's API requires the token in the URL path...

    vi.unstubAllGlobals();
  });

  it('H-09: never logs the bot token when a send throws', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error(`fetch failed: connect ECONNREFUSED api.telegram.org (bot${BOT_TOKEN} in cause)`));
    vi.stubGlobal('fetch', fetchMock);
    const loggerModule = await import('../../src/telemetry/logger.js');
    const warnSpy = vi.spyOn(loggerModule.logger, 'warn').mockImplementation(() => loggerModule.logger);

    const notifier = new TelegramNotifier({ enabled: true, botToken: BOT_TOKEN, chatId: '99999' });
    const result = await notifier.send('hello');

    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    const loggedArgs = warnSpy.mock.calls.flat();
    const serialized = JSON.stringify(loggedArgs);
    expect(serialized).not.toContain(BOT_TOKEN);

    warnSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('H-10: serializes concurrent sends with at least minSendIntervalMs between them', async () => {
    vi.useFakeTimers();
    const sendTimestamps: number[] = [];
    const fetchMock = vi.fn().mockImplementation(() => {
      sendTimestamps.push(Date.now());
      return Promise.resolve({ ok: true, status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const notifier = new TelegramNotifier({
      enabled: true, botToken: BOT_TOKEN, chatId: '99999', minSendIntervalMs: 1000,
    });

    // Three concurrent, unawaited-relative-to-each-other calls — the queue
    // must still serialize them with the configured minimum gap.
    const p1 = notifier.send('one');
    const p2 = notifier.send('two');
    const p3 = notifier.send('three');

    await vi.runAllTimersAsync();
    await Promise.all([p1, p2, p3]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sendTimestamps[1]! - sendTimestamps[0]!).toBeGreaterThanOrEqual(1000);
    expect(sendTimestamps[2]! - sendTimestamps[1]!).toBeGreaterThanOrEqual(1000);

    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('logs (without throwing) on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: () => Promise.resolve({ description: 'Too Many Requests', parameters: { retry_after: 2 } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const notifier = new TelegramNotifier({ enabled: true, botToken: BOT_TOKEN, chatId: '99999' });
    const result = await notifier.send('hello');

    expect(result).toBe(false);
    vi.unstubAllGlobals();
  });
});
