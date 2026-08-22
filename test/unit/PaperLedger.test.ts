import { describe, it, expect } from 'vitest';
import { PaperLedger } from '../../src/broker/paper/PaperLedger.js';
import { PaperPositionManager } from '../../src/broker/paper/PaperPositionManager.js';
import type { PaperFill } from '../../src/broker/paper/types.js';

describe('Phase 8 — Paper Ledger', () => {
  it('records trade lifecycle, MFE, MAE and finalizes trade record', () => {
    const ledger = new PaperLedger();
    const entryFill: PaperFill = {
      id: 'F1',
      orderId: 'O1',
      clientOrderId: 'C1',
      symbol: 'SOLUSDT',
      side: 'BUY',
      price: 100.0,
      quantity: 50.0,
      fee: 1.0,
      slippage: 0,
      isMaker: true,
      timestamp: 1000,
    };

    const pos = PaperPositionManager.openPosition(entryFill, 'LONG', 5, 95.0, [105, 110, 115], 'k1', 's1', 'p1');
    ledger.recordTradeOpen(pos, 2.0, 'SIG:1', 'SSL_SWEEP_REVERSAL_LONG');

    PaperPositionManager.updateMarkPrice(pos, 106.0);
    ledger.updateTradeProgress(pos);

    const record = ledger.getRecord(`TRD:${pos.id}`);
    expect(record).toBeDefined();
    expect(record?.maxFavorableExcursion).toBe(6.0);
    expect(record?.maxAdverseExcursion).toBe(0);

    const exitFill: PaperFill = {
      id: 'F2',
      orderId: 'O2',
      clientOrderId: 'C2',
      symbol: 'SOLUSDT',
      side: 'SELL',
      price: 106.0,
      quantity: 50.0,
      fee: 1.06,
      slippage: 0,
      isMaker: true,
      timestamp: 2000,
    };
    PaperPositionManager.applyPartialClose(pos, exitFill);
    const finalized = ledger.finalizeTrade(pos, 106.0, 'TP_FULL', 2000);

    expect(finalized?.status).toBe('CLOSED');
    expect(finalized?.grossPnl).toBe(300.0); // (106 - 100) * 50 = 300
    expect(finalized?.realizedRiskReward).toBe(1.2); // 6 / 5 = 1.2R
  });
});
