import { startEngine } from './engine.js';
import { logger } from './telemetry/logger.js';

async function main(): Promise<void> {
  const engine = await startEngine();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down`);
    await engine.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  logger.error({ error: error instanceof Error ? error.message : error }, 'Fatal error during startup');
  process.exit(1);
});