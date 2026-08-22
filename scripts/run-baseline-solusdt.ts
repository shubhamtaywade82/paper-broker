import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BaselineSolusdtBacktest } from '../src/research/replay/BaselineSolusdtBacktest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('============================================================');
  console.log('Fetching Real Binance USDⓈ-M SOLUSDT Historical Data...');
  console.log('============================================================');

  const res = await BaselineSolusdtBacktest.runBaseline();

  console.log('Data Quality Status:', res.dataQualityStatus);
  console.log('Reproducibility (Run 1 vs Run 2):', res.isReproducible ? 'PASS (Bitwise identical)' : 'FAIL');
  console.log('Total Trades:', res.report1.coreMetrics.totalTrades);
  console.log('Win Rate:', (res.report1.coreMetrics.winRate * 100).toFixed(2) + '%');
  console.log('Expected Net R:', res.report1.statisticalValidation?.meanNetR.toFixed(2) ?? '0.00');
  console.log('Profit Factor:', res.report1.coreMetrics.profitFactor);
  console.log('Net P&L:', '$' + res.report1.totalNetPnl.toFixed(2));
  console.log('Final Verdict:', res.verdict);

  const outputPath = path.resolve(__dirname, '../BASELINE_SOLUSDT_BACKTEST.md');
  fs.writeFileSync(outputPath, res.markdownSummary, 'utf-8');
  console.log(`Saved baseline report to ${outputPath}`);
}

main().catch((err) => {
  console.error('Error running baseline backtest:', err);
  process.exit(1);
});
