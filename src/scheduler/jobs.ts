import cron from 'node-cron';
import type { PaperBroker } from '../broker/PaperBroker.js';
import type { MarketStateManager } from '../market/MarketState.js';
import type { SnapshotStore } from '../persistence/SnapshotStore.js';
import type { StrategyEngine } from '../strategy/StrategyEngine.js';
import type { EventLog } from '../persistence/EventLog.js';
import { metrics } from '../telemetry/metrics.js';
import { logger } from '../telemetry/logger.js';

export interface SchedulerOptions {
  broker: PaperBroker;
  marketState: MarketStateManager;
  snapshots: SnapshotStore;
  engine: StrategyEngine;
  events: EventLog;
  staleMarketMaxAgeMs: number;
}

export class Scheduler {
  private options: SchedulerOptions;
  private jobs: cron.ScheduledTask[] = [];
  private timers: NodeJS.Timeout[] = [];
  private lastFundingApplied = new Map<string, number>();

  constructor(options: SchedulerOptions) {
    this.options = options;
  }

  start(): void {
    const { broker, marketState, snapshots, engine, staleMarketMaxAgeMs } = this.options;

    this.timers.push(
      setInterval(() => {
        marketState.markStale(staleMarketMaxAgeMs);
      }, 1000),

      setInterval(() => {
        const states = marketState.getAllStates();
        const now = Date.now();
        const second = Math.floor(now / 1000);

        for (const state of states) {
          if (state.stale) continue;

          snapshots.saveMarketTick1s({
            symbol: state.symbol,
            ts: second * 1000,
            bid: state.bid,
            ask: state.ask,
            last: state.last,
            mark: state.mark,
            index: state.index,
            fundingRate: state.fundingRate,
          });
        }
        metrics.inc('market_ticks_written_total', states.length);
      }, 1000),

      setInterval(() => {
        const account = broker.getAccount();
        snapshots.saveAccountSnapshot(account, 'paper-main');
        metrics.inc('account_snapshots_total');
      }, 60_000)
    );

    this.jobs.push(
      cron.schedule('* * * * *', () => {
        const account = broker.getAccount();
        snapshots.saveAccountSnapshot(account, 'paper-main');
        metrics.inc('account_snapshots_total');
      }),

      cron.schedule('0 0 * * *', () => {
        logger.info('Rolling daily equity baseline');
        metrics.inc('daily_baseline_rolls_total');
      })
    );

    this.timers.push(
      setInterval(() => {
        const expired = engine.expireSignals();
        if (expired > 0) {
          metrics.inc('signals_expired_total', expired);
        }
      }, 5000),

      setInterval(() => {
        const now = Date.now();
        const states = marketState.getAllStates();

        for (const state of states) {
          if (state.stale) continue;

          const nextFunding = state.nextFundingTimeUtc
            ? Number(state.nextFundingTimeUtc)
            : NaN;

          if (Number.isNaN(nextFunding) || now < nextFunding) continue;

          const lastApplied = this.lastFundingApplied.get(state.symbol);
          if (lastApplied !== undefined && now - lastApplied < 1000) continue;

          this.lastFundingApplied.set(state.symbol, now);
          broker.applyFunding();
          metrics.inc('funding_payments_total', 1);
        }
      }, 5000)
    );

    logger.info('Scheduler started');
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer);
    for (const job of this.jobs) job.stop();
    this.timers = [];
    this.jobs = [];
  }
}