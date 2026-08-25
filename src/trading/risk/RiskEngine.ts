import type { Instrument } from '../../broker/types.js';
import type { TradeSignal } from '../signal/types.js';
import { ExposureCalculator } from './ExposureCalculator.js';
import { PositionSizer } from './PositionSizer.js';
import { DEFAULT_RISK_CONFIG } from './RiskLimits.js';
import type { AccountState, PortfolioPosition, RiskCheckResult, RiskConfig } from './types.js';
import type { ProfitGoalManager } from '../goals/ProfitGoalManager.js';

export interface RiskEngineDeps {
  config?: RiskConfig;
  profitGoalManager?: ProfitGoalManager;
}

export class RiskEngine {
  private config: RiskConfig;
  private profitGoalManager?: ProfitGoalManager;
  
  constructor(deps: RiskEngineDeps = {}) {
    this.config = deps.config ?? DEFAULT_RISK_CONFIG;
    this.profitGoalManager = deps.profitGoalManager;
  }

  validateSignalRisk(
    signal: TradeSignal,
    account: AccountState,
    openPositions: PortfolioPosition[],
    instrument?: Instrument,
    existingSignalKeys = new Set<string>(),
    cooldownSymbols = new Set<string>(),
    timestamp?: number
  ): RiskCheckResult {
    const failures: string[] = [];
    const exposure = ExposureCalculator.calculateExposure(openPositions);

    // Check profit goal restrictions first
    if (this.profitGoalManager) {
      const ts = timestamp ?? Date.now();
      if (!this.profitGoalManager.isTradingAllowed(ts)) {
        failures.push('PROFIT_GOAL_TRADING_HALTED');
      }
    }

    this.checkAccountLimits(account, exposure, signal.symbol, failures, existingSignalKeys, cooldownSymbols);

    // Apply profit goal risk multiplier to position sizing
    const riskMultiplier = this.profitGoalManager?.getCurrentRiskMultiplier() ?? 1.0;
    const adjustedRiskPerTrade = this.config.riskPerTradePct * riskMultiplier;

    const sizeResult = PositionSizer.calculatePositionSize(
      account.equity,
      adjustedRiskPerTrade,
      signal.entryPrice,
      signal.stopLossPrice,
      instrument,
      this.config.defaultLeverage
    );

    if (sizeResult.failureReason) {
      failures.push(sizeResult.failureReason);
    } else if (sizeResult.sizing) {
      this.checkSizingLimits(account, exposure, sizeResult.sizing, failures);
    }

    return {
      approved: failures.length === 0,
      rejectionReasons: failures,
      sizing: sizeResult.sizing,
    };
  }

  private checkAccountLimits(
    account: AccountState,
    exposure: ReturnType<typeof ExposureCalculator.calculateExposure>,
    symbol: string,
    failures: string[],
    existingKeys: Set<string>,
    cooldownSymbols: Set<string>
  ): void {
    if (account.dailyLoss >= account.equity * this.config.maxDailyLossPct) {
      failures.push('DAILY_LOSS_LIMIT_REACHED');
    }
    if (exposure.openPositionsCount >= this.config.maxOpenPositions) {
      failures.push('MAX_OPEN_POSITIONS_REACHED');
    }
    if ((exposure.symbolPositionsCount[symbol] ?? 0) >= this.config.maxPositionsPerSymbol) {
      failures.push('POSITION_ALREADY_OPEN');
    }
    if (cooldownSymbols.has(symbol)) {
      failures.push('COOLDOWN_ACTIVE');
    }
  }

  private checkSizingLimits(
    account: AccountState,
    exposure: ReturnType<typeof ExposureCalculator.calculateExposure>,
    sizing: NonNullable<ReturnType<typeof PositionSizer.calculatePositionSize>['sizing']>,
    failures: string[]
  ): void {
    if (sizing.requiredMargin > account.availableBalance) {
      failures.push('INSUFFICIENT_MARGIN');
    }
    if (exposure.totalRiskAtStop + sizing.riskCapital > account.equity * this.config.maxAccountRiskPct) {
      failures.push('MAX_ACCOUNT_RISK_EXCEEDED');
    }
    if (this.config.maxNotionalPerTrade && sizing.positionNotional > this.config.maxNotionalPerTrade) {
      failures.push('MAX_NOTIONAL_EXCEEDED');
    }
  }
}
