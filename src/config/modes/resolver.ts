import type { TradingMode, RuntimeProfile } from './types.js';

export interface ModeResolverInput {
  TRADING_MODE?: string;
  LIVE_TRADING_ARMED?: boolean;
  TELEGRAM_ENABLED?: boolean;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  COINDCX_API_KEY?: string;
  COINDCX_API_SECRET?: string;
}

export function resolveRuntimeProfile(input: ModeResolverInput): RuntimeProfile {
  const modeStr = (input.TRADING_MODE || 'paper').toLowerCase().trim();
  const mode: TradingMode = (['paper', 'shadow', 'live'].includes(modeStr) ? modeStr : 'paper') as TradingMode;
  const isArmed = input.LIVE_TRADING_ARMED === true;
  const isTelegramConfigured = Boolean(input.TELEGRAM_ENABLED && input.TELEGRAM_BOT_TOKEN && input.TELEGRAM_CHAT_ID);

  switch (mode) {
    case 'paper':
      return {
        mode: 'paper',
        executionVenue: 'PAPER',
        realOrders: false,
        accountReadOnly: false,
        marketDataPrimary: 'BINANCE',
        marketDataFallback: 'COINDCX',
        failoverEnabled: true,
        reconciliationEnabled: false,
        liveGuardEnabled: false,
        liveArmed: false,
        riskEngineEnabled: true,
        agentEnabled: true,
        telegramEnabled: isTelegramConfigured,
      };

    case 'shadow':
      return {
        mode: 'shadow',
        executionVenue: 'PAPER',
        realOrders: false,
        accountReadOnly: true,
        marketDataPrimary: 'BINANCE',
        marketDataFallback: 'COINDCX',
        failoverEnabled: true,
        reconciliationEnabled: true,
        liveGuardEnabled: true,
        liveArmed: false,
        riskEngineEnabled: true,
        agentEnabled: true,
        telegramEnabled: isTelegramConfigured,
      };

    case 'live':
      return {
        mode: 'live',
        executionVenue: 'COINDCX',
        realOrders: isArmed,
        accountReadOnly: false,
        marketDataPrimary: 'BINANCE',
        marketDataFallback: 'COINDCX',
        failoverEnabled: true,
        reconciliationEnabled: true,
        liveGuardEnabled: true,
        liveArmed: isArmed,
        riskEngineEnabled: true,
        agentEnabled: true,
        telegramEnabled: isTelegramConfigured,
      };
  }
}
