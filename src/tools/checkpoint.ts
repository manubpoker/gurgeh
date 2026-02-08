import { execSync } from 'child_process';
import { logger } from '../logger';

let spriteName = '';

export function initCheckpoint(name: string): void {
  spriteName = name;
}

export function createCheckpoint(label: string): boolean {
  try {
    const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64);
    const spriteFlag = spriteName ? ` -s ${spriteName}` : '';
    execSync(`sprite checkpoint create${spriteFlag} -comment "${safeLabel}"`, {
      timeout: 30000,
      stdio: 'pipe',
    });
    logger.info('Checkpoint created', { label: safeLabel });
    return true;
  } catch (err) {
    logger.error('Checkpoint failed — sprite CLI may not be configured inside the VM', {
      label,
      error: String(err),
    });
    return false;
  }
}
