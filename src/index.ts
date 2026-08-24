import { fileURLToPath } from 'node:url';
import { startEngine, type EngineHandle } from './engine.js';
import { logger } from './telemetry/logger.js';

const SHUTDOWN_TIMEOUT_MS = 15_000;

/**
 * H-13: previously, a second SIGINT/SIGTERM (an operator pressing Ctrl+C
 * twice, or a container runtime sending both signals close together)
 * re-entered the shutdown path concurrently. engine.stop() closes the shared
 * SQLite connection (see C-03), and better-sqlite3 throws on a double close —
 * a concurrent second shutdown could crash the process mid-shutdown instead
 * of exiting cleanly. Also adds a force-exit timeout so a hung engine.stop()
 * (e.g. a WebSocket that never finishes closing) can't prevent the process
 * from ever exiting.
 *
 * Exported (and takes `exit` as a parameter) so the guard/timeout logic is
 * unit-testable without actually starting the engine or calling
 * process.exit from a test.
 */
export function createShutdownHandler(
  engine: EngineHandle,
  exit: (code: number) => void = process.exit
): (signal: string) => Promise<void> {
  let shuttingDown = false;

  return async (signal: string): Promise<void> => {
    if (shuttingDown) {
      logger.warn(`Received ${signal} during shutdown — already stopping, ignoring`);
      return;
    }
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down`);

    const forceExitTimer = setTimeout(() => {
      logger.error(`Graceful shutdown did not complete within ${SHUTDOWN_TIMEOUT_MS}ms — forcing exit`);
      exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExitTimer.unref?.();

    try {
      await engine.stop();
      clearTimeout(forceExitTimer);
      exit(0);
    } catch (error) {
      clearTimeout(forceExitTimer);
      logger.error({ error: error instanceof Error ? error.message : error }, 'Error during shutdown');
      exit(1);
    }
  };
}

async function main(): Promise<void> {
  const engine = await startEngine();
  const shutdown = createShutdownHandler(engine);

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

// Only auto-run when this file is the process entrypoint (`node dist/index.js`
// / `tsx src/index.ts`), not when imported (e.g. by tests importing
// createShutdownHandler) — otherwise importing this module would start the
// real trading engine as a side effect.
const isEntrypoint = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntrypoint) {
  main().catch((error) => {
    logger.error({ error: error instanceof Error ? error.message : error }, 'Fatal error during startup');
    process.exit(1);
  });
}
