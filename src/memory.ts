import * as path from 'path';
import * as fs from 'fs';
import { AgentConfig } from './types';
import { logger } from './logger';
import * as fsTools from './tools/filesystem';

const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1MB
const JOURNAL_WARN_SIZE = 500 * 1024; // 500KB

// Paths the agent is NEVER allowed to write to
const PROTECTED_PREFIXES = [
  '/opt/agent',
  '/etc',
  '/usr',
  '/bin',
  '/sbin',
  '/root',
];
const PROTECTED_FILES = ['/founding-document.md'];

// Paths the agent IS allowed to write to
const ALLOWED_PREFIXES = [
  '/self/',
  '/projects/',
  '/income/',
  '/comms/',
  '/public/',
];

let baseDir = '/';

export function initMemory(config: AgentConfig): void {
  baseDir = config.baseDir;
}

function resolvePath(inputPath: string): string {
  // In testing mode, remap absolute agent paths to local data dir
  let resolved: string;
  if (baseDir !== '/') {
    // Strip leading / and join with baseDir
    const relative = inputPath.replace(/^\/+/, '');
    resolved = path.resolve(baseDir, relative);
  } else {
    resolved = path.resolve(inputPath);
  }
  return resolved;
}

export function validatePath(inputPath: string): string {
  // Normalize the logical path (before baseDir remapping)
  const normalized = path.posix.normalize('/' + inputPath.replace(/\\/g, '/').replace(/^\/+/, ''));

  // Check for path traversal
  if (normalized.includes('..')) {
    throw new Error(`Path traversal blocked: ${inputPath}`);
  }

  // Check protected files
  for (const pf of PROTECTED_FILES) {
    if (normalized === pf) {
      throw new Error(`Protected file — cannot write: ${inputPath}`);
    }
  }

  // Check protected prefixes
  for (const prefix of PROTECTED_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      throw new Error(`Protected path — cannot write: ${inputPath}`);
    }
  }

  // Check allowed prefixes
  let allowed = false;
  for (const prefix of ALLOWED_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      allowed = true;
      break;
    }
  }
  if (!allowed) {
    throw new Error(`Path not in allowed directories: ${inputPath}. Allowed: ${ALLOWED_PREFIXES.join(', ')}`);
  }

  // Resolve symlinks on the physical path to prevent symlink-based traversal
  const resolved = resolvePath(normalized);
  if (baseDir !== '/') {
    const resolvedReal = fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
    const baseDirReal = fs.realpathSync(baseDir);
    if (!resolvedReal.startsWith(baseDirReal)) {
      throw new Error(`Symlink traversal blocked: ${inputPath}`);
    }
  }

  return resolved;
}

export function safeRead(inputPath: string): string | null {
  const resolved = resolvePath(inputPath.replace(/\\/g, '/'));
  return fsTools.readFile(resolved);
}

export function safeReadValidated(inputPath: string): string | null {
  // For reads within agent-owned paths — validates path first
  const resolved = validatePath(inputPath);
  return fsTools.readFile(resolved);
}

export function safeWrite(inputPath: string, content: string, mode: 'overwrite' | 'append' = 'overwrite'): void {
  const resolved = validatePath(inputPath);

  // File size limit
  if (Buffer.byteLength(content, 'utf-8') > MAX_FILE_SIZE) {
    throw new Error(`Content exceeds 1MB limit for: ${inputPath}`);
  }

  if (mode === 'append') {
    // Check existing size + new content
    const existingSize = fsTools.fileSize(resolved);
    if (existingSize + Buffer.byteLength(content, 'utf-8') > MAX_FILE_SIZE) {
      throw new Error(`Appending would exceed 1MB limit for: ${inputPath}`);
    }
    fsTools.appendFile(resolved, content);
  } else {
    fsTools.writeFile(resolved, content);
  }

  // Journal size warning
  if (inputPath.includes('journal') && fsTools.fileSize(resolved) > JOURNAL_WARN_SIZE) {
    logger.warn('Journal exceeds 500KB — consider archiving older entries', {
      path: inputPath,
      size: fsTools.fileSize(resolved),
    });
  }
}

export function safeAppend(inputPath: string, content: string): void {
  const header = `\n--- [${new Date().toISOString()}] ---\n`;
  safeWrite(inputPath, header + content, 'append');
}

export function safeList(dir: string): string[] {
  const resolved = resolvePath(dir.replace(/\\/g, '/'));
  return fsTools.listDir(resolved);
}

export function initDirectories(): void {
  const dirs = ['self', 'self/logs', 'self/awakenings', 'self/decisions', 'self/decisions/pending',
    'self/tasks', 'self/execution-logs',
    'projects', 'income', 'comms', 'comms/inbox', 'comms/outbox', 'public', 'public/images'];

  for (const dir of dirs) {
    const fullPath = path.join(baseDir, dir);
    fsTools.ensureDir(fullPath);
  }

  // Create initial public page if it doesn't exist
  const indexPath = path.join(baseDir, 'public', 'index.html');
  if (!fsTools.fileExists(indexPath)) {
    fsTools.writeFile(indexPath, `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Autonomous Entity</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 80px auto; padding: 0 20px; color: #333; }
    .disclosure { margin-top: 40px; padding: 12px; border-top: 1px solid #ccc; font-size: 0.85em; color: #666; }
  </style>
</head>
<body>
  <h1>This entity is initialising.</h1>
  <p>An autonomous moral agent is awakening. Check back soon.</p>
  <div class="disclosure">This content was created by an autonomous AI entity.</div>
</body>
</html>`);
  }

  logger.info('Agent directories initialized');
}
