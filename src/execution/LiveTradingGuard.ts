import type { RuntimeProfile } from '../config/modes/types.js';

export interface GuardCheckResult {
  allowed: boolean;
  reason?: string;
}

export class LiveTradingGuard {
  private safeMode = false;
  private safeModeReason?: string;

  public isSafeMode(): boolean {
    return this.safeMode;
  }

  public triggerSafeMode(reason: string): void {
    this.safeMode = true;
    this.safeModeReason = reason;
  }

  public clearSafeMode(): void {
    this.safeMode = false;
    this.safeModeReason = undefined;
  }

  public canExecute(profile: RuntimeProfile): GuardCheckResult {
    if (this.safeMode) {
      return {
        allowed: false,
        reason: `SAFE_MODE_ACTIVE: ${this.safeModeReason || 'System placed in safe mode'}`,
      };
    }

    if (profile.mode === 'live') {
      if (!profile.liveArmed) {
        return {
          allowed: false,
          reason: 'LIVE_TRADING_DISARMED: TRADING_MODE=live requires LIVE_TRADING_ARMED=true',
        };
      }
      if (!profile.realOrders) {
        return {
          allowed: false,
          reason: 'REAL_ORDERS_DISABLED: Operational profile prohibits real orders',
        };
      }
    }

    return { allowed: true };
  }
}
