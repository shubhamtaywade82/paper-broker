import { z } from 'zod';
import { config } from 'dotenv';
import { resolveRuntimeProfile } from './modes/resolver.js';

config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),

  API_KEY: z.string().min(16).optional(),
  LIVE_ARM_PASSCODE: z.string().min(4).optional(),

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
  // When enabled, the agent runs on its own clock independent of candle-close
  // events, surveys every symbol across the MTF stack on each cycle, detects
  // FORMING setups (state WATCHING..RETEST) and READY setups, validates HTF
  // regime + LTF trigger alignment, adapts risk parameters per regime, and
  // submits signals through the same StrategyEngine pipeline.
  AUTONOMOUS_AGENT_ENABLED: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
  AUTONOMOUS_CYCLE_MS: z.coerce.number().int().min(5_000).default(30_000),
  AUTONOMOUS_MIN_CONFLUENCE: z.coerce.number().min(0).max(100).default(65),
  AUTONOMOUS_MIN_RR: z.coerce.number().positive().default(1.5),
  AUTONOMOUS_MAX_OPEN_POSITIONS: z.coerce.number().int().positive().default(3),
  AUTONOMOUS_PER_SYMBOL_MAX_POSITIONS: z.coerce.number().int().positive().default(1),
  AUTONOMOUS_COOLDOWN_MS: z.coerce.number().int().min(0).default(300_000),
  AUTONOMOUS_REGIME_CONFIRMATION_BARS: z.coerce.number().int().positive().default(3),
  AUTONOMOUS_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.55),
  AUTONOMOUS_STRATEGY_ID: z.string().min(1).default('autonomous-agent'),

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