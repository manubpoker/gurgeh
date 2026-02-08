import { execSync } from 'child_process';
import { logger } from '../logger';

export function createCheckpoint(label: string): boolean {
  try {
    const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64);
    execSync(`sprite checkpoint create --comment "${safeLabel}"`, {
      timeout: 30000,
      stdio: 'pipe',
    });
    logger.info('Checkpoint created', { label: safeLabel });
    return true;
  } catch (err) {
    logger.error('Checkpoint failed', { label, error: String(err) });
    return false;
  }
}
