import * as dotenv from 'dotenv';
import * as path from 'path';
import { AgentConfig } from './types';

export function loadConfig(): AgentConfig {
  dotenv.config();

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY is required. Copy .env.example to .env and fill in your key.');
  }

  const testing = process.env.TESTING === 'true';

  // On Sprites, agent files live under /opt/agent and data under root dirs.
  // In testing mode, use a local ./data/ directory.
  const baseDir = testing ? path.resolve(process.cwd(), 'data') : '/';

  return {
    anthropicApiKey,
    spriteName: process.env.SPRITE_NAME || 'moral-agent-alpha',
    initialBudget: parseFloat(process.env.INITIAL_BUDGET || '50.00'),
    awakeningIntervalMinutes: parseInt(process.env.AWAKENING_INTERVAL_MINUTES || '30', 10),
    maxTokensPerCycle: parseInt(process.env.MAX_TOKENS_PER_CYCLE || '16384', 10),
    port: parseInt(process.env.PORT || '8080', 10),
    testing,
    baseDir,
    swarmMaxBudget: parseFloat(process.env.SWARM_MAX_BUDGET || '0.50'),
    swarmMaxTurns: parseInt(process.env.SWARM_MAX_TURNS || '15', 10),
    swarmMaxConcurrent: parseInt(process.env.SWARM_MAX_CONCURRENT || '3', 10),
  };
}
