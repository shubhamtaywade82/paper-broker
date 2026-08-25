import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createShutdownHandler } from '../../src/index.js';
import type { EngineHandle } from '../../src/engine.js';

describe('createShutdownHandler (H-13)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stops the engine once and exits with code 0', async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const engine: EngineHandle = { stop };
    const exit = vi.fn();

    const shutdown = createShutdownHandler(engine, exit);
    await shutdown('SIGINT');

    expect(stop).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('ignores a second concurrent/rapid signal instead of calling engine.stop() twice', async () => {
    let resolveStop: () => void = () => {};
    const stop = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { resolveStop = resolve; }));
    const engine: EngineHandle = { stop };
    const exit = vi.fn();

    const shutdown = createShutdownHandler(engine, exit);
    const first = shutdown('SIGINT');
    // Second signal arrives while the first shutdown is still in flight.
    const second = shutdown('SIGTERM');

    resolveStop();
    await Promise.all([first, second]);

    // engine.stop() (which closes the shared SQLite connection) must only
    // ever be invoked once, however many signals arrive.
    expect(stop).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('force-exits with code 1 if engine.stop() never resolves within the timeout', async () => {
    const stop = vi.fn().mockImplementation(() => new Promise<void>(() => {})); // never resolves
    const engine: EngineHandle = { stop };
    const exit = vi.fn();

    const shutdown = createShutdownHandler(engine, exit);
    void shutdown('SIGINT');

    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits with code 1 if engine.stop() rejects', async () => {
    const stop = vi.fn().mockRejectedValue(new Error('shutdown failed'));
    const engine: EngineHandle = { stop };
    const exit = vi.fn();

    const shutdown = createShutdownHandler(engine, exit);
    await shutdown('SIGINT');

    expect(exit).toHaveBeenCalledWith(1);
  });
});
