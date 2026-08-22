import type { Instrument } from '../../broker/types.js';
import type { TradeSignal } from '../signal/types.js';
import { ExposureCalculator } from './ExposureCalculator.js';
import { PositionSizer } from './PositionSizer.js';
import { DEFAULT_RISK_CONFIG } from './RiskLimits.js';
import type { AccountState, PortfolioPosition, RiskCheckResult, RiskConfig } from './types.js';

export class RiskEngine {
  private config: RiskConfig;

  constructor(config: RiskConfig = DEFAULT_RISK_CONFIG) {
    this.config = config;
  }

  validateSignalRisk(
    signal: TradeSignal,
    account: AccountState,
    openPositions: PortfolioPosition[],
    instrument?: Instrument,
    existingSignalKeys = new Set<string>(),
    cooldownSymbols = new Set<string>()
  ): RiskCheckResult {
    const failures: string[] = [];
    const exposure = ExposureCalculator.calculateExposure(openPositions);

    this.checkAccountLimits(account, exposure, signal.symbol, failures, existingSignalKeys, cooldownSymbols);

    const sizeResult = PositionSizer.calculatePositionSize(
      account.equity,
      this.config.riskPerTradePct,
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
