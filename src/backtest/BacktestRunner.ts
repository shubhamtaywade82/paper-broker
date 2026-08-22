import type { Instrument } from '../broker/types.js';
import { PaperBroker } from '../broker/PaperBroker.js';
import { StrategyEngine } from '../strategy/StrategyEngine.js';
import { SizingEngine } from '../strategy/SizingEngine.js';
import { OrderFactory } from '../strategy/OrderFactory.js';
import { SignalExecutor } from '../strategy/SignalExecutor.js';
import { SignalRepository } from '../persistence/repositories/SignalRepository.js';
import { DatabaseManager } from '../persistence/db.js';
import { EventLog } from '../persistence/EventLog.js';
import { SnapshotStore } from '../persistence/SnapshotStore.js';
import { defaultInstruments } from '../config/instruments.js';
import { createEmaTrendStrategy } from '../strategy/strategies/ema-trend-5m.js';
import { createBreakoutStrategy } from '../strategy/strategies/breakout-15m.js';
import { createRsiMeanReversionStrategy } from '../strategy/strategies/rsi-mean-reversion-5m.js';
import { createMomentumStrategy } from '../strategy/strategies/momentum-5m.js';
import { createGridStrategy } from '../strategy/strategies/grid-15m.js';
import { createMeanReversionStrategy } from '../strategy/strategies/mean-reversion-5m.js';
import type { Candle } from '../strategy/indicators.js';

export interface BacktestConfig {
  dataDir: string;
  accountId: string;
  startingUsdt: number;
  symbols: string[];
  startTime: number;
  endTime: number;
  strategies: string[];
  takerFeeRate?: number;
  makerFeeRate?: number;
  marketSlippageBps?: number;
}

interface BacktestEquityPoint {
  ts: number;
  equity: number;
  walletBalance: number;
  unrealizedPnl: number;
  totalFees: number;
  totalRealizedPnl: number;
}

interface BacktestTrade {
  ts: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: string;
  quantity: number;
  price: number;
  fee: number;
  realizedPnl: number;
  strategyId?: string;
}

interface BacktestResult {
  config: BacktestConfig;
  startTime: number;
  endTime: number;
  durationMs: number;
  initialEquity: number;
  finalEquity: number;
  totalReturn: number;
  totalReturnPct: number;
  totalTrades: number;
  totalFees: number;
  totalRealizedPnl: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  winRate: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  trades: BacktestTrade[];
  equityCurve: BacktestEquityPoint[];
  byStrategy: Record<string, { trades: number; pnl: number; winRate: number }>;
}

function msToDate(ms: number): string {
  return new Date(ms).toISOString();
}

export class BacktestRunner {
  private config: BacktestConfig;
  private db: DatabaseManager;
  private broker: PaperBroker;
  private signalRepo: SignalRepository;
  private eventLog: EventLog;
  private snapshotStore: SnapshotStore;
  private strategyEngine: StrategyEngine;
  private signalExecutor: SignalExecutor;
  private instruments: Instrument[];
  private equityCurve: BacktestEquityPoint[] = [];
  private trades: BacktestTrade[] = [];
  private strategyStats: Record<string, { trades: number; wins: number; pnl: number }> = {};

  constructor(config: BacktestConfig) {
    this.config = config;
    this.db = new DatabaseManager(config.dataDir);
    this.signalRepo = new SignalRepository(this.db.raw);
    this.eventLog = new EventLog(config.dataDir);
    this.snapshotStore = new SnapshotStore(config.dataDir);

    this.broker = new PaperBroker({
      dataDir: config.dataDir,
      accountId: config.accountId,
      startingUsdt: config.startingUsdt,
      instruments: defaultInstruments,
      takerFeeRate: config.takerFeeRate ?? 0.0004,
      makerFeeRate: config.makerFeeRate ?? 0.0002,
      marketSlippageBps: config.marketSlippageBps ?? 2,
    });

    const sizingEngine = new SizingEngine({
      riskPerTrade: 0.005,
      maxNotional: 5000,
    });
    const orderFactory = new OrderFactory();

    this.signalExecutor = new SignalExecutor({
      broker: this.broker,
      sizing: sizingEngine,
      orderFactory,
      signals: this.signalRepo,
      getMarketState: (s) => this.broker.getMarket(s),
    });

    this.strategyEngine = new StrategyEngine(
      {
        marketState: (s) => this.broker.getMarket(s),
        klines: {
          getCandles: (symbol, interval, limit) => this.getCandles(symbol, interval, limit),
        },
        account: () => this.broker.getAccount(),
        getPosition: (symbol) => this.broker.getPosition(symbol),
        getOpenOrders: (symbol) => this.broker.getOpenOrders(symbol),
        getInstrument: (symbol) => this.broker.getInstrument(symbol),
        submitOrder: (order) => this.broker.submitOrder(order),
      },
      {
        onSubmitSignal: async (signal) => {
          await this.signalExecutor.execute(signal);
          return true;
        },
      }
    );

    this.instruments = defaultInstruments;
    this.registerStrategies();
  }

  private registerStrategies(): void {
    const symbolSet = this.config.symbols;

    if (this.config.strategies.includes('ema-trend') || this.config.strategies.includes('all')) {
      this.strategyEngine.register(createEmaTrendStrategy({
        symbols: symbolSet,
        fastPeriod: 9,
        slowPeriod: 21,
        rsiUpper: 70,
        rsiLower: 30,
        cooldownMs: 300_000,
      }));
    }

    if (this.config.strategies.includes('breakout') || this.config.strategies.includes('all')) {
      this.strategyEngine.register(createBreakoutStrategy({
        symbols: symbolSet,
        lookback: 20,
        atrStopMultiplier: 2,
        atrTakeProfitMultiplier: 4,
        cooldownMs: 300_000,
      }));
    }

    if (this.config.strategies.includes('rsi-mr') || this.config.strategies.includes('all')) {
      this.strategyEngine.register(createRsiMeanReversionStrategy({
        symbols: symbolSet,
        oversold: 30,
        overbought: 70,
        neutralHigh: 55,
        neutralLow: 45,
        cooldownMs: 300_000,
      }));
    }

    if (this.config.strategies.includes('momentum') || this.config.strategies.includes('all')) {
      this.strategyEngine.register(createMomentumStrategy({
        symbols: symbolSet,
        cooldownMs: 300_000,
      }));
    }

    if (this.config.strategies.includes('grid') || this.config.strategies.includes('all')) {
      this.strategyEngine.register(createGridStrategy({
        symbols: symbolSet,
        gridLevels: 5,
        gridSpacing: 0.005,
        baseQty: 0.5,
        leverage: 2,
      }));
    }

    if (this.config.strategies.includes('mean-reversion') || this.config.strategies.includes('all')) {
      this.strategyEngine.register(createMeanReversionStrategy({
        symbols: symbolSet,
        lookbackPeriods: 20,
        cooldownMs: 300_000,
      }));
    }

    this.strategyEngine.start();
  }

  private getCandles(symbol: string, interval: string, limit: number): Candle[] {
    const key = `${symbol}:${interval}`;
    return this.candleCache.get(key)?.slice(-limit) ?? [];
  }

  private candleCache = new Map<string, Candle[]>();

  private async loadKlines(symbol: string): Promise<void> {
    const startIso = new Date(this.config.startTime).toISOString();
    const endIso = new Date(this.config.endTime).toISOString();

    const rows = this.db.raw.prepare(`
      SELECT symbol, open_time_utc, open, high, low, close, volume
      FROM klines_1m
      WHERE symbol = ? AND open_time_utc >= ? AND open_time_utc <= ?
      ORDER BY open_time_utc ASC
    `).all(symbol, startIso, endIso);

    for (const row of rows as Array<{ symbol: string; open_time_utc: string; open: string; high: string; low: string; close: string; volume: string }>) {
      const candle: Candle = {
        symbol: row.symbol,
        interval: '1m',
        openTime: new Date(row.open_time_utc).getTime(),
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume),
      };

      this.upsertCandle(candle, '1m');
    }

    this.buildHigherIntervals(symbol, '1m', '5m', 300_000);
    this.buildHigherIntervals(symbol, '5m', '15m', 900_000);
  }

  private upsertCandle(candle: Candle, interval: string): void {
    const key = `${candle.symbol}:${interval}`;
    let series = this.candleCache.get(key);
    if (!series) {
      series = [];
      this.candleCache.set(key, series);
    }
    const existingIdx = series.findIndex((c) => c.openTime === candle.openTime);
    if (existingIdx >= 0) {
      series[existingIdx] = candle;
    } else {
      series.push(candle);
      series.sort((a, b) => a.openTime - b.openTime);
    }
  }

  private buildHigherIntervals(symbol: string, srcInterval: string, dstInterval: string, dstMs: number): void {
    const srcKey = `${symbol}:${srcInterval}`;
    const srcSeries = this.candleCache.get(srcKey) ?? [];
    if (srcSeries.length === 0) return;

    const dstKey = `${symbol}:${dstInterval}`;
    const dstSeries: Candle[] = [];

    let currentCandle: Candle | null = null;

    for (const c of srcSeries) {
      const bucketStart = Math.floor(new Date(c.openTime).getTime() / dstMs) * dstMs;

      if (!currentCandle || currentCandle.openTime !== bucketStart) {
        if (currentCandle) {
          dstSeries.push({ ...currentCandle, interval: dstInterval });
        }
        currentCandle = {
          symbol: c.symbol,
          interval: dstInterval,
          openTime: bucketStart,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        };
      } else {
        currentCandle.high = Math.max(currentCandle.high, c.high);
        currentCandle.low = Math.min(currentCandle.low, c.low);
        currentCandle.close = c.close;
        currentCandle.volume += c.volume;
      }
    }
    if (currentCandle) {
      dstSeries.push({ ...currentCandle, interval: dstInterval });
    }

    this.candleCache.set(dstKey, dstSeries);
  }

  async run(): Promise<BacktestResult> {
    console.log(`[Backtest] Loading klines for ${this.config.symbols.join(', ')} from ${msToDate(this.config.startTime)} to ${msToDate(this.config.endTime)}`);

    for (const symbol of this.config.symbols) {
      await this.loadKlines(symbol);
    }

    // Build O(1) lookup maps for each symbol's 1m series
    const candleMaps = new Map<string, Map<number, Candle>>();
    for (const symbol of this.config.symbols) {
      const key1m = `${symbol}:1m`;
      const series1m = this.candleCache.get(key1m) ?? [];
      const map = new Map<number, Candle>();
      for (const c of series1m) map.set(c.openTime, c);
      candleMaps.set(symbol, map);
    }

    const allTimes = new Set<number>();
    for (const symbol of this.config.symbols) {
      const map = candleMaps.get(symbol)!;
      for (const ts of map.keys()) allTimes.add(ts);
    }

    const sortedTimes = Array.from(allTimes).sort((a, b) => a - b);
    console.log(`[Backtest] Replaying ${sortedTimes.length} 1m bars`);

    let last5mBucket = -1;
    let last15mBucket = -1;
    let lastSnapshotTime = this.config.startTime;
    let lastFundingTime = this.config.startTime;
    let processedBars = 0;
    const FUNDING_INTERVAL_MS = 28_800_000; // 8 hours
    const HALF_SPREAD_BPS = 1; // 1 bps half-spread each side

    for (const ts of sortedTimes) {
      if (ts < this.config.startTime || ts > this.config.endTime) continue;

      for (const symbol of this.config.symbols) {
        const candle = candleMaps.get(symbol)?.get(ts);
        if (!candle) continue;

        // Simulate bid-ask spread from candle close
        const halfSpread = candle.close * (HALF_SPREAD_BPS / 10_000);
        const bid = candle.close - halfSpread;
        const ask = candle.close + halfSpread;

        this.broker.onMarket({
          symbol,
          bid,
          ask,
          last: candle.close,
          mark: candle.close,
          localTsUtc: ts,
          stale: false,
        });

        const bucket5m = Math.floor(ts / 300_000) * 300_000;
        const bucket15m = Math.floor(ts / 900_000) * 900_000;

        // Fire strategy on 5m candle CLOSE (when entering next bucket)
        if (bucket5m !== last5mBucket) {
          const prevBucket = last5mBucket;
          last5mBucket = bucket5m;
          if (prevBucket >= 0) {
            for (const sym of this.config.symbols) {
              const cached = this.candleCache.get(`${sym}:5m`)?.find(c => c.openTime === prevBucket);
              if (cached) {
                await this.strategyEngine.onCandleClose(cached);
              }
            }
          }
        }

        if (bucket15m !== last15mBucket) {
          const prevBucket = last15mBucket;
          last15mBucket = bucket15m;
          if (prevBucket >= 0) {
            for (const sym of this.config.symbols) {
              const cached = this.candleCache.get(`${sym}:15m`)?.find(c => c.openTime === prevBucket);
              if (cached) {
                await this.strategyEngine.onCandleClose(cached);
              }
            }
          }
        }

        if (ts - lastSnapshotTime >= 60_000) {
          lastSnapshotTime = ts;
          this.recordEquitySnapshot(ts);
        }

        // Apply funding at 8-hour intervals only (matches Binance schedule)
        if (ts - lastFundingTime >= FUNDING_INTERVAL_MS) {
          lastFundingTime = ts;
          this.broker.applyFunding();
        }
      }

      processedBars++;
      if (processedBars % 1000 === 0) {
        console.log(`[Backtest] Processed ${processedBars}/${sortedTimes.length} bars...`);
      }
    }

    for (const sym of this.config.symbols) {
      this.broker.cancelAllOrders(sym);
    }

    this.recordEquitySnapshot(this.config.endTime);
    this.captureTrades();

    return this.computeResults();
  }

  private captureTrades(): void {
    for (const fill of this.broker.getFills()) {
      const trade: BacktestTrade = {
        ts: new Date(fill.fillTsUtc).getTime(),
        symbol: fill.symbol,
        side: fill.side,
        type: fill.liquidity === 'MAKER' ? 'LIMIT' : 'MARKET',
        quantity: fill.quantity,
        price: fill.price,
        fee: fill.fee,
        realizedPnl: fill.realizedPnl,
        strategyId: fill.strategyId,
      };
      this.trades.push(trade);

      const stratId = fill.strategyId ?? 'unknown';
      if (!this.strategyStats[stratId]) {
        this.strategyStats[stratId] = { trades: 0, wins: 0, pnl: 0 };
      }
      this.strategyStats[stratId]!.trades++;
      this.strategyStats[stratId]!.pnl += fill.realizedPnl;
      if (fill.realizedPnl > 0) this.strategyStats[stratId]!.wins++;
    }
  }

  private recordEquitySnapshot(ts: number): void {
    const account = this.broker.getAccount();
    this.equityCurve.push({
      ts,
      equity: account.equity,
      walletBalance: account.walletBalance,
      unrealizedPnl: account.unrealizedPnl,
      totalFees: account.totalFees,
      totalRealizedPnl: account.totalRealizedPnl,
    });
  }

  private computeResults(): BacktestResult {
    const initialEquity = this.config.startingUsdt;
    const finalEquity = this.broker.getAccount().equity;
    const totalReturn = finalEquity - initialEquity;
    const totalReturnPct = (totalReturn / initialEquity) * 100;

    const totalFees = this.broker.getAccount().totalFees;
    const totalRealizedPnl = this.broker.getAccount().totalRealizedPnl;

    let peak = initialEquity;
    let maxDrawdown = 0;
    let maxDrawdownPct = 0;

    for (const point of this.equityCurve) {
      if (point.equity > peak) {
        peak = point.equity;
      }
      const dd = peak - point.equity;
      const ddPct = (dd / peak) * 100;
      if (dd > maxDrawdown) maxDrawdown = dd;
      if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
    }

    let wins = 0;
    let losses = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    const tradeReturns: number[] = [];

    for (const t of this.trades) {
      if (t.realizedPnl > 0) {
        wins++;
        grossProfit += t.realizedPnl;
      } else if (t.realizedPnl < 0) {
        losses++;
        grossLoss += Math.abs(t.realizedPnl);
      }
      tradeReturns.push(t.realizedPnl);
    }

    const totalTrades = this.trades.length;
    const winRate = totalTrades > 0 ? wins / totalTrades : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
    const avgWin = wins > 0 ? grossProfit / wins : 0;
    const avgLoss = losses > 0 ? grossLoss / losses : 0;

    const meanReturn = tradeReturns.length > 0
      ? tradeReturns.reduce((a, b) => a + b, 0) / tradeReturns.length
      : 0;
    const stdReturn = tradeReturns.length > 1
      ? Math.sqrt(tradeReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (tradeReturns.length - 1))
      : 0;
    const sharpeRatio = stdReturn > 0 ? (meanReturn / stdReturn) * Math.sqrt(252 * 24 * 60) : 0;

    const byStrategy: Record<string, { trades: number; pnl: number; winRate: number }> = {};
    for (const [strat, stats] of Object.entries(this.strategyStats)) {
      byStrategy[strat] = {
        trades: stats.trades,
        pnl: stats.pnl,
        winRate: stats.trades > 0 ? stats.wins / stats.trades : 0,
      };
    }

    return {
      config: this.config,
      startTime: this.config.startTime,
      endTime: this.config.endTime,
      durationMs: this.config.endTime - this.config.startTime,
      initialEquity,
      finalEquity,
      totalReturn,
      totalReturnPct,
      totalTrades,
      totalFees,
      totalRealizedPnl,
      maxDrawdown,
      maxDrawdownPct,
      sharpeRatio,
      winRate,
      profitFactor,
      avgWin,
      avgLoss,
      trades: this.trades,
      equityCurve: this.equityCurve,
      byStrategy,
    };
  }

  close(): void {
    this.db.close();
  }
}

export async function runBacktest(config: BacktestConfig): Promise<BacktestResult> {
  const runner = new BacktestRunner(config);
  try {
    return await runner.run();
  } finally {
    runner.close();
  }
}