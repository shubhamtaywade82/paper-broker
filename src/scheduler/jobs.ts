import cron from 'node-cron';
import type { PaperBroker } from '../broker/PaperBroker.js';
import type { MarketStateManager } from '../market/MarketState.js';
import type { SnapshotStore } from '../persistence/SnapshotStore.js';
import type { StrategyEngine } from '../strategy/StrategyEngine.js';
import type { EventLog } from '../persistence/EventLog.js';
import type { ProfitGoalManager } from '../trading/goals/ProfitGoalManager.js';
import { metrics } from '../telemetry/metrics.js';
import { logger } from '../telemetry/logger.js';

export interface SchedulerOptions {
  broker: PaperBroker;
  marketState: MarketStateManager;
  snapshots: SnapshotStore;
  engine: StrategyEngine;
  events: EventLog;
  staleMarketMaxAgeMs: number;
  /**
   * Profit goals roll on calendar boundaries. Without these resets a daily
   * target achieved once would keep risk throttled forever, because
   * dailyTargetAchieved is only cleared by resetDaily().
   */
  profitGoals?: ProfitGoalManager;
  onProfitGoalsReset?: (period: 'daily' | 'weekly' | 'monthly') => void;
}

export class Scheduler {
  private options: SchedulerOptions;
  private jobs: cron.ScheduledTask[] = [];
  private timers: NodeJS.Timeout[] = [];
  // Medium finding: keyed by symbol, stores the `nextFundingTimeUtc` window
  // that funding was already applied for — not a wall-clock apply timestamp
  // (see the fix note below).
  private lastFundingWindowApplied = new Map<string, number>();

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
        this.rollProfitGoals('daily');
      }),

      // Monday 00:00 UTC — start of the trading week.
      cron.schedule('0 0 * * 1', () => {
        this.rollProfitGoals('weekly');
      }),

      // 1st of the month, 00:00 UTC.
      cron.schedule('0 0 1 * *', () => {
        this.rollProfitGoals('monthly');
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
        // Medium finding ("funding may be applied multiple times per
        // cycle"): broker.applyFunding() is a single GLOBAL operation — it
        // sweeps every open position across every symbol in one call. The
        // old loop called it once per due symbol inside this same tick, so
        // if 3 symbols were due simultaneously, all open positions (not just
        // those 3 symbols') got funding applied 3 times in one tick. It also
        // debounced against a 1s wall-clock window inside a 5s-interval
        // loop, which could never actually suppress a repeat on the *next*
        // tick if the market feed hadn't yet advanced nextFundingTimeUtc.
        //
        // Fixed: call applyFunding() at most once per tick, and debounce per
        // symbol against the funding *window* (nextFundingTimeUtc itself)
        // rather than wall-clock elapsed time — a symbol can't re-trigger
        // this until its own nextFundingTimeUtc actually advances to a new
        // window.
        const now = Date.now();
        const states = marketState.getAllStates();
        let shouldApply = false;

        for (const state of states) {
          if (state.stale) continue;

          const nextFunding = state.nextFundingTimeUtc
            ? Number(state.nextFundingTimeUtc)
            : NaN;

          if (Number.isNaN(nextFunding) || now < nextFunding) continue;

          const lastAppliedWindow = this.lastFundingWindowApplied.get(state.symbol);
          if (lastAppliedWindow === nextFunding) continue;

          this.lastFundingWindowApplied.set(state.symbol, nextFunding);
          shouldApply = true;
        }

        if (shouldApply) {
          broker.applyFunding();
          metrics.inc('funding_payments_total', 1);
        }
      }, 5000)
    );

    logger.info('Scheduler started');
  }

  /**
   * Reset the profit-goal window for a period. The new baseline is current
   * equity, so the next period's target is measured from where this one
   * actually finished rather than from the original starting balance.
   */
  private rollProfitGoals(period: 'daily' | 'weekly' | 'monthly'): void {
    const { profitGoals, broker, events, onProfitGoalsReset } = this.options;
    if (!profitGoals) return;

    const equity = broker.getAccount().equity;
    if (period === 'daily') profitGoals.resetDaily(equity);
    else if (period === 'weekly') profitGoals.resetWeekly(equity);
    else profitGoals.resetMonthly(equity);

    metrics.inc('profit_goal_resets_total');
    events.appendSystemEvent({
      eventType: 'PROFIT_GOAL_RESET',
      payload: { period, equity },
      createdAtUtc: new Date().toISOString(),
    });
    onProfitGoalsReset?.(period);
    logger.info({ period, equity }, 'Profit goal window reset');
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer);
    for (const job of this.jobs) job.stop();
    this.timers = [];
    this.jobs = [];
  }
}