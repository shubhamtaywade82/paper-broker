import { DEFAULT_PAPER_CONFIG } from '../../broker/paper/SmcPaperBroker.js';
import { BinanceHistoricalFetcher } from './BinanceHistoricalFetcher.js';
import { ReplayEngine } from './ReplayEngine.js';
import type { BacktestReport, HistoricalDataset, ReplayConfig } from './types.js';

export class BaselineSolusdtBacktest {
  static async runBaseline(customDataset?: HistoricalDataset): Promise<{
    report1: BacktestReport;
    report2: BacktestReport;
    isReproducible: boolean;
    dataQualityStatus: string;
    verdict: 'EDGE_NOT_ESTABLISHED' | 'WEAK_EDGE' | 'PROMISING_EDGE' | 'STRONG_BASELINE_EDGE' | 'DATA_INSUFFICIENT';
    markdownSummary: string;
  }> {
    const dataset = customDataset ?? (await BinanceHistoricalFetcher.loadSolusdtDataset(500));
    const dataQualityStatus = this.checkDataQuality(dataset);

    const startTime = dataset.candles5m[0]?.openTime ?? Date.now();
    const endTime = dataset.candles5m[dataset.candles5m.length - 1]?.closeTime ?? Date.now();

    const config: ReplayConfig = {
      symbol: 'SOLUSDT',
      startTime,
      endTime,
      initialEquity: 10_000,
      riskPerTradePct: 0.01,
      maxDailyLossPct: 0.03,
      maxOpenPositions: 3,
      defaultLeverage: 5,
      paperBrokerConfig: DEFAULT_PAPER_CONFIG,
      strategyVersion: '1.0.0',
    };

    const report1 = ReplayEngine.runBacktest(dataset, config);
    const report2 = ReplayEngine.runBacktest(dataset, config);
    const isReproducible = JSON.stringify(report1) === JSON.stringify(report2);

    const verdict = this.determineVerdict(report1, dataQualityStatus);
    const markdownSummary = this.generateMarkdown(report1, dataset, dataQualityStatus, verdict, isReproducible);

    return {
      report1,
      report2,
      isReproducible,
      dataQualityStatus,
      verdict,
      markdownSummary,
    };
  }

  private static checkDataQuality(dataset: HistoricalDataset): string {
    if (
      dataset.candles4h.length < 20 ||
      dataset.candles1h.length < 30 ||
      dataset.candles15m.length < 50 ||
      dataset.candles5m.length < 50
    ) {
      return 'DATA_QUALITY_INSUFFICIENT (Insufficient warmup bars)';
    }
    return 'VALID';
  }

  private static determineVerdict(
    report: BacktestReport,
    dataQualityStatus: string
  ): 'EDGE_NOT_ESTABLISHED' | 'WEAK_EDGE' | 'PROMISING_EDGE' | 'STRONG_BASELINE_EDGE' | 'DATA_INSUFFICIENT' {
    if (dataQualityStatus.includes('INSUFFICIENT')) return 'DATA_INSUFFICIENT';

    const stat = report.statisticalValidation;
    if (!stat || stat.sampleSize < 30) return 'EDGE_NOT_ESTABLISHED';
    if (stat.meanNetR <= 0) return 'EDGE_NOT_ESTABLISHED';

    if (stat.isStatisticallySignificant) {
      return stat.sampleSize >= 100 ? 'STRONG_BASELINE_EDGE' : 'PROMISING_EDGE';
    }
    return 'WEAK_EDGE';
  }

  private static generateMarkdown(
    report: BacktestReport,
    dataset: HistoricalDataset,
    dqStatus: string,
    verdict: string,
    reproducible: boolean
  ): string {
    const core = report.coreMetrics;
    const stat = report.statisticalValidation;
    const trades = report.trades;
    const longTrades = trades.filter((t) => t.direction === 'LONG');
    const shortTrades = trades.filter((t) => t.direction === 'SHORT');

    const longWins = longTrades.filter((t) => t.netPnl > 0).length;
    const shortWins = shortTrades.filter((t) => t.netPnl > 0).length;
    const longWinRate = longTrades.length > 0 ? (longWins / longTrades.length) * 100 : 0;
    const shortWinRate = shortTrades.length > 0 ? (shortWins / shortTrades.length) * 100 : 0;

    return `# BASELINE SOLUSDT HISTORICAL BACKTEST AUDIT

## 1. Executive Summary
- **Symbol**: SOLUSDT (Binance USDⓈ-M Perpetual Futures)
- **Period**: ${new Date(report.startTime).toISOString()} to ${new Date(report.endTime).toISOString()} (${report.durationDays} days)
- **Verdict**: **${verdict}**
- **Config Hash**: \`${report.configHash}\`
- **Reproducibility**: ${reproducible ? '100% Bitwise Parity' : 'FAILED'}

## 2. Dataset & Data Quality
- **4H Candles**: ${dataset.candles4h.length}
- **1H Candles**: ${dataset.candles1h.length}
- **15m Candles**: ${dataset.candles15m.length}
- **5m Candles**: ${dataset.candles5m.length}
- **Funding Rates Recorded**: ${dataset.fundingRates?.length ?? 0}
- **Data Quality Status**: \`${dqStatus}\`

## 3. Core Trade & Risk Performance
| Metric | Value |
|---|---|
| Total Trades | ${core.totalTrades} |
| Winning Trades / Losing Trades | ${core.winningTrades} / ${core.losingTrades} |
| Win Rate | ${(core.winRate * 100).toFixed(2)}% |
| Expected Net R | ${stat?.meanNetR.toFixed(2) ?? core.averageR.toFixed(2)}R |
| Profit Factor | ${core.profitFactor} |
| Initial Equity / Final Equity | $${report.initialEquity.toFixed(2)} / $${report.finalEquity.toFixed(2)} |
| Total Net P&L | $${report.totalNetPnl.toFixed(2)} (${report.totalReturnPct}%) |
| Max Drawdown | $${core.maxDrawdown.toFixed(2)} |
| Total Fees Incurred | $${core.totalFees.toFixed(2)} |

## 4. Directional Breakdown
- **LONG Trades**: ${longTrades.length} (Win Rate: ${longWinRate.toFixed(2)}%)
- **SHORT Trades**: ${shortTrades.length} (Win Rate: ${shortWinRate.toFixed(2)}%)

## 5. Statistical Validation & Confidence
- **Sample Confidence Grade**: \`${stat?.confidenceGrade ?? 'INSUFFICIENT_SAMPLE'}\`
- **Mean Net R 95% CI**: [${stat?.meanNetRConfidenceInterval[0] ?? 0}R, ${stat?.meanNetRConfidenceInterval[1] ?? 0}R]
- **Win Rate 95% CI**: [${((stat?.winRateConfidenceInterval[0] ?? 0) * 100).toFixed(1)}%, ${((stat?.winRateConfidenceInterval[1] ?? 0) * 100).toFixed(1)}%]
- **Bootstrap p-value (H0: Mean R ≤ 0)**: ${stat?.pValueMeanRGreaterThanZero ?? 1.0}
- **Statistically Significant**: ${stat?.isStatisticallySignificant ? 'YES' : 'NO'}
`;
  }
}
