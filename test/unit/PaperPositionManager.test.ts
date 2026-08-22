import { describe, it, expect } from 'vitest';
import { PaperPositionManager } from '../../src/broker/paper/PaperPositionManager.js';
import type { PaperFill } from '../../src/broker/paper/types.js';

describe('Phase 8 — Paper Position Manager', () => {
  it('opens isolated position and manages mark price and unrealized PnL', () => {
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
    expect(pos.state).toBe('OPEN');
    expect(pos.initialMargin).toBe(1000); // 50 * 100 / 5 = 1000
    expect(pos.remainingQuantity).toBe(50.0);

    PaperPositionManager.updateMarkPrice(pos, 104.0);
    expect(pos.unrealizedPnl).toBe(200); // (104 - 100) * 50 = 200
    expect(pos.highestPriceReached).toBe(104.0);
  });

  it('applies partial close and computes realized PnL correctly', () => {
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
    const exitFill: PaperFill = {
      id: 'F2',
      orderId: 'O2',
      clientOrderId: 'C2',
      symbol: 'SOLUSDT',
      side: 'SELL',
      price: 105.0,
      quantity: 16.5,
      fee: 0.35,
      slippage: 0,
      isMaker: true,
      timestamp: 2000,
    };

    const res = PaperPositionManager.applyPartialClose(pos, exitFill);
    // Gross = (105 - 100) * 16.5 = 82.5
    expect(res.realizedGross).toBe(82.5);
    expect(pos.remainingQuantity).toBe(33.5);
    expect(pos.state).toBe('OPEN');
  });

  it('moves stop to breakeven without loosening', () => {
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
    const moved = PaperPositionManager.moveStopToBreakeven(pos, 2, 0.01);

    expect(moved).toBe(true);
    expect(pos.stopLossPrice).toBe(100.02);
    expect(pos.lifecycle).toBe('STOP_MOVED_TO_BREAKEVEN');
  });
});
