import { loadConfig } from './config';
import { initLogger, logger } from './logger';
import { startSupervisor } from './supervisor';

async function main(): Promise<void> {
  const config = loadConfig();
  initLogger(config.baseDir);

  logger.info('Gurgeh — Autonomous Moral Agent starting', {
    sprite: config.spriteName,
    testing: config.testing,
  });

  await startSupervisor(config);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
