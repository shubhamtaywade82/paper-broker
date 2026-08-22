import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Candle } from '../../strategy/indicators.js';
import type { StoredHistoricalDataset } from './types.js';

export class HistoricalDatasetStore {
  private baseDir: string;

  constructor(baseDir = 'data/datasets') {
    this.baseDir = baseDir;
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  saveDataset(dataset: StoredHistoricalDataset): void {
    const filePath = path.join(this.baseDir, `${dataset.manifest.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(dataset, null, 2), 'utf-8');
  }

  loadDataset(datasetId: string): StoredHistoricalDataset | null {
    const filePath = path.join(this.baseDir, `${datasetId}.json`);
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as StoredHistoricalDataset;
  }

  hasDataset(datasetId: string): boolean {
    return fs.existsSync(path.join(this.baseDir, `${datasetId}.json`));
  }

  static computeDatasetHash(candlesByInterval: Record<string, Candle[]>): string {
    const hash = crypto.createHash('sha256');
    const sortedIntervals = Object.keys(candlesByInterval).sort();

    for (const interval of sortedIntervals) {
      hash.update(`interval:${interval};`);
      const candles = candlesByInterval[interval] ?? [];
      for (const c of candles) {
        hash.update(`${c.openTime},${c.open},${c.high},${c.low},${c.close},${c.volume};`);
      }
    }

    return hash.digest('hex').substring(0, 32);
  }
}
