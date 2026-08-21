import type {
  TradeNotification,
  PositionUpdateNotification,
  HealthNotification,
} from './types.js';

export interface TelegramConfig {
  enabled: boolean;
  botToken?: string;
  chatId?: string;
  timeoutMs?: number;
}

export class TelegramNotifier {
  private enabled: boolean;
  private botToken?: string;
  private chatId?: string;
  private timeoutMs: number;

  constructor(config: TelegramConfig) {
    this.enabled = config.enabled && Boolean(config.botToken && config.chatId);
    this.botToken = config.botToken;
    this.chatId = config.chatId;
    this.timeoutMs = config.timeoutMs || 5000;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public async send(text: string): Promise<boolean> {
    if (!this.enabled || !this.botToken || !this.chatId) {
      return false;
    }

    try {
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

      return response.ok;
    } catch {
      // Non-blocking: fail quietly without crashing trading runtime
      return false;
    }
  }

  public async notifySystemStartup(mode: string, venue: string, realOrders: boolean, symbols: string[]): Promise<boolean> {
    const icon = realOrders ? '🔴' : '🟢';
    const text = [
      `<b>${icon} TRADING SYSTEM ONLINE</b>`,
      `<b>Mode:</b> ${mode.toUpperCase()}`,
      `<b>Execution:</b> ${venue}`,
      `<b>Real Orders:</b> ${realOrders ? 'YES (ARMED)' : 'NO'}`,
      `<b>Symbols:</b> ${symbols.join(', ')}`,
      `<b>Status:</b> Ready & Active`,
    ].join('\n');
    return this.send(text);
  }

  public async notifyTrade(trade: TradeNotification): Promise<boolean> {
    const icon = trade.side.includes('BUY') || trade.side.includes('LONG') ? '🟢' : '🔴';
    const lines = [
      `<b>${icon} ${trade.mode.toUpperCase()} ORDER FILLED</b>`,
      `<b>Symbol:</b> ${trade.symbol}`,
      `<b>Side:</b> ${trade.side}`,
      `<b>Price:</b> $${trade.price}`,
      `<b>Qty:</b> ${trade.quantity}`,
    ];
    if (trade.stopLoss) lines.push(`<b>SL:</b> $${trade.stopLoss}`);
    if (trade.takeProfit) lines.push(`<b>TP:</b> $${trade.takeProfit}`);
    if (trade.strategyId) lines.push(`<b>Strategy:</b> ${trade.strategyId}`);
    return this.send(lines.join('\n'));
  }

  public async notifyPositionUpdate(update: PositionUpdateNotification): Promise<boolean> {
    const isProfit = update.pnlPct >= 0;
    const icon = isProfit ? '📈' : '📉';
    const lines = [
      `<b>${icon} POSITION UPDATE: ${update.status}</b>`,
      `<b>Symbol:</b> ${update.symbol} (${update.side})`,
      `<b>Entry:</b> $${update.entryPrice} | <b>Current:</b> $${update.currentPrice}`,
      `<b>PnL:</b> ${isProfit ? '+' : ''}${update.pnlPct.toFixed(2)}%`,
    ];
    if (update.reason) lines.push(`<b>Note:</b> ${update.reason}`);
    return this.send(lines.join('\n'));
  }

  public async notifyHealth(health: HealthNotification): Promise<boolean> {
    const isHealthy = health.status === 'HEALTHY' || health.status === 'RECOVERED';
    const icon = isHealthy ? '🟢' : '⚠️';
    const lines = [
      `<b>${icon} MARKET DATA: ${health.provider}</b>`,
      `<b>Status:</b> ${health.status}`,
    ];
    if (health.reason) lines.push(`<b>Reason:</b> ${health.reason}`);
    if (health.actionTaken) lines.push(`<b>Action:</b> ${health.actionTaken}`);
    return this.send(lines.join('\n'));
  }

  public async notifyEmergency(title: string, message: string): Promise<boolean> {
    const lines = [
      `<b>🚨 CRITICAL ALERT: ${title}</b>`,
      `<b>Message:</b> ${message}`,
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
      `<b>${icon} ${incident.severity} — ${incident.component}</b>`,
      `<b>Error:</b> ${incident.message.slice(0, 200)}`,
    ];
    if (incident.provider) lines.push(`<b>Provider:</b> ${incident.provider}`);
    if (incident.symbol) lines.push(`<b>Symbol:</b> ${incident.symbol}`);
    if (incident.actionTaken) lines.push(`<b>Action:</b> ${incident.actionTaken}`);
    lines.push(`<b>Incident ID:</b> <code>${incident.incidentId}</code>`);
    return this.send(lines.join('\n'));
  }

  public async notifyRecovery(recovery: {
    component: string;
    provider?: string;
    downtimeMs?: number;
    message: string;
  }): Promise<boolean> {
    const lines = [
      `<b>🟢 RECOVERED — ${recovery.component}</b>`,
      `<b>Status:</b> ${recovery.message}`,
    ];
    if (recovery.provider) lines.push(`<b>Provider:</b> ${recovery.provider}`);
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
      `<b>Mode:</b> ${heartbeat.mode.toUpperCase()} (${heartbeat.armed ? 'ARMED' : 'SIMULATED'})`,
      `<b>Open Positions:</b> ${heartbeat.positionsCount}`,
      `<b>Open Orders:</b> ${heartbeat.openOrdersCount}`,
      `<b>Equity:</b> $${heartbeat.equity.toFixed(2)}`,
      `<b>Realized PnL:</b> $${heartbeat.realizedPnl.toFixed(2)}`,
      `<b>Risk Status:</b> NORMAL`,
    ];
    return this.send(lines.join('\n'));
  }
}
