import { describe, it, expect, vi } from 'vitest';
import {
  logger,
  moduleLogger,
  createRequestLogger,
  serializeError,
  logError,
  parseTraceparent,
} from '../../src/telemetry/logger.js';

describe('telemetry/logger', () => {
  it('creates module child logger with module metadata', () => {
    const child = moduleLogger('risk_engine');
    expect(child).toBeDefined();
    expect(typeof child.info).toBe('function');
  });

  it('creates request child logger with generated or custom requestId', () => {
    const reqLogger1 = createRequestLogger({});
    expect(reqLogger1).toBeDefined();

    const customId = 'req-12345';
    const reqLogger2 = createRequestLogger({ requestId: customId, userId: 'user-1' });
    expect(reqLogger2).toBeDefined();
  });

  it('serializes Error instances into loggable objects with stack and properties', () => {
    const err = new Error('Database connection failed');
    (err as Error & { code?: string }).code = 'ECONNREFUSED';

    const serialized = serializeError(err);
    expect(serialized.name).toBe('Error');
    expect(serialized.message).toBe('Database connection failed');
    expect(serialized.stack).toBeDefined();
    expect(serialized.code).toBe('ECONNREFUSED');
  });

  it('serializes non-Error values as string messages', () => {
    const serialized = serializeError('unexpected failure string');
    expect(serialized).toEqual({ message: 'unexpected failure string' });
  });

  it('logs caught errors with serialized error context', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const testErr = new Error('Test error');

    logError(logger, 'Operation failed', testErr, { symbol: 'SOLUSDT' });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const loggedArg = errorSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(loggedArg.symbol).toBe('SOLUSDT');
    expect(loggedArg.err).toMatchObject({ message: 'Test error', name: 'Error' });
    expect(errorSpy.mock.calls[0][1]).toBe('Operation failed');

    errorSpy.mockRestore();
  });

  it('parses valid W3C traceparent headers', () => {
    const header = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const parsed = parseTraceparent(header);

    expect(parsed).toEqual({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
    });
  });

  it('returns null for invalid or missing traceparent headers', () => {
    expect(parseTraceparent(undefined)).toBeNull();
    expect(parseTraceparent(null)).toBeNull();
    expect(parseTraceparent('invalid-header')).toBeNull();
    expect(parseTraceparent(12345)).toBeNull();
  });
});
