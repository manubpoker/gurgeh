import * as fs from 'fs';
import * as path from 'path';
import { LogLevel } from './types';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

let logFilePath: string | null = null;
let minLevel: LogLevel = 'INFO';

export function initLogger(baseDir: string, level: LogLevel = 'INFO'): void {
  minLevel = level;
  logFilePath = path.join(baseDir, 'self', 'logs', 'agent.log');
  const dir = path.dirname(logFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minLevel]) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data,
  };

  const line = JSON.stringify(entry);
  console.log(line);

  if (logFilePath) {
    try {
      fs.appendFileSync(logFilePath, line + '\n');
    } catch {
      // If we can't write logs, we still continue
    }
  }
}

export const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => log('DEBUG', msg, data),
  info: (msg: string, data?: Record<string, unknown>) => log('INFO', msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => log('WARN', msg, data),
  error: (msg: string, data?: Record<string, unknown>) => log('ERROR', msg, data),
};
