/**
 * Correlates a closing fill back to the setup archetype that opened the
 * position it closed.
 *
 * Fill (src/broker/types.ts) carries strategyId and symbol but not the SMC
 * setup archetype (e.g. 'SSL_SWEEP_REVERSAL_LONG') that produced the signal —
 * that classification only exists inside the smc-agent strategy at signal
 * time. Since smc-agent-v1 opens at most one position per symbol at a time,
 * a per-symbol "what setup is currently open" map is enough to attribute the
 * realized PnL of the eventual closing fill to the setup type that opened it,
 * without threading a new field through Signal/Order/Fill.
 *
 * Deliberately in-memory only: losing this map on restart just means the one
 * position open at restart time won't have its outcome attributed to a setup
 * type, which degrades the learning signal for a single trade rather than
 * corrupting it.
 */
export class SetupOutcomeTracker {
  private openSetupBySymbol = new Map<string, string>();

  /** Record which setup archetype opened (or added to) the position for `symbol`. */
  recordOpen(symbol: string, setupType: string): void {
    this.openSetupBySymbol.set(symbol, setupType);
  }

  /**
   * Look up and clear the setup archetype attributed to `symbol`'s position.
   * Call this from the closing fill (realizedPnl !== 0), not the opening one.
   */
  resolveOnClose(symbol: string): string | undefined {
    const setupType = this.openSetupBySymbol.get(symbol);
    this.openSetupBySymbol.delete(symbol);
    return setupType;
  }
}
