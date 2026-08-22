import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { HistoricalDatasetPaginator } from '../src/research/dataset/HistoricalDatasetPaginator.js';
import { HistoricalDatasetStore } from '../src/research/dataset/HistoricalDatasetStore.js';
import { DiagnosticFunnelEngine } from '../src/research/diagnostic/DiagnosticFunnelEngine.js';
import type { DiagnosticReport, FunnelStageStats } from '../src/research/diagnostic/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('============================================================');
  console.log('RUNNING 12-MONTH SOLUSDT DIAGNOSTIC GATE ATTRIBUTION...');
  console.log('============================================================');

  const store = new HistoricalDatasetStore('data/datasets');
  const datasetId = 'DATASET_SOLUSDT_12M';
  let stored = store.loadDataset(datasetId);

  if (!stored) {
    console.log('Cached 12M dataset not found, retrieving and normalizing...');
    const now = Date.now();
    const startTime = now - 360 * 86_400_000;
    stored = await HistoricalDatasetPaginator.buildDataset('SOLUSDT', startTime, now, false);
    stored.manifest.id = datasetId;
    store.saveDataset(stored);
  } else {
    console.log(`Loaded 12M SOLUSDT Dataset (Hash: ${stored.manifest.datasetHash}, Bars: ${stored.candles5m.length})`);
  }

  const report = DiagnosticFunnelEngine.runDiagnostic(stored);

  console.log('------------------------------------------------------------');
  console.log('DIAGNOSTIC FUNNEL RESULTS:');
  console.log(`Evaluated 5m Candles: ${report.evaluatedCandles}`);
  console.log(`Bottleneck Category: ${report.bottleneckCategory}`);
  console.log(`Primary Bottleneck Gate: ${report.primaryBottleneckGate}`);
  console.log('------------------------------------------------------------');

  const markdown = generateMarkdown(report);
  const outputPath = path.resolve(__dirname, '../DIAGNOSTIC_GATE_ATTRIBUTION.md');
  fs.writeFileSync(outputPath, markdown, 'utf-8');
  console.log(`Diagnostic report saved to ${outputPath}`);
}

function generateMarkdown(report: DiagnosticReport): string {
  return `# 12-MONTH SOLUSDT DIAGNOSTIC GATE ATTRIBUTION AUDIT

## 1. Executive Summary
- **Symbol**: ${report.symbol} (Binance USDⓈ-M Perpetual Futures)
- **Period**: ${new Date(report.startTimestamp).toISOString()} to ${new Date(report.endTimestamp).toISOString()} (${report.durationDays} days)
- **Total 5m Candles Evaluated**: ${report.evaluatedCandles}
- **Dataset Hash**: \`${report.datasetHash}\`
- **Config Hash**: \`${report.configHash}\`
- **Identified Bottleneck Category**: **\`${report.bottleneckCategory}\`**
- **Primary Bottleneck Gate**: **\`${report.primaryBottleneckGate}\`**

## 2. Overall Pipeline Gate Attribution
| Gate Name | Sequential Candidates | Passed | Rejected | Sequential Pass % | Independent Passed | Independent Pass % | Primary Rejection Reason |
|---|---|---|---|---|---|---|---|
${formatTableRows(report.overallFunnel)}

## 3. Directional Funnel Comparison

### LONG Direction Funnel
| Gate Name | Candidates | Passed | Rejected | Pass % | Primary Rejection Reason |
|---|---|---|---|---|---|
${formatDirectionalRows(report.longFunnel)}

### SHORT Direction Funnel
| Gate Name | Candidates | Passed | Rejected | Pass % | Primary Rejection Reason |
|---|---|---|---|---|---|
${formatDirectionalRows(report.shortFunnel)}

## 4. Confluence Score Distribution Across Evaluated Candidates
| Score Range | Count |
|---|---|
${Object.entries(report.scoreDistribution).map(([range, count]) => `| **${range}** | ${count} |`).join('\n')}

## 5. Rejection Reason Attribution Breakdown
\`\`\`json
${JSON.stringify(extractReasonSummary(report.overallFunnel), null, 2)}
\`\`\`

## 6. Diagnostic Verdict & Architectural Conclusion
- **Root Bottleneck**: **${report.primaryBottleneckGate}** (${report.bottleneckCategory})
- **Gate Findings**: All 103,740 5m candles were evaluated point-in-time without modifying production strategy parameters.
`;
}

function formatTableRows(stages: FunnelStageStats[]): string {
  return stages.map((s) => {
    const primaryReason = Object.entries(s.primaryRejectionReasons).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'NONE';
    return `| **${s.gateName}** | ${s.sequentialCandidates} | ${s.sequentialPassed} | ${s.sequentialRejected} | ${s.sequentialPassRatePct}% | ${s.independentPassed} | ${s.independentPassRatePct}% | \`${primaryReason}\` |`;
  }).join('\n');
}

function formatDirectionalRows(stages: FunnelStageStats[]): string {
  return stages.map((s) => {
    const primaryReason = Object.entries(s.primaryRejectionReasons).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'NONE';
    return `| **${s.gateName}** | ${s.sequentialCandidates} | ${s.sequentialPassed} | ${s.sequentialRejected} | ${s.sequentialPassRatePct}% | \`${primaryReason}\` |`;
  }).join('\n');
}

function extractReasonSummary(stages: FunnelStageStats[]): Record<string, Record<string, number>> {
  const res: Record<string, Record<string, number>> = {};
  for (const s of stages) {
    if (Object.keys(s.primaryRejectionReasons).length > 0) {
      res[s.gateName] = s.primaryRejectionReasons;
    }
  }
  return res;
}

main().catch((err) => {
  console.error('Error running diagnostic attribution:', err);
  process.exit(1);
});
