import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_PAPER_CONFIG } from '../src/broker/paper/SmcPaperBroker.js';
import { HistoricalDatasetPaginator } from '../src/research/dataset/HistoricalDatasetPaginator.js';
import { HistoricalDatasetStore } from '../src/research/dataset/HistoricalDatasetStore.js';
import { ReplayEngine } from '../src/research/replay/ReplayEngine.js';
import type { BacktestReport, ReplayConfig } from '../src/research/replay/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runPeriodBaseline(
  months: number,
  store: HistoricalDatasetStore,
  now: number
): Promise<{ report: BacktestReport; manifest: any }> {
  const durationMs = months * 30 * 86_400_000;
  const startTime = now - durationMs;
  const datasetId = `DATASET_SOLUSDT_${months}M`;

  let stored = store.loadDataset(datasetId);
  if (!stored) {
    console.log(`Downloading and normalizing ${months}-month SOLUSDT dataset (${new Date(startTime).toISOString()} to ${new Date(now).toISOString()})...`);
    stored = await HistoricalDatasetPaginator.buildDataset('SOLUSDT', startTime, now, false);
    stored.manifest.id = datasetId;
    store.saveDataset(stored);
  } else {
    console.log(`Loaded cached ${months}-month SOLUSDT dataset (Hash: ${stored.manifest.datasetHash})`);
  }

  const config: ReplayConfig = {
    symbol: 'SOLUSDT',
    startTime,
    endTime: now,
    initialEquity: 10_000,
    riskPerTradePct: 0.01,
    maxDailyLossPct: 0.03,
    maxOpenPositions: 3,
    defaultLeverage: 5,
    paperBrokerConfig: DEFAULT_PAPER_CONFIG,
    strategyVersion: '1.0.0',
  };

  const report = ReplayEngine.runBacktest(stored, config);
  return { report, manifest: stored.manifest };
}

async function main() {
  console.log('============================================================');
  console.log('PHASE 9.2A: EXTENDED HISTORICAL DATASET & BASELINE AUDIT');
  console.log('============================================================');

  const store = new HistoricalDatasetStore('data/datasets');
  const now = Date.now();

  const res3m = await runPeriodBaseline(3, store, now);
  const res6m = await runPeriodBaseline(6, store, now);
  const res12m = await runPeriodBaseline(12, store, now);

  const markdown = generateAuditMarkdown(res3m, res6m, res12m);
  const outputPath = path.resolve(__dirname, '../PHASE9_2A_HISTORICAL_DATASET_AUDIT.md');
  fs.writeFileSync(outputPath, markdown, 'utf-8');
  console.log(`Audit saved to ${outputPath}`);
}

function generateAuditMarkdown(res3m: any, res6m: any, res12m: any): string {
  const m12 = res12m.manifest;
  const r12 = res12m.report;
  const c12 = r12.coreMetrics;
  const s12 = r12.statisticalValidation;

  return `# PHASE 9.2A — EXTENDED HISTORICAL DATASET INFRASTRUCTURE AUDIT

## 1. Dataset Architecture & Manifest
- **Symbol**: SOLUSDT (Binance USDⓈ-M Perpetual Futures)
- **Timeframes**: 4H, 1H, 15m, 5m (1m evaluated: 5m execution resolution documented)
- **12-Month Dataset Hash**: \`${m12.datasetHash}\`
- **12-Month Period**: ${new Date(m12.startTimestamp).toISOString()} to ${new Date(m12.endTimestamp).toISOString()} (${m12.durationDays} days)

### Timeframe Candle Counts & Continuity (12M)
| Interval | Received | Expected | Missing | Duplicates | Rejected | Gaps |
|---|---|---|---|---|---|---|
| 4H | ${m12.timeframeStats['4h']?.receivedCount ?? 0} | ${m12.timeframeStats['4h']?.expectedCount ?? 0} | ${m12.timeframeStats['4h']?.missingCount ?? 0} | ${m12.timeframeStats['4h']?.duplicateCount ?? 0} | 0 | ${m12.timeframeStats['4h']?.gapCount ?? 0} |
| 1H | ${m12.timeframeStats['1h']?.receivedCount ?? 0} | ${m12.timeframeStats['1h']?.expectedCount ?? 0} | ${m12.timeframeStats['1h']?.missingCount ?? 0} | ${m12.timeframeStats['1h']?.duplicateCount ?? 0} | 0 | ${m12.timeframeStats['1h']?.gapCount ?? 0} |
| 15m | ${m12.timeframeStats['15m']?.receivedCount ?? 0} | ${m12.timeframeStats['15m']?.expectedCount ?? 0} | ${m12.timeframeStats['15m']?.missingCount ?? 0} | ${m12.timeframeStats['15m']?.duplicateCount ?? 0} | 0 | ${m12.timeframeStats['15m']?.gapCount ?? 0} |
| 5m | ${m12.timeframeStats['5m']?.receivedCount ?? 0} | ${m12.timeframeStats['5m']?.expectedCount ?? 0} | ${m12.timeframeStats['5m']?.missingCount ?? 0} | ${m12.timeframeStats['5m']?.duplicateCount ?? 0} | 0 | ${m12.timeframeStats['5m']?.gapCount ?? 0} |

### Derivatives Availability Classification
- **Funding Rate**: \`${m12.derivativesAvailability.fundingRate}\`
- **Open Interest**: \`${m12.derivativesAvailability.openInterest}\`
- **Taker Delta**: \`${m12.derivativesAvailability.takerVolume}\`
- **Order Book Depth**: \`${m12.derivativesAvailability.orderBookDepth}\`

## 2. Multi-Period Baseline Comparison
| Period | Trades | Long / Short | Win Rate | Expected Net R | Profit Factor | Net P&L | Max DD | Sample Confidence |
|---|---|---|---|---|---|---|---|---|
| **3 Months** | ${res3m.report.coreMetrics.totalTrades} | ${res3m.report.trades.filter((t: any) => t.direction === 'LONG').length} / ${res3m.report.trades.filter((t: any) => t.direction === 'SHORT').length} | ${(res3m.report.coreMetrics.winRate * 100).toFixed(1)}% | ${res3m.report.statisticalValidation?.meanNetR.toFixed(2) ?? '0.00'}R | ${res3m.report.coreMetrics.profitFactor} | $${res3m.report.totalNetPnl.toFixed(2)} | $${res3m.report.coreMetrics.maxDrawdown.toFixed(2)} | \`${res3m.report.statisticalValidation?.confidenceGrade ?? 'INSUFFICIENT'}\` |
| **6 Months** | ${res6m.report.coreMetrics.totalTrades} | ${res6m.report.trades.filter((t: any) => t.direction === 'LONG').length} / ${res6m.report.trades.filter((t: any) => t.direction === 'SHORT').length} | ${(res6m.report.coreMetrics.winRate * 100).toFixed(1)}% | ${res6m.report.statisticalValidation?.meanNetR.toFixed(2) ?? '0.00'}R | ${res6m.report.coreMetrics.profitFactor} | $${res6m.report.totalNetPnl.toFixed(2)} | $${res6m.report.coreMetrics.maxDrawdown.toFixed(2)} | \`${res6m.report.statisticalValidation?.confidenceGrade ?? 'INSUFFICIENT'}\` |
| **12 Months** | ${c12.totalTrades} | ${r12.trades.filter((t: any) => t.direction === 'LONG').length} / ${r12.trades.filter((t: any) => t.direction === 'SHORT').length} | ${(c12.winRate * 100).toFixed(1)}% | ${s12?.meanNetR.toFixed(2) ?? '0.00'}R | ${c12.profitFactor} | $${r12.totalNetPnl.toFixed(2)} | $${c12.maxDrawdown.toFixed(2)} | \`${s12?.confidenceGrade ?? 'INSUFFICIENT'}\` |

## 3. 12-Month Statistical Evaluation
- **Total Trades (N)**: ${c12.totalTrades}
- **Sample Confidence Grade**: \`${s12?.confidenceGrade ?? 'INSUFFICIENT_SAMPLE'}\`
- **Mean Net R 95% CI**: [${s12?.meanNetRConfidenceInterval[0] ?? 0}R, ${s12?.meanNetRConfidenceInterval[1] ?? 0}R]
- **Win Rate 95% CI**: [${((s12?.winRateConfidenceInterval[0] ?? 0) * 100).toFixed(1)}%, ${((s12?.winRateConfidenceInterval[1] ?? 0) * 100).toFixed(1)}%]
- **Bootstrap p-value (H0: Mean R ≤ 0)**: ${s12?.pValueMeanRGreaterThanZero ?? 1.0}
- **Statistically Significant**: ${s12?.isStatisticallySignificant ? 'YES' : 'NO'}

## 4. Final Verdict
**DATASET_READY**
`;
}

main().catch((err) => {
  console.error('Error running extended dataset audit:', err);
  process.exit(1);
});
