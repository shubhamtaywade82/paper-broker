import type { PaperPosition, PaperTradeRecord } from './types.js';

export class PaperLedger {
  private records: Map<string, PaperTradeRecord> = new Map();

  recordTradeOpen(pos: PaperPosition, plannedRR: number, signalId: string, setupType: string): PaperTradeRecord {
    const record: PaperTradeRecord = {
      tradeId: `TRD:${pos.id}`,
      signalId,
      symbol: pos.symbol,
      setupType,
      direction: pos.side,
      entryPrice: pos.averageEntryPrice,
      initialStopLoss: pos.plannedStopPrice,
      finalStopLoss: pos.stopLossPrice,
      tp1Price: pos.takeProfitPrices[0] ?? 0,
      tp2Price: pos.takeProfitPrices[1] ?? 0,
      tp3Price: pos.takeProfitPrices[2] ?? 0,
      quantity: pos.initialQuantity,
      leverage: pos.leverage,
      fees: pos.fees,
      grossPnl: 0,
      netPnl: -pos.fees,
      maxFavorableExcursion: 0,
      maxAdverseExcursion: 0,
      entryTimestamp: pos.openedAt,
      plannedRiskReward: plannedRR,
      status: 'OPEN',
      lifecycle: [pos.lifecycle],
    };
    this.records.set(record.tradeId, record);
    return record;
  }

  updateTradeProgress(pos: PaperPosition): void {
    const record = this.records.get(`TRD:${pos.id}`);
    if (!record) return;

    const isLong = pos.side === 'LONG';
    const mfe = isLong
      ? Math.max(0, pos.highestPriceReached - pos.averageEntryPrice)
      : Math.max(0, pos.averageEntryPrice - pos.lowestPriceReached);
    const mae = isLong
      ? Math.max(0, pos.averageEntryPrice - pos.lowestPriceReached)
      : Math.max(0, pos.highestPriceReached - pos.averageEntryPrice);

    record.maxFavorableExcursion = Number(mfe.toFixed(4));
    record.maxAdverseExcursion = Number(mae.toFixed(4));
    record.finalStopLoss = pos.stopLossPrice;
    record.fees = pos.fees;
    record.grossPnl = pos.realizedPnl;
    record.netPnl = Number((pos.realizedPnl - pos.fees).toFixed(4));

    if (!record.lifecycle.includes(pos.lifecycle)) {
      record.lifecycle.push(pos.lifecycle);
    }
  }

  finalizeTrade(pos: PaperPosition, exitPrice: number, exitReason: string, exitTimestamp: number): PaperTradeRecord | null {
    const record = this.records.get(`TRD:${pos.id}`);
    if (!record) return null;

    this.updateTradeProgress(pos);
    record.exitPrice = exitPrice;
    record.exitTimestamp = exitTimestamp;
    record.exitReason = exitReason;
    record.durationMs = exitTimestamp - record.entryTimestamp;
    record.status = pos.lifecycle === 'LIQUIDATED' ? 'LIQUIDATED' : 'CLOSED';

    const riskDist = Math.abs(record.entryPrice - record.initialStopLoss);
    if (riskDist > 0) {
      const perUnitGross = record.grossPnl / record.quantity;
      record.realizedRiskReward = Number((perUnitGross / riskDist).toFixed(2));
    }
    return record;
  }

  getRecord(tradeId: string): PaperTradeRecord | undefined {
    return this.records.get(tradeId);
  }

  getAllRecords(): PaperTradeRecord[] {
    return Array.from(this.records.values());
  }

  clear(): void {
    this.records.clear();
  }
}
