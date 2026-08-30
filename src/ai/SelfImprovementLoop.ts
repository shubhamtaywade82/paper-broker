import type { Fill } from '../broker/types.js';
import { ReflectionSchema, type Reflection } from './schemas.js';
import { AgentMemoryStore, type RetrieveLessonsQuery } from './memory/AgentMemoryStore.js';
import type { ModelManager, CompletionRequest } from './ModelManager.js';
import { logger } from '../telemetry/logger.js';

/**
 * SelfImprovementLoop
 * ===================
 *
 * Closes the self-learning loop:
 *
 *   broker.onFill (closing fills only)
 *     → build a reflection prompt with the trade's context
 *     → ModelManager.complete({ json: true }) → ReflectionSchema
 *     → persist via AgentMemoryStore.recordReflection()
 *     → next analyst cycle calls loop.renderAgentMemoryFor(ctx) to inject
 *       the top-K relevant lessons into the LLM prompt
 *
 * Soft-dependency contract (same as TradingAgentsPipeline.checkOllamaReachable):
 * if the LLM is unreachable or returns invalid JSON, the reflection is
 * skipped silently. Trading is NEVER blocked by this loop — it is purely
 * advisory enrichment of the analyst stage.
 *
 * LLM Authority Contract (CONTRACTS.md §5) is preserved: the reflection is
 * advisory-only and only enters the LLM-facing analyst/trader prompts. It
 * NEVER influences the deterministic risk-team or fund-manager stages.
 *
 * The loop is best-effort async: engine.ts wires `broker.onFill` to call
 * `loop.onClosingFill()` without awaiting — a slow LLM call must not stall
 * the fill path (CONTRACTS.md §19: Observer Isolation).
 */
export interface SelfImprovementLoopConfig {
  /** Soft per-reflection LLM call timeout (ms). */
  timeoutMs: number;
  /** LLM temperature for reflection generation. Lower = more focused. */
  temperature: number;
  /** Max output tokens for the reflection. */
  maxTokens: number;
}

export interface SelfImprovementLoopDeps {
  modelManager: ModelManager;
  store: AgentMemoryStore;
  /** Optional regime label provider — used to tag the reflection. */
  getRegime?: (symbol: string) => string | undefined;
  /** Optional setup-archetype resolver — attributes a closed trade to a setup. */
  getSetupArchetype?: (symbol: string) => string | undefined;
}

const DEFAULT_CONFIG: SelfImprovementLoopConfig = {
  timeoutMs: 30_000,
  temperature: 0.4,
  maxTokens: 1_500,
};

export class SelfImprovementLoop {
  private config: SelfImprovementLoopConfig;
  private deps: SelfImprovementLoopDeps;
  /** In-flight reflection promises — deduplicate the same fill id. */
  private inFlight = new Map<string, Promise<void>>();

  constructor(deps: SelfImprovementLoopDeps, config: Partial<SelfImprovementLoopConfig> = {}) {
    this.deps = deps;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Entry point for the broker's onFill hook. Filters to closing fills only
   * (realizedPnl !== 0), then dispatches the reflection asynchronously.
   *
   * Returns immediately — the LLM call happens in the background. A thrown
   * error inside the background path is caught and logged, never propagated.
   */
  onClosingFill(fill: Fill): void {
    // Only closing fills realize PnL; opening fills realize 0 and are
    // ignored — same convention as engine.ts's existing onFill hook.
    if (fill.realizedPnl === 0) return;
    if (!fill.strategyId) return; // manual trades have no strategy to learn from

    // Dedupe: if the same fill id is already being processed, skip.
    if (this.inFlight.has(fill.id)) return;

    const promise = this.reflectOnFill(fill).finally(() => {
      this.inFlight.delete(fill.id);
    });
    this.inFlight.set(fill.id, promise);

    // Detach — never propagate to the broker's onFill path.
    promise.catch((err) => {
      logger.warn(
        { err, fillId: fill.id, symbol: fill.symbol },
        '[SelfImprovementLoop] reflection failed (soft-fail, trading continues)'
      );
    });
  }

  /**
   * Render the top-K decay-weighted lessons relevant to a context, ready to
   * drop into the LLM analyst prompt as `ctx.agentMemory`. Returns '' when
   * the memory store is empty or no lessons are above the decay floor.
   *
   * Called by the TradingAgentsPipeline analyst stage before building its
   * prompt. Sync because the store uses better-sqlite3 (sync API).
   */
  renderAgentMemoryFor(query: RetrieveLessonsQuery): string {
    return this.deps.store.renderAgentMemoryForPrompt(query);
  }

  /**
   * Apply lesson decay + prune old reflections. Called once per cycle by
   * the engine (e.g. via Scheduler). Safe to call multiple times — it's
   * idempotent within the day.
   */
  runDecayAndPrune(): { prunedLessons: number; prunedReflections: number } {
    const prunedLessons = this.deps.store.decayLessons();
    const prunedReflections = this.deps.store.pruneOlderThan();
    return { prunedLessons, prunedReflections };
  }

  private async reflectOnFill(fill: Fill): Promise<void> {
    const regime = this.deps.getRegime?.(fill.symbol);
    const setupArchetype = this.deps.getSetupArchetype?.(fill.symbol);

    const action = inferAction(fill);
    const prompt = buildReflectionPrompt({
      fill,
      action,
      regime,
      setupArchetype,
    });

    const req: CompletionRequest = {
      system:
        'You are a structured trading postmortem engine. Analyze the closed trade and produce a focused reflection: what evidence was real, what was noise, what to do differently. Output strict JSON matching the ReflectionSchema. NEVER claim data you were not given.',
      prompt,
      json: true,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
    };

    let reflection: Reflection;
    try {
      const res = await this.deps.modelManager.complete(req);
      const parsed = ReflectionSchema.safeParse(JSON.parse(res.text));
      if (!parsed.success) {
        logger.warn(
          { fillId: fill.id, symbol: fill.symbol, issues: parsed.error.issues },
          '[SelfImprovementLoop] reflection did not validate against schema — skipping (soft-fail)'
        );
        return;
      }
      reflection = parsed.data;
    } catch (err) {
      // Soft-fail: model unreachable, JSON parse error, etc. The fill still
      // went through; we just don't have a reflection for it.
      logger.warn(
        { err, fillId: fill.id, symbol: fill.symbol },
        '[SelfImprovementLoop] LLM reflection call failed (soft-fail, skipping)'
      );
      return;
    }

    const reflectionId = this.deps.store.recordReflection({
      ts: new Date(fill.fillTsUtc).getTime(),
      symbol: fill.symbol,
      regime,
      strategyId: fill.strategyId!,
      action,
      outcomePnlUsdt: fill.realizedPnl,
      setupArchetype,
      reflection,
      modelUsed: 'gemma3:27b', // populated by ModelManager in practice; here for store
      cycleId: fill.signalId,
    });

    logger.info(
      { fillId: fill.id, reflectionId, symbol: fill.symbol, action, pnl: fill.realizedPnl, lessons: reflection.lessons.length },
      '[SelfImprovementLoop] reflection recorded'
    );
  }
}

/**
 * Infer the trade action label from the fill's `side` + `positionQtyBefore/After`.
 *
 * Closing a long = SELL + position qty drops → CLOSE_LONG.
 * Closing a short = BUY + position qty rises toward 0 → CLOSE_SHORT.
 * Edge case (flips): we report the side that just closed.
 */
function inferAction(fill: Fill): string {
  const qtyBefore = fill.positionQtyBefore;
  const qtyAfter = fill.positionQtyAfter;
  if (fill.side === 'SELL') {
    if (qtyAfter < qtyBefore && qtyAfter >= 0) return 'CLOSE_LONG';
    return 'OPEN_SHORT';
  }
  if (fill.side === 'BUY') {
    if (qtyAfter > qtyBefore && qtyAfter <= 0) return 'CLOSE_SHORT';
    return 'OPEN_LONG';
  }
  return 'UNKNOWN';
}

interface PromptInput {
  fill: Fill;
  action: string;
  regime?: string;
  setupArchetype?: string;
}

function buildReflectionPrompt(input: PromptInput): string {
  const { fill, action, regime, setupArchetype } = input;
  const pnl = fill.realizedPnl;
  const outcome = pnl > 0 ? 'WIN' : pnl < 0 ? 'LOSS' : 'BREAKEVEN';

  return [
    `Postmortem for closed trade on ${fill.symbol}:`,
    `- action: ${action}`,
    `- outcome: ${outcome} (${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT)`,
    `- side: ${fill.side}, qty: ${fill.quantity}, fill price: ${fill.price}`,
    `- position before: ${fill.positionQtyBefore}, after: ${fill.positionQtyAfter}`,
    regime ? `- regime at close: ${regime}` : '',
    setupArchetype ? `- setup archetype: ${setupArchetype}` : '',
    fill.slippageBps !== undefined ? `- slippage: ${fill.slippageBps} bps` : '',
    fill.marketMark !== undefined ? `- mark price at fill: ${fill.marketMark}` : '',
    '',
    'Produce a JSON object with fields:',
    '- reflection: short paragraph (10-2000 chars) on what evidence was real vs noise',
    '- lessons: array of up to 10 short, specific lessons (3-300 chars each)',
    '- selfConfidence: 0..1 — how confident you are in this postmortem',
    '- nextTime: one short sentence on what to do differently next time',
    '',
    'Do NOT invent data. Only use the values above. Be concrete.',
  ].filter(Boolean).join('\n');
}
