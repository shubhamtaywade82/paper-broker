import { z } from 'zod';
import { config } from 'dotenv';
import { resolveRuntimeProfile } from './modes/resolver.js';

config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),

  TRADING_MODE: z.enum(['paper', 'shadow', 'live']).default('paper'),
  LIVE_TRADING_ARMED: z
    .string()
    .optional()
    .transform((val) => val === 'true'),

  BINANCE_ENV: z.enum(['testnet', 'production']).default('testnet'),
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

  PAPER_STARTING_USDT: z.coerce.number().positive().default(10000),

  DB_FILE: z.string().default('data/paper.sqlite3'),
  EVENT_LOG_FILE: z.string().default('data/events.jsonl'),
  SNAPSHOT_DIR: z.string().default('data/snapshots'),
  ANALYTICS_DIR: z.string().default('data/analytics'),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),

  SYMBOLS: z.string().default('SOLUSDT,ETHUSDT,XRPUSDT'),
  TIMEFRAMES: z.string().default('1m,5m,15m'),

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