import * as fs from 'node:fs';
import * as path from 'node:path';
import type { MarketFeatures, SupertrendParams } from './types.js';
import { formatRegimeKey } from './regime.js';
import { logger } from '../../telemetry/logger.js';

export const DEFAULT_ACTIONS: SupertrendParams[] = [
  { atrPeriod: 8, multiplier: 1.5 },
  { atrPeriod: 10, multiplier: 2.0 },
  { atrPeriod: 12, multiplier: 2.5 },
  { atrPeriod: 14, multiplier: 2.8 },
  { atrPeriod: 14, multiplier: 3.0 },
  { atrPeriod: 18, multiplier: 3.2 },
  { atrPeriod: 20, multiplier: 3.5 },
];

export class AdaptiveParameterAI {
  private qTable = new Map<string, number[]>();
  private actions: SupertrendParams[];
  private learningRate: number;
  private discountFactor: number;
  private epsilon: number;
  private persistencePath?: string;

  constructor(options?: {
    actions?: SupertrendParams[];
    learningRate?: number;
    discountFactor?: number;
    epsilon?: number;
    persistencePath?: string;
  }) {
    this.actions = options?.actions ?? DEFAULT_ACTIONS;
    this.learningRate = options?.learningRate ?? 0.15;
    this.discountFactor = options?.discountFactor ?? 0.85;
    this.epsilon = options?.epsilon ?? 0.15;
    this.persistencePath = options?.persistencePath;

    if (this.persistencePath) {
      this.loadMemory(this.persistencePath);
    }
  }

  private initHeuristicQValues(state: string): number[] {
    const qValues = new Array(this.actions.length).fill(0.1);
    const [vol, trend] = state.split('_');

    if (vol === 'high' && trend === 'strong') {
      qValues[5] = 0.5;
      qValues[6] = 0.6;
    } else if (vol === 'low' && trend === 'weak') {
      qValues[0] = 0.5;
      qValues[1] = 0.6;
    } else {
      qValues[3] = 0.5;
      qValues[4] = 0.6;
    }
    return qValues;
  }

  public chooseAction(features: MarketFeatures): {
    params: SupertrendParams;
    state: string;
    actionIndex: number;
  } {
    const state = formatRegimeKey(features);

    if (!this.qTable.has(state)) {
      this.qTable.set(state, this.initHeuristicQValues(state));
    }

    const qValues = this.qTable.get(state)!;
    let actionIndex: number;

    if (Math.random() < this.epsilon) {
      actionIndex = Math.floor(Math.random() * this.actions.length);
    } else {
      let maxVal = -Infinity;
      let bestIdx = 0;
      for (let i = 0; i < qValues.length; i++) {
        if (qValues[i]! > maxVal) {
          maxVal = qValues[i]!;
          bestIdx = i;
        }
      }
      actionIndex = bestIdx;
    }

    return {
      params: this.actions[actionIndex]!,
      state,
      actionIndex,
    };
  }

  /**
   * Bellman update: Q(s,a) += lr * (reward + gamma * max_a' Q(s',a') - Q(s,a)).
   *
   * `nextState` must be the regime observed *after* this decision resolved
   * (e.g. the market state when the resulting trade closed), not `state`
   * itself — bootstrapping off the same state being updated double-counts the
   * action just taken and drives every Q-value into a uniform upward drift
   * regardless of actual outcome (the C-08 bug). When there is no meaningful
   * next state (a one-shot/terminal decision), omit it: the future-value term
   * is then 0, which is the correct degenerate case, not a reuse of `state`.
   */
  public learn(state: string, actionIndex: number, reward: number, nextState?: string): void {
    if (!this.qTable.has(state)) {
      this.qTable.set(state, this.initHeuristicQValues(state));
    }
    const qValues = this.qTable.get(state)!;
    const currentQ = qValues[actionIndex] ?? 0;

    let maxNextQ = 0;
    if (nextState !== undefined) {
      if (!this.qTable.has(nextState)) {
        this.qTable.set(nextState, this.initHeuristicQValues(nextState));
      }
      maxNextQ = Math.max(...this.qTable.get(nextState)!);
    }

    const newQ = currentQ + this.learningRate * (reward + this.discountFactor * maxNextQ - currentQ);
    qValues[actionIndex] = Math.round(newQ * 1000) / 1000;

    if (this.persistencePath) {
      this.saveMemory(this.persistencePath);
    }
  }

  public saveMemory(filePath: string): void {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const obj = Object.fromEntries(this.qTable);
      fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (err) {
      logger.warn({ err, filePath }, 'Failed to save adaptive supertrend memory');
    }
  }

  public loadMemory(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf-8');
        const obj = JSON.parse(data) as Record<string, number[]>;
        this.qTable = new Map(Object.entries(obj));
        logger.info({ states: this.qTable.size }, 'Loaded adaptive supertrend Q-table');
      }
    } catch (err) {
      logger.warn({ err, filePath }, 'Failed to load adaptive supertrend memory');
    }
  }

  public getLearnedStatesCount(): number {
    return this.qTable.size;
  }
}
