import { z } from 'zod';
import { config } from 'dotenv';
import { resolveRuntimeProfile } from './modes/resolver.js';

config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),

  API_KEY: z
    .string()
    .optional()
    .transform((val) => (val && val.trim() !== '' ? val.trim() : undefined))
    .refine((val) => val === undefined || val.length >= 16, {
      message: 'String must contain at least 16 character(s)',
    }),
  LIVE_ARM_PASSCODE: z
    .string()
    .optional()
    .transform((val) => (val && val.trim() !== '' ? val.trim() : undefined))
    .refine((val) => val === undefined || val.length >= 4, {
      message: 'String must contain at least 4 character(s)',
    }),

  TRADING_MODE: z.enum(['paper', 'shadow', 'live']).default('paper'),
  LIVE_TRADING_ARMED: z
    .string()
    .optional()
    .transform((val) => val === 'true'),

  BINANCE_ENV: z.enum(['testnet', 'mainnet', 'production']).default('testnet'),
  BINANCE_API_KEY: z.string().optional(),
  BINANCE_API_SECRET: z.string().optional(),

  COINDCX_API_KEY: z.string().optional(),
  COINDCX_API_SECRET: z.string().optional(),

  TELEGRAM_ENABLED: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  TELEGRAM_MIN_LEVEL: z.enum(['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']).default('INFO'),

  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('qwen3.5:2b'),
  OLLAMA_API_KEY_1: z.string().optional(),
  OLLAMA_API_KEY_2: z.string().optional(),
  OLLAMA_API_KEY_3: z.string().optional(),
  OLLAMA_CLOUD_BASE_URL: z.string().url().default('https://ollama.com'),
  OLLAMA_CLOUD_MODEL: z.string().default('gemma4:cloud'),

  PAPER_STARTING_USDT: z.coerce.number().positive().default(10000),

  // Profit goals (src/trading/goals). Disabled by default so existing
  // deployments keep their current always-trading behaviour until opted in.
  PROFIT_GOALS_ENABLED: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
  PROFIT_GOAL_DAILY_TARGET_PCT: z.coerce.number().min(0).max(1).default(0.02),
  PROFIT_GOAL_WEEKLY_TARGET_PCT: z.coerce.number().min(0).max(1).default(0.08),
  PROFIT_GOAL_MONTHLY_TARGET_PCT: z.coerce.number().min(0).max(1).default(0.2),
  PROFIT_GOAL_ACTION: z.enum(['REDUCE_RISK', 'STOP_TRADING', 'TRAIL_STOPS']).default('REDUCE_RISK'),
  PROFIT_GOAL_RISK_REDUCTION_FACTOR: z.coerce.number().min(0).max(1).default(0.5),
  PROFIT_GOAL_COOLDOWN_MS: z.coerce.number().int().min(0).default(3_600_000),
  PROFIT_GOAL_ENABLE_DAILY: z
    .string()
    .optional()
    .transform((val) => val !== 'false'),
  PROFIT_GOAL_ENABLE_WEEKLY: z
    .string()
    .optional()
    .transform((val) => val !== 'false'),
  PROFIT_GOAL_ENABLE_MONTHLY: z
    .string()
    .optional()
    .transform((val) => val === 'true'),

  // Trailing stops (src/trading/risk/TrailingStopManager).
  TRAILING_STOPS_ENABLED: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
  TRAILING_ACTIVATION_PCT: z.coerce.number().min(0).max(1).default(0.02),
  TRAILING_DISTANCE_PCT: z.coerce.number().min(0).max(1).default(0.015),
  TRAILING_BREAKEVEN_PCT: z.coerce.number().min(0).max(1).default(0.01),

  // Per-strategy performance feedback (src/strategy/StrategyPerformanceTracker).
  STRATEGY_FEEDBACK_ENABLED: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
  STRATEGY_FEEDBACK_MIN_TRADES: z.coerce.number().int().positive().default(20),
  STRATEGY_FEEDBACK_MAX_DRAWDOWN_USDT: z.coerce.number().positive().default(500),
  STRATEGY_FEEDBACK_MIN_WIN_RATE: z.coerce.number().min(0).max(1).default(0.3),

  // Autonomous trading agent (src/agent/AutonomousTradingAgent.ts).
  // ENABLED BY DEFAULT — `pnpm start` boots the engine in fully autonomous
  // mode. The agent runs on its own clock independent of candle-close events,
  // surveys every symbol across the MTF stack on each cycle, detects FORMING
  // setups (state WATCHING..RETEST) and READY setups, validates HTF regime +
  // LTF trigger alignment, adapts risk parameters per regime, and submits
  // signals through the same StrategyEngine pipeline regular strategies use.
  //
  // Opt-out: set AUTONOMOUS_AGENT_ENABLED=false for the legacy candle-driven-
  // only behaviour (used to debug the strategy fleet in isolation, or for the
  // explicit paper:candle-only script which sets this for you).
  AUTONOMOUS_AGENT_ENABLED: z
    .string()
    .optional()
    // Default true (autonomous-first). Only an explicit "false" disables it.
    .transform((val) => val !== 'false'),
  AUTONOMOUS_CYCLE_MS: z.coerce.number().int().min(5_000).default(30_000),
  AUTONOMOUS_MIN_CONFLUENCE: z.coerce.number().min(0).max(100).default(65),
  AUTONOMOUS_MIN_RR: z.coerce.number().positive().default(1.5),
  AUTONOMOUS_MAX_OPEN_POSITIONS: z.coerce.number().int().positive().default(3),
  AUTONOMOUS_PER_SYMBOL_MAX_POSITIONS: z.coerce.number().int().positive().default(1),
  AUTONOMOUS_COOLDOWN_MS: z.coerce.number().int().min(0).default(300_000),
  AUTONOMOUS_REGIME_CONFIRMATION_BARS: z.coerce.number().int().positive().default(3),
  AUTONOMOUS_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.55),
  AUTONOMOUS_STRATEGY_ID: z.string().min(1).default('autonomous-agent'),
  // --- Circuit breaker (self-preservation) --------------------------------
  // Trip the agent (stop new entries) when ANY of these breach. Existing
  // positions continue to be managed by their stop/target/trailing logic.
  AUTONOMOUS_CB_MAX_DAILY_LOSS_PCT: z.coerce.number().min(0).max(1).default(0.03),
  AUTONOMOUS_CB_MAX_CONSECUTIVE_LOSSES: z.coerce.number().int().min(1).default(5),
  AUTONOMOUS_CB_MAX_DRAWDOWN_PCT: z.coerce.number().min(0).max(1).default(0.08),
  AUTONOMOUS_CB_COOLDOWN_MS: z.coerce.number().int().min(1_000).default(900_000),
  AUTONOMOUS_CB_REQUIRE_HEALTHY_MARKET: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  // --- Learning loop (adaptive parameters) --------------------------------
  // How many recent closed trades to consider when nudging params. Larger =
  // smoother but slower to react; smaller = noisier but quicker.
  AUTONOMOUS_LEARN_WINDOW_SIZE: z.coerce.number().int().min(5).max(500).default(30),
  // Minimum trades before nudging kicks in (avoid small-sample knee-jerks).
  AUTONOMOUS_LEARN_MIN_SAMPLE: z.coerce.number().int().min(2).max(100).default(5),
  // How aggressively to nudge risk multiplier toward observed win rate.
  // 0 = never adjust; 0.1 = small steps; 0.5 = aggressive.
  AUTONOMOUS_LEARN_RISK_ADAPT_STEP: z.coerce.number().min(0).max(1).default(0.1),
  // Floor and ceiling on the runtime risk multiplier.
  AUTONOMOUS_LEARN_RISK_MULT_MIN: z.coerce.number().min(0.05).max(1).default(0.5),
  AUTONOMOUS_LEARN_RISK_MULT_MAX: z.coerce.number().min(1).max(3).default(1.5),
  // --- Exit manager (intra-position decisions) ----------------------------
  // Allow the agent to flatten a position whose regime has flipped against
  // it, even if the trailing stop hasn't fired yet.
  AUTONOMOUS_EXIT_ON_REGIME_FLIP: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  // If unrealized loss exceeds this fraction of equity, exit regardless of
  // stop. 0 = disabled.
  AUTONOMOUS_EXIT_MAX_UNREALIZED_LOSS_PCT: z.coerce.number().min(0).max(1).default(0.02),
  // --- Position scaling (AUTONOMY_AUDIT Finding 2) ------------------------
  // Pyramid into winners + one-time downside de-risk of losers. Enabled by
  // default (autonomous-first); every knob is bounded independently.
  AUTONOMOUS_SCALING_ENABLED: z
    .string()
    .optional()
    // Default true. Only an explicit "false" disables it.
    .transform((val) => val !== 'false'),
  // Unrealized PROFIT as a fraction of equity required before a pyramid add
  // (0.01 = 1%). Only winners get added to.
  AUTONOMOUS_SCALE_IN_MIN_PROFIT_PCT: z.coerce.number().min(0).max(1).default(0.01),
  // Each add's quantity as a fraction of the CURRENT position size
  // (0.5 = classic decreasing pyramid).
  AUTONOMOUS_SCALE_IN_SIZE_FRACTION: z.coerce.number().min(0.01).max(1).default(0.5),
  // Max adds per position lifecycle.
  AUTONOMOUS_SCALE_IN_MAX_ADDS: z.coerce.number().int().min(0).max(5).default(1),
  // Min time between adds on the same position.
  AUTONOMOUS_SCALE_IN_COOLDOWN_MS: z.coerce.number().int().min(0).default(900_000),
  // Unrealized LOSS (fraction of equity) that triggers a one-time partial
  // de-risk. Should sit comfortably below
  // AUTONOMOUS_EXIT_MAX_UNREALIZED_LOSS_PCT (the full-breach threshold).
  AUTONOMOUS_SCALE_OUT_TRIGGER_PCT: z.coerce.number().min(0).max(1).default(0.01),
  // Fraction of the position closed by the de-risk (0.5 = close half).
  AUTONOMOUS_SCALE_OUT_CLOSE_FRACTION: z.coerce.number().min(0.01).max(1).default(0.5),
  // --- Symbol lock (multi-strategy orchestration, AUTONOMY_AUDIT Finding 3)
  // When enabled, the first strategy whose OPEN signal is accepted owns the
  // symbol for SYMBOL_LOCK_TTL_MS — other strategies' OPENs on that symbol
  // are rejected (with a reason) so the autonomous agent and candle-driven
  // strategies (e.g. smc-agent) can never race each other into conflicting
  // entries on the same symbol. CLOSE/CANCEL_ALL always pass.
  SYMBOL_LOCK_ENABLED: z
    .string()
    .optional()
    // Default true. Only an explicit "false" disables it.
    .transform((val) => val !== 'false'),
  SYMBOL_LOCK_TTL_MS: z.coerce.number().int().min(1_000).default(300_000),
  // --- LLM veto via debate consultation (AUTONOMY_AUDIT Finding 1) --------
  // When enabled (default) and the TradingAgentsPipeline is wired, every
  // entry candidate goes in front of the bull/bear debate before submission;
  // a genuine NEUTRAL / opposing trader verdict vetoes the entry. A degraded
  // consultation (model unavailable) never vetoes — the agent stays
  // best-effort, exactly like the plain confidence probe.
  AUTONOMOUS_LLM_VETO_ENABLED: z
    .string()
    .optional()
    // Default true. Only an explicit "false" disables it.
    .transform((val) => val !== 'false'),
  // --- Weighted HTF alignment (AUTONOMY_AUDIT Finding 5) -----------------
  // Weight the setup's confluence by how strongly the 4h trend supports the
  // direction instead of the legacy binary pass/fail gate. Set
  // AUTONOMOUS_HTF_ALIGNMENT_WEIGHTED=false to restore the binary gate.
  AUTONOMOUS_HTF_ALIGNMENT_WEIGHTED: z
    .string()
    .optional()
    // Default true. Only an explicit "false" disables it.
    .transform((val) => val !== 'false'),
  // Confluence weight when the 4h trend is RANGE/UNKNOWN, or when a REVERSAL
  // archetype counters the 4h trend (0.7 = a 90/100 setup scores 63).
  AUTONOMOUS_HTF_RANGE_WEIGHT: z.coerce.number().min(0).max(1).default(0.7),
  // Confluence weight for a NON-reversal setup countering the 4h trend
  // (0.3 = counter-trend setups need near-perfect confluence to clear 65).
  AUTONOMOUS_HTF_COUNTER_WEIGHT: z.coerce.number().min(0).max(1).default(0.3),
  // --- Correlation-aware portfolio risk (AUTONOMY_AUDIT Finding 8) -------
  // Cap the margin-weighted exposure a symbol may ADD to its correlated
  // cluster (same-direction open positions with |Pearson ρ| ≥ floor,
  // estimated over AUTONOMOUS_CORRELATION_LOOKBACK candles of 1h). Blocks
  // the "BTC + ETH + SOL all long" concentration the count-based
  // maxOpenPositions gate can't see.
  AUTONOMOUS_CORRELATION_ENABLED: z
    .string()
    .optional()
    // Default true. Only an explicit "false" disables it.
    .transform((val) => val !== 'false'),
  AUTONOMOUS_CORRELATION_FLOOR: z.coerce.number().min(0).max(1).default(0.7),
  AUTONOMOUS_CORRELATION_MAX_EXPOSURE_PCT: z.coerce
    .number()
    .min(0.01)
    .max(1)
    .default(0.25),
  AUTONOMOUS_CORRELATION_LOOKBACK: z.coerce.number().int().min(10).max(500).default(50),
  // --- Health monitor (self-diagnostics) ----------------------------------
  AUTONOMOUS_HEALTH_STALE_MS: z.coerce.number().int().min(1_000).default(15_000),
  AUTONOMOUS_HEALTH_MODEL_PROBE_INTERVAL_MS: z.coerce.number().int().min(60_000).default(300_000),

  // --- Startup self-test (src/agent/StartupSelfTest.ts) -------------------
  // Runs once at startup before the agent's first cycle. When true (default),
  // any CRITICAL check failure halts the engine so the operator sees the
  // problem immediately instead of discovering silent degradation hours
  // later. Set to false to continue anyway (e.g. for dev / debugging).
  AUTONOMOUS_SELF_TEST_FAIL_ON_CRITICAL: z
    .string()
    .optional()
    // Default true (fail-fast). Only an explicit "false" disables it.
    .transform((val) => val !== 'false'),

  // Per-setup-archetype performance feedback for the SMC agent
  // (src/strategy/strategies/smc-agent.ts, reuses StrategyPerformanceTracker
  // keyed by setup type instead of strategy id). Lower default trade count
  // than STRATEGY_FEEDBACK_MIN_TRADES because a single symbol sees fewer
  // occurrences of one specific setup archetype than the whole strategy does.
  SETUP_FEEDBACK_ENABLED: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
  SETUP_FEEDBACK_MIN_TRADES: z.coerce.number().int().positive().default(10),
  SETUP_FEEDBACK_MAX_DRAWDOWN_USDT: z.coerce.number().positive().default(300),
  SETUP_FEEDBACK_MIN_WIN_RATE: z.coerce.number().min(0).max(1).default(0.3),

  DB_FILE: z.string().default('data/paper.sqlite3'),
  EVENT_LOG_FILE: z.string().default('data/events.jsonl'),
  SNAPSHOT_DIR: z.string().default('data/snapshots'),
  ANALYTICS_DIR: z.string().default('data/analytics'),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),

  SYMBOLS: z.string().default('SOLUSDT,BTCUSDT,ETHUSDT,BNBUSDT,XRPUSDT'),
  TIMEFRAMES: z.string().default('1m,5m,15m,1h,4h,1d'),

  EMA_FAST_PERIOD: z.coerce.number().int().positive().default(9),
  EMA_SLOW_PERIOD: z.coerce.number().int().positive().default(21),
  EMA_RSI_UPPER: z.coerce.number().min(0).max(100).default(70),
  EMA_RSI_LOWER: z.coerce.number().min(0).max(100).default(30),

  BREAKOUT_LOOKBACK: z.coerce.number().int().positive().default(20),
  BREAKOUT_ATR_STOP_MULT: z.coerce.number().positive().default(2),
  BREAKOUT_ATR_TP_MULT: z.coerce.number().positive().default(4),

  RSI_OVERSOLD: z.coerce.number().min(0).max(100).default(30),
  RSI_OVERBOUGHT: z.coerce.number().min(0).max(100).default(70),
  RSI_NEUTRAL_HIGH: z.coerce.number().min(0).max(100).default(55),
  RSI_NEUTRAL_LOW: z.coerce.number().min(0).max(100).default(45),
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export const symbols = env.SYMBOLS.split(',').map((s) => s.trim());
export const timeframes = env.TIMEFRAMES.split(',').map((s) => s.trim());

export const runtimeProfile = resolveRuntimeProfile({
  TRADING_MODE: env.TRADING_MODE,
  LIVE_TRADING_ARMED: env.LIVE_TRADING_ARMED,
  TELEGRAM_ENABLED: env.TELEGRAM_ENABLED,
  TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: env.TELEGRAM_CHAT_ID,
  COINDCX_API_KEY: env.COINDCX_API_KEY,
  COINDCX_API_SECRET: env.COINDCX_API_SECRET,
});