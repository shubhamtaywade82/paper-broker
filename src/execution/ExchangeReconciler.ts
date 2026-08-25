/**
 * Exchange State Reconciliation
 *
 * CONTRACTS.md Section 6 requires reconciliation with exchange state after
 * startup, reconnect, a timeout on a write, and provider recovery, and requires
 * that unknown order state blocks duplicate submission. Nothing implemented it.
 *
 * Without this, a live deployment that restarts mid-session believes it has no
 * positions — because local state is rebuilt from an empty ledger — while the
 * venue still holds them. The next signal then opens a *second* position on top
 * of the first, and every risk calculation downstream is computed against a
 * position size that does not exist.
 *
 * The reconciler compares venue truth against local belief and, on any material
 * discrepancy, trips `LiveTradingGuard` into safe mode. `ExecutionRouter`
 * consults the guard on every submission, so tripping it halts order flow
 * immediately. Clearing safe mode is deliberately an operator action: the
 * system cannot know which side was right.
 *
 * Known limitation: `CoinDCXBroker.getOpenOrders()` returns its own in-memory
 * order map rather than querying the venue, so order-level reconciliation is
 * only meaningful within a single process lifetime. Position reconciliation —
 * the part that matters for double-entry — does query the venue. This is
 * recorded in KNOWN_LIMITATIONS.md.
 */

import type { ExecutionBroker, Position } from '../broker/types.js';
import type { LiveTradingGuard } from './LiveTradingGuard.js';
import { logger } from '../telemetry/logger.js';
import { metrics } from '../telemetry/metrics.js';

export type ReconciliationTrigger =
  | 'STARTUP'
  | 'RECONNECT'
  | 'WRITE_TIMEOUT'
  | 'PROVIDER_RECOVERY'
  | 'MANUAL';

export interface PositionDiscrepancy {
  symbol: string;
  localQty: number;
  venueQty: number;
  difference: number;
  kind: 'MISSING_LOCALLY' | 'MISSING_AT_VENUE' | 'QUANTITY_MISMATCH';
}

export interface ReconciliationReport {
  trigger: ReconciliationTrigger;
  reconciledAtUtc: string;
  ok: boolean;
  positionDiscrepancies: PositionDiscrepancy[];
  localPositionCount: number;
  venuePositionCount: number;
  /** Set when the venue could not be reached; treated as a failure, not a pass. */
  error?: string;
  safeModeTripped: boolean;
}

export interface ExchangeReconcilerDeps {
  /** Authoritative source — the live venue. */
  venue: ExecutionBroker;
  /** What this process believes it holds. */
  local: ExecutionBroker;
  guard: LiveTradingGuard;
  /**
   * Absolute quantity difference tolerated before a symbol counts as
   * discrepant. Defaults to 0 — any difference in a live position matters.
   */
  quantityTolerance?: number;
  onReport?: (report: ReconciliationReport) => void;
}

function indexBySymbol(positions: Position[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const position of positions) {
    if (position.qty === 0) continue;
    map.set(position.symbol, (map.get(position.symbol) ?? 0) + position.qty);
  }
  return map;
}

export class ExchangeReconciler {
  private venue: ExecutionBroker;
  private local: ExecutionBroker;
  private guard: LiveTradingGuard;
  private quantityTolerance: number;
  private onReport?: (report: ReconciliationReport) => void;
  private lastReport?: ReconciliationReport;

  constructor(deps: ExchangeReconcilerDeps) {
    this.venue = deps.venue;
    this.local = deps.local;
    this.guard = deps.guard;
    this.quantityTolerance = deps.quantityTolerance ?? 0;
    this.onReport = deps.onReport;
  }

  getLastReport(): ReconciliationReport | undefined {
    return this.lastReport;
  }

  /**
   * Compare venue state against local state.
   *
   * A venue call that throws is a FAILURE, not a pass: not knowing the exchange
   * state is exactly the condition the contract says must block submission.
   */
  async reconcile(trigger: ReconciliationTrigger): Promise<ReconciliationReport> {
    const reconciledAtUtc = new Date().toISOString();
    metrics.inc('reconciliations_total');

    let venuePositions: Position[];
    let localPositions: Position[];

    try {
      [venuePositions, localPositions] = await Promise.all([
        Promise.resolve(this.venue.getPositions()),
        Promise.resolve(this.local.getPositions()),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const reason = `RECONCILIATION_FAILED (${trigger}): could not read exchange state — ${message}`;
      this.guard.triggerSafeMode(reason);
      metrics.inc('reconciliation_failures_total');

      const report: ReconciliationReport = {
        trigger,
        reconciledAtUtc,
        ok: false,
        positionDiscrepancies: [],
        localPositionCount: 0,
        venuePositionCount: 0,
        error: message,
        safeModeTripped: true,
      };
      logger.error({ trigger, error: message }, '[Reconciler] Exchange state unreadable — safe mode engaged');
      this.publish(report);
      return report;
    }

    const venueBySymbol = indexBySymbol(venuePositions);
    const localBySymbol = indexBySymbol(localPositions);
    const symbols = new Set([...venueBySymbol.keys(), ...localBySymbol.keys()]);

    const positionDiscrepancies: PositionDiscrepancy[] = [];
    for (const symbol of symbols) {
      const venueQty = venueBySymbol.get(symbol) ?? 0;
      const localQty = localBySymbol.get(symbol) ?? 0;
      const difference = venueQty - localQty;

      if (Math.abs(difference) <= this.quantityTolerance) continue;

      const kind: PositionDiscrepancy['kind'] =
        localQty === 0 ? 'MISSING_LOCALLY' : venueQty === 0 ? 'MISSING_AT_VENUE' : 'QUANTITY_MISMATCH';

      positionDiscrepancies.push({ symbol, localQty, venueQty, difference, kind });
    }

    const ok = positionDiscrepancies.length === 0;
    let safeModeTripped = false;

    if (!ok) {
      const summary = positionDiscrepancies
        .map((d) => `${d.symbol}: local ${d.localQty} vs venue ${d.venueQty} (${d.kind})`)
        .join('; ');
      this.guard.triggerSafeMode(`RECONCILIATION_MISMATCH (${trigger}): ${summary}`);
      safeModeTripped = true;
      metrics.inc('reconciliation_mismatches_total');
      logger.error({ trigger, positionDiscrepancies }, '[Reconciler] Position mismatch — safe mode engaged');
    } else {
      logger.info(
        { trigger, positions: venueBySymbol.size },
        '[Reconciler] Exchange state matches local state'
      );
    }

    const report: ReconciliationReport = {
      trigger,
      reconciledAtUtc,
      ok,
      positionDiscrepancies,
      localPositionCount: localBySymbol.size,
      venuePositionCount: venueBySymbol.size,
      safeModeTripped,
    };
    this.publish(report);
    return report;
  }

  /**
   * Operator recovery: re-run reconciliation and, only if it comes back clean,
   * clear safe mode. Never clears on a failed or mismatched run.
   */
  async reconcileAndResume(trigger: ReconciliationTrigger = 'MANUAL'): Promise<ReconciliationReport> {
    const report = await this.reconcile(trigger);
    if (report.ok) {
      this.guard.clearSafeMode();
      logger.info({ trigger }, '[Reconciler] Safe mode cleared after clean reconciliation');
    }
    return report;
  }

  private publish(report: ReconciliationReport): void {
    this.lastReport = report;
    try {
      this.onReport?.(report);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : error },
        '[Reconciler] Report listener threw'
      );
    }
  }
}
