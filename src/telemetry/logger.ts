import pino, { type Logger, type LoggerOptions } from 'pino';
import { randomUUID } from 'node:crypto';

/**
 * Structured logging core (Pino).
 *
 * Design goals for an autonomous trading backend:
 *   1. Machine-queryable JSON on stdout in production — the platform
 *      (Docker / systemd / any collector) ships the lines.
 *   2. Every log line carries service metadata: service, env, version,
 *      trading mode — so mixed-fleet deployments stay filterable.
 *   3. Secrets never reach stdout. Venue credentials, API tokens,
 *      passcodes, Authorization headers and cookies are redacted centrally.
 *   4. Request-scoped child loggers give every HTTP request a stable
 *      `requestId` that the frontend echoes via `x-request-id`.
 *   5. Pretty printing ONLY in development (pino-pretty).
 *
 * Levels (Pino standard): fatal > error > warn > info > debug > trace.
 */

const isDev = process.env['NODE_ENV'] !== 'production';

const options: LoggerOptions = {
  level: process.env['LOG_LEVEL'] ?? (isDev ? 'debug' : 'info'),
  base: {
    service: process.env['SERVICE_NAME'] ?? 'paper-broker',
    env: process.env['NODE_ENV'] ?? 'development',
    version: process.env['GIT_SHA'] ?? process.env['APP_VERSION'] ?? 'dev',
    mode: process.env['TRADING_MODE'] ?? 'paper',
  },
  redact: {
    paths: [
      // Generic secrets
      'password', 'token', 'accessToken', 'refreshToken', 'secret',
      'authorization', 'cookie', 'apiKey', 'apiKeySecret', 'pin',
      // Venue & infrastructure credentials
      'binanceApiKey', 'binanceApiSecret', 'coindcxApiKey', 'coindcxApiSecret',
      'telegramBotToken', 'liveArmPasscode', 'passcode',
      'ollamaApiKey1', 'ollamaApiKey2', 'ollamaApiKey3',
      // Nested wildcards
      '*.password', '*.token', '*.accessToken', '*.refreshToken',
      '*.secret', '*.authorization', '*.cookie', '*.pin',
      '*.apiKey', '*.apiKeySecret', '*.binanceApiKey', '*.binanceApiSecret',
      '*.coindcxApiKey', '*.coindcxApiSecret', '*.telegramBotToken',
      '*.liveArmPasscode', '*.passcode',
      // HTTP request serialization
      'req.headers.authorization', 'req.headers.cookie',
      'req.headers["x-api-key"]', 'req.headers["x-access-token"]',
      // Client log extras
      'events[*].token', 'events[*].password', 'extras.token', 'extras.password',
    ],
    censor: '[REDACTED]',
  },
  // ISO 8601 timestamps — time-zone safe (UTC trading hours!), sortable.
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
            singleLine: false,
          },
        },
      }
    : {}),
};

export const logger: Logger = pino(options);

/**
 * Per-module child logger (e.g. `moduleLogger('risk')` → { module: 'risk' }).
 * Use for long-lived subsystems: engine, broker, market, agent, risk...
 */
export function moduleLogger(module: string, extra: Record<string, unknown> = {}): Logger {
  return logger.child({ module, ...extra });
}

/**
 * Request-scoped logger factory. Accepts an upstream `requestId`
 * (frontend `x-request-id`) or generates one; OpenTelemetry trace/span
 * ids from a `traceparent` header are folded in when present so logs
 * and traces stay linkable without running a full OTel SDK.
 */
export function createRequestLogger(bindings: {
  requestId?: string;
  userId?: string | number | null;
  traceId?: string;
  spanId?: string;
  [key: string]: unknown;
}): Logger {
  return logger.child({
    requestId: bindings.requestId ?? randomUUID(),
    ...bindings,
  });
}

/** Normalizes any thrown value into a loggable error object with stack. */
export function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const errorObj = err as Error & { code?: unknown; status?: unknown };
    return {
      name: errorObj.name,
      message: errorObj.message,
      stack: errorObj.stack,
      ...(errorObj.code !== undefined ? { code: errorObj.code } : {}),
      ...(errorObj.status !== undefined ? { status: errorObj.status } : {}),
    };
  }
  return { message: String(err) };
}

/** Logs a caught error with full context — the standard catch-block helper. */
export function logError(
  log: Logger,
  message: string,
  err: unknown,
  extra: Record<string, unknown> = {},
): void {
  log.error({ err: serializeError(err), ...extra }, message);
}

/** Parses a W3C `traceparent` header → { traceId, spanId } or null. */
export function parseTraceparent(header: unknown): { traceId: string; spanId: string } | null {
  if (typeof header !== 'string') return null;
  const match = header.match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/);
  if (!match || !match[1] || !match[2]) return null;
  return { traceId: match[1], spanId: match[2] };
}

export type { Logger, LoggerOptions };
export default logger;