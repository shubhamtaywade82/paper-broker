import type { Instrument } from '../broker/types.js';
import type { ExecutionPlan } from '../market/execution/types.js';
import { RiskEngine } from './risk/RiskEngine.js';
import type { AccountState, PortfolioPosition, RiskConfig } from './risk/types.js';
import { SignalEngine } from './signal/SignalEngine.js';
import type { TradeSignal } from './signal/types.js';

export class TradeIntentEngine {
  private riskEngine: RiskEngine;
  private activeSignalKeys = new Set<string>();
  private cooldownSymbols = new Set<string>();

  constructor(riskConfig?: RiskConfig) {
    this.riskEngine = new RiskEngine(riskConfig);
  }

  processExecutionPlan(
    plan: ExecutionPlan,
    account: AccountState,
    openPositions: PortfolioPosition[] = [],
    instrument?: Instrument,
    asOf = Date.now()
  ): TradeSignal {
    const rawSignal = SignalEngine.translatePlan(plan, asOf);

    if (rawSignal.status === 'AVOID') {
      return rawSignal;
    }

    if (this.activeSignalKeys.has(rawSignal.signalKey)) {
      return {
        ...rawSignal,
        status: 'AVOID',
        riskRejectionReasons: ['DUPLICATE_SIGNAL'],
      };
    }

    const riskResult = this.riskEngine.validateSignalRisk(
      rawSignal,
      account,
      openPositions,
      instrument,
      this.activeSignalKeys,
      this.cooldownSymbols
    );

    if (riskResult.approved && riskResult.sizing) {
      this.activeSignalKeys.add(rawSignal.signalKey);
      return {
        ...rawSignal,
        status: 'PAPER_READY',
        sizing: riskResult.sizing,
        riskRejectionReasons: [],
      };
    }

    return {
      ...rawSignal,
      status: 'RISK_REJECTED',
      sizing: riskResult.sizing,
      riskRejectionReasons: riskResult.rejectionReasons,
    };
  }

  setCooldown(symbol: string): void {
    this.cooldownSymbols.add(symbol);
  }

  clearCooldown(symbol: string): void {
    this.cooldownSymbols.delete(symbol);
  }

  clearActiveSignals(): void {
    this.activeSignalKeys.clear();
  }
}
