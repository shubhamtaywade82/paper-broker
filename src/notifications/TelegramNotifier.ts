import type {
  TradeNotification,
  PositionUpdateNotification,
  HealthNotification,
} from './types.js';
import { logger } from '../telemetry/logger.js';

import { TokenBucket } from './TelegramLimiter.js';

export interface TelegramConfig {
  enabled: boolean;
  botToken?: string;
  chatId?: string;
  timeoutMs?: number;
  /** Minimum gap enforced between outbound sends (H-10). Default 1100ms, just over Telegram's documented ~1 msg/sec/chat guidance. */
  minSendIntervalMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export class TelegramNotifier {
  private enabled: boolean;
  private botToken?: string;
  private chatId?: string;
  private timeoutMs: number;
  private readonly minSendIntervalMs: number;
  private tokenBucket = new TokenBucket(20, 0.5);
  private sendQueue: Promise<void> = Promise.resolve();
  private lastSendAt = 0;

  constructor(config: TelegramConfig) {
    this.enabled = config.enabled && Boolean(config.botToken && config.chatId);
    this.botToken = config.botToken;
    this.chatId = config.chatId;
    this.timeoutMs = config.timeoutMs || 5000;
    this.minSendIntervalMs = config.minSendIntervalMs ?? 1100;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public async send(text: string): Promise<boolean> {
    if (!this.enabled || !this.botToken || !this.chatId) {
      return false;
    }

    if (!this.tokenBucket.tryTake()) {
      logger.warn({ chatId: this.chatId }, '[TelegramNotifier] rate limit bucket exhausted, dropping notification');
      return false;
    }

    let result = false;
    // Chain onto the shared queue rather than racing the fetch directly, so
    // this call waits for prior in-flight/queued sends and then respects
    // minSendIntervalMs relative to the last one that actually went out.
    const task = this.sendQueue.then(async () => {
      const waitMs = this.lastSendAt + this.minSendIntervalMs - Date.now();
      if (waitMs > 0) await sleep(waitMs);
      this.lastSendAt = Date.now();
      result = await this.doSend(text);
    });
    // Keep the queue alive even if this send failed — a caught, logged
    // failure here must not permanently wedge every future notification.
    this.sendQueue = task.catch(() => undefined);
    await this.sendQueue;
    return result;
  }

  private async doSend(text: string): Promise<boolean> {
    try {
      // H-09: the bot token must live in the URL path — that's Telegram Bot
      // API's request format, not something we can avoid — but the URL
      // itself (and therefore the token) must never be logged. Only
      // chatId/status/error are logged below, never `url`.
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          parse_mode: 'HTML',
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        let retryAfterSec: number | undefined;
        try {
          const body = (await response.json()) as { parameters?: { retry_after?: number }; description?: string };
          retryAfterSec = body.parameters?.retry_after;
          logger.warn(
            { status: response.status, chatId: this.chatId, description: body.description, retryAfterSec },
            '[TelegramNotifier] send failed'
          );
        } catch {
          logger.warn({ status: response.status, chatId: this.chatId }, '[TelegramNotifier] send failed');
        }
        if (response.status === 429 && retryAfterSec) {
          // Respect Telegram's own backpressure signal for the *next* send.
          this.lastSendAt = Date.now() + retryAfterSec * 1000 - this.minSendIntervalMs;
        }
        return false;
      }

      return true;
    } catch (err) {
      // Non-blocking: fail quietly without crashing trading runtime, but
      // surface it in logs (previously fully silent — see the "silent
      // notification failures" finding) without ever logging `err` raw,
      // since some network error messages/causes can embed the request URL.
      logger.warn(
        { chatId: this.chatId, error: err instanceof Error ? err.message.replace(this.botToken ?? '', '***') : 'unknown error' },
        '[TelegramNotifier] send threw'
      );
      return false;
    }
  }

  public async notifySystemStartup(mode: string, venue: string, realOrders: boolean, symbols: string[]): Promise<boolean> {
    const icon = realOrders ? '🔴' : '🟢';
    const text = [
      `<b>${icon} TRADING SYSTEM ONLINE</b>`,
      `<b>Mode:</b> ${esc(mode.toUpperCase())}`,
      `<b>Execution:</b> ${esc(venue)}`,
      `<b>Real Orders:</b> ${realOrders ? 'YES (ARMED)' : 'NO'}`,
      `<b>Symbols:</b> ${esc(symbols.join(', '))}`,
      `<b>Status:</b> Ready & Active`,
    ].join('\n');
    return this.send(text);
  }

  public async notifyTrade(trade: TradeNotification): Promise<boolean> {
    const icon = trade.side.includes('BUY') || trade.side.includes('LONG') ? '🟢' : '🔴';
    const lines = [
      `<b>${icon} ${esc(trade.mode.toUpperCase())} ORDER FILLED</b>`,
      `<b>Symbol:</b> ${esc(trade.symbol)}`,
      `<b>Side:</b> ${esc(trade.side)}`,
      `<b>Price:</b> $${trade.price}`,
      `<b>Qty:</b> ${trade.quantity}`,
    ];
    if (trade.stopLoss) lines.push(`<b>SL:</b> $${trade.stopLoss}`);
    if (trade.takeProfit) lines.push(`<b>TP:</b> $${trade.takeProfit}`);
    if (trade.strategyId) lines.push(`<b>Strategy:</b> ${esc(trade.strategyId)}`);
    return this.send(lines.join('\n'));
  }

  public async notifyPositionUpdate(update: PositionUpdateNotification): Promise<boolean> {
    const isProfit = update.pnlPct >= 0;
    const icon = isProfit ? '📈' : '📉';
    const lines = [
      `<b>${icon} POSITION UPDATE: ${esc(update.status)}</b>`,
      `<b>Symbol:</b> ${esc(update.symbol)} (${esc(update.side)})`,
      `<b>Entry:</b> $${update.entryPrice} | <b>Current:</b> $${update.currentPrice}`,
      `<b>PnL:</b> ${isProfit ? '+' : ''}${update.pnlPct.toFixed(2)}%`,
    ];
    if (update.reason) lines.push(`<b>Note:</b> ${esc(update.reason)}`);
    return this.send(lines.join('\n'));
  }

  public async notifyHealth(health: HealthNotification): Promise<boolean> {
    const isHealthy = health.status === 'HEALTHY' || health.status === 'RECOVERED';
    const icon = isHealthy ? '🟢' : '⚠️';
    const lines = [
      `<b>${icon} MARKET DATA: ${esc(health.provider)}</b>`,
      `<b>Status:</b> ${esc(health.status)}`,
    ];
    if (health.reason) lines.push(`<b>Reason:</b> ${esc(health.reason)}`);
    if (health.actionTaken) lines.push(`<b>Action:</b> ${esc(health.actionTaken)}`);
    return this.send(lines.join('\n'));
  }

  public async notifyEmergency(title: string, message: string): Promise<boolean> {
    const lines = [
      `<b>🚨 CRITICAL ALERT: ${esc(title)}</b>`,
      `<b>Message:</b> ${esc(message)}`,
      `<b>Time:</b> ${new Date().toISOString()}`,
    ];
    return this.send(lines.join('\n'));
  }

  public async notifyIncident(incident: {
    incidentId: string;
    severity: string;
    classification: string;
    component: string;
    provider?: string;
    symbol?: string;
    message: string;
    actionTaken?: string;
  }): Promise<boolean> {
    const icon = incident.severity === 'FATAL' || incident.severity === 'CRITICAL' ? '🔴' : '🟠';
    const lines = [
      `<b>${icon} ${esc(incident.severity)} — ${esc(incident.component)}</b>`,
      `<b>Error:</b> ${esc(incident.message.slice(0, 200))}`,
    ];
    if (incident.provider) lines.push(`<b>Provider:</b> ${esc(incident.provider)}`);
    if (incident.symbol) lines.push(`<b>Symbol:</b> ${esc(incident.symbol)}`);
    if (incident.actionTaken) lines.push(`<b>Action:</b> ${esc(incident.actionTaken)}`);
    lines.push(`<b>Incident ID:</b> <code>${esc(incident.incidentId)}</code>`);
    return this.send(lines.join('\n'));
  }

  public async notifyRecovery(recovery: {
    component: string;
    provider?: string;
    downtimeMs?: number;
    message: string;
  }): Promise<boolean> {
    const lines = [
      `<b>🟢 RECOVERED — ${esc(recovery.component)}</b>`,
      `<b>Status:</b> ${esc(recovery.message)}`,
    ];
    if (recovery.provider) lines.push(`<b>Provider:</b> ${esc(recovery.provider)}`);
    if (recovery.downtimeMs) {
      lines.push(`<b>Downtime:</b> ${(recovery.downtimeMs / 1000).toFixed(1)}s`);
    }
    return this.send(lines.join('\n'));
  }

  public async notifyHeartbeat(heartbeat: {
    mode: string;
    armed: boolean;
    positionsCount: number;
    openOrdersCount: number;
    equity: number;
    realizedPnl: number;
  }): Promise<boolean> {
    const lines = [
      `<b>💚 SYSTEM HEARTBEAT</b>`,
      `<b>Mode:</b> ${esc(heartbeat.mode.toUpperCase())} (${heartbeat.armed ? 'ARMED' : 'SIMULATED'})`,
      `<b>Open Positions:</b> ${heartbeat.positionsCount}`,
      `<b>Open Orders:</b> ${heartbeat.openOrdersCount}`,
      `<b>Equity:</b> $${heartbeat.equity.toFixed(2)}`,
      `<b>Realized PnL:</b> $${heartbeat.realizedPnl.toFixed(2)}`,
      `<b>Risk Status:</b> NORMAL`,
    ];
    return this.send(lines.join('\n'));
  }
}
