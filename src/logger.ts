import * as fs from 'fs';
import * as path from 'path';
import { LogLevel } from './types';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB

let logFilePath: string | null = null;
let minLevel: LogLevel = 'INFO';
let writesSinceRotationCheck = 0;

export function initLogger(baseDir: string, level: LogLevel = 'INFO'): void {
  minLevel = level;
  logFilePath = path.join(baseDir, 'self', 'logs', 'agent.log');
  const dir = path.dirname(logFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function rotateIfNeeded(): void {
  if (!logFilePath) return;
  try {
    const stats = fs.statSync(logFilePath);
    if (stats.size > MAX_LOG_SIZE) {
      const rotatedPath = logFilePath + '.1';
      // Remove old rotated log if it exists
      if (fs.existsSync(rotatedPath)) {
        fs.unlinkSync(rotatedPath);
      }
      fs.renameSync(logFilePath, rotatedPath);
    }
  } catch {
    // File may not exist yet
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
      // Check rotation every 100 writes
      writesSinceRotationCheck++;
      if (writesSinceRotationCheck >= 100) {
        writesSinceRotationCheck = 0;
        rotateIfNeeded();
      }
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
