import type { Position, AccountState } from '../broker/types.js';
import type { RegimeSnapshot } from '../analysis/MarketRegimeDetector.js';
import type { TradePlan } from '../risk/AdaptiveRiskManager.js';
import type { SetupCandidate } from '../market/setup/types.js';

/**
 * The agent's high-level state machine.
 *
 * - `monitoring` — surveying symbols for forming/ready setups.
 * - `seeking_entry` — a setup has crossed READY + LTF trigger aligned; the
 *   next cycle will attempt entry.
 * - `in_position` — at least one position is open for this symbol; the agent
 *   focuses on whether to add / stand aside / let trailing stops manage it.
 * - `stand_aside` — regime is TRANSITIONING or risk budget exhausted.
 */
export type AgentState = 'monitoring' | 'seeking_entry' | 'in_position' | 'stand_aside';

export interface PerSymbolState {
  symbol: string;
  state: AgentState;
  regime: RegimeSnapshot | null;
  /** Timestamp (ms) of the last regime change for this symbol. */
  regimeChangedAt: number;
  /** Timestamp (ms) of the last entry attempt on this symbol — used for cooldown. */
  lastEntryAttemptAt: number;
  /** Most recent forming setup we're tracking (for re-evaluation next cycle). */
  trackingSetup: SetupCandidate | null;
  /** Most recent plan we built for the tracked setup. */
  trackingPlan: TradePlan | null;
  /** Consecutive regime observations — used for confirmation gating. */
  regimeObservationCount: number;
}

export interface AutonomousCycleSummary {
  cycleId: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  symbolsScanned: number;
  regimesChanged: number;
  formingSetups: number;
  readySetups: number;
  signalsSubmitted: number;
  signalsRejected: number;
  standingAsideSymbols: number;
  /** Compact per-symbol decisions, for the WebSocket dashboard. */
  decisions: Array<{
    symbol: string;
    state: AgentState;
    regime: string | null;
    setupState: string | null;
    setupType: string | null;
    confluenceScore: number | null;
    action: 'ENTRY_SUBMITTED' | 'REJECTED' | 'STAND_ASIDE' | 'MONITOR' | 'IN_POSITION';
    reason: string;
  }>;
}

/** What the agent hands back to its caller when a signal is submitted. */
export interface AutonomousSignalRecord {
  symbol: string;
  action: 'OPEN_LONG' | 'OPEN_SHORT' | 'CLOSE_LONG' | 'CLOSE_SHORT';
  confidence: number;
  regime: string;
  setupType: string;
  confluenceScore: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  leverage: number;
  sizePct: number;
  rr: number;
  rationale: string;
  submittedAt: number;
}
