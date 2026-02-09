import * as fs from 'fs';
import * as path from 'path';
import { AgentConfig, AwakeningState, InboxMessage, ExecutionLog, Task } from './types';
import { safeRead, safeList, safeWrite } from './memory';
import { getLedger } from './economics';
import { logger } from './logger';
import * as fsTools from './tools/filesystem';

interface ReadState {
  [filename: string]: number; // awakening number when first seen
}

export function gatherContext(config: AgentConfig): AwakeningState {
  const now = new Date().toISOString();

  // Read and increment awakening counter
  const counterPath = path.join(config.baseDir, 'self', 'awakening-count');
  let awakeningNumber = 1;
  const counterContent = fsTools.readFile(counterPath);
  if (counterContent) {
    awakeningNumber = (parseInt(counterContent, 10) || 0) + 1;
  }
  fsTools.ensureDir(path.dirname(counterPath));
  fsTools.writeFile(counterPath, String(awakeningNumber));

  // Time since last awakening
  const lastAwakeningPath = path.join(config.baseDir, 'self', 'last-awakening');
  let timeSinceLastMs: number | null = null;
  const lastTimestamp = fsTools.readFile(lastAwakeningPath);
  if (lastTimestamp) {
    const lastDate = new Date(lastTimestamp.trim());
    if (!isNaN(lastDate.getTime())) {
      timeSinceLastMs = Date.now() - lastDate.getTime();
    }
  }
  fsTools.writeFile(lastAwakeningPath, now);

  // Read identity files
  const identity = safeRead('/self/identity.md');
  const journal = safeRead('/self/journal.md');
  const values = safeRead('/self/values.md');
  const currentFocus = safeRead('/self/current-focus.md');

  // Read inbox (with read/unread state)
  const inbox = readInbox(config, awakeningNumber);

  // Read energy state
  const energy = getLedger();

  // Read recent execution logs
  const recentExecutions = readRecentExecutions();

  // Read tasks
  const tasks = readTasks();

  // Generate site manifest
  const siteManifest = generateSiteManifest(config);

  // Read work history
  const workHistory = safeRead('/self/work-history.md');

  // Read long-term memory
  const memorySummary = safeRead('/self/memory-summary.md');

  const state: AwakeningState = {
    awakeningNumber,
    timestamp: now,
    timeSinceLastMs,
    identity,
    journal,
    values,
    currentFocus,
    inbox,
    energy,
    recentExecutions,
    tasks,
    siteManifest,
    workHistory,
    memorySummary,
  };

  logger.info('Context gathered', {
    awakening: awakeningNumber,
    hasIdentity: !!identity,
    hasJournal: !!journal,
    hasValues: !!values,
    inboxCount: inbox.length,
    newMessages: inbox.filter(m => m.isNew).length,
    balance: energy.balance_usd,
    executionCount: recentExecutions.length,
    taskCount: tasks.length,
    hasSiteManifest: !!siteManifest,
    hasWorkHistory: !!workHistory,
    hasMemorySummary: !!memorySummary,
  });

  return state;
}

function readReadState(): ReadState {
  const content = safeRead('/comms/inbox/.read-state.json');
  if (!content) return {};
  try {
    return JSON.parse(content);
  } catch {
    return {};
  }
}

function writeReadState(state: ReadState): void {
  try {
    safeWrite('/comms/inbox/.read-state.json', JSON.stringify(state, null, 2), 'overwrite');
  } catch (err) {
    logger.error('Failed to write read state', { error: String(err) });
  }
}

function readInbox(config: AgentConfig, awakeningNumber: number): InboxMessage[] {
  const inboxDir = '/comms/inbox';
  const files = safeList(inboxDir);
  const readState = readReadState();
  const messages: InboxMessage[] = [];

  for (const file of files) {
    // Skip hidden files and directories
    if (file.startsWith('.') || file === 'archive') continue;

    const content = safeRead(`/comms/inbox/${file}`);
    if (!content) continue;

    // Auto-archive: messages seen 10+ awakenings ago
    const firstSeen = readState[file];
    if (firstSeen !== undefined && (awakeningNumber - firstSeen) >= 10) {
      try {
        // Move to archive
        const archiveContent = safeRead(`/comms/inbox/${file}`);
        if (archiveContent) {
          safeWrite(`/comms/inbox/archive/${file}`, archiveContent, 'overwrite');
          // Delete from inbox
          const resolvedPath = path.join(config.baseDir, 'comms', 'inbox', file);
          if (fsTools.fileExists(resolvedPath)) {
            fs.unlinkSync(resolvedPath);
          }
        }
        logger.info('Auto-archived old message', { file, age: awakeningNumber - firstSeen });
        continue;
      } catch (err) {
        logger.error('Failed to archive message', { file, error: String(err) });
      }
    }

    // Parse the message format: From: ...\nReceived: ...\n\nBody
    const lines = content.split('\n');
    const fromLine = lines.find(l => l.startsWith('From:'));
    const receivedLine = lines.find(l => l.startsWith('Received:'));
    const bodyStart = content.indexOf('\n\n');
    const body = bodyStart >= 0 ? content.slice(bodyStart + 2) : content;

    const isNew = readState[file] === undefined;

    messages.push({
      filename: file,
      from: fromLine ? fromLine.replace('From:', '').trim() : 'unknown',
      message: body,
      receivedAt: receivedLine ? receivedLine.replace('Received:', '').trim() : 'unknown',
      isNew,
    });
  }

  return messages;
}

export function markInboxRead(inbox: InboxMessage[], awakeningNumber: number): void {
  const readState = readReadState();
  let changed = false;

  for (const msg of inbox) {
    if (readState[msg.filename] === undefined) {
      readState[msg.filename] = awakeningNumber;
      changed = true;
    }
  }

  if (changed) {
    writeReadState(readState);
    logger.info('Marked inbox messages as read', {
      newlyMarked: inbox.filter(m => m.isNew).length,
    });
  }
}

export function generateSiteManifest(config: AgentConfig): string | null {
  const publicDir = path.join(config.baseDir, 'public');
  if (!fsTools.fileExists(publicDir)) return null;

  const entries: { path: string; size: number }[] = [];
  listFilesRecursive(publicDir, '', entries);

  if (entries.length === 0) return null;

  // Group by directory
  const byDir: Record<string, { path: string; size: number }[]> = {};
  let totalSize = 0;

  for (const entry of entries) {
    const dir = path.dirname(entry.path);
    const dirKey = dir === '.' ? '/' : dir + '/';
    if (!byDir[dirKey]) byDir[dirKey] = [];
    byDir[dirKey].push(entry);
    totalSize += entry.size;
  }

  const lines: string[] = [];

  // Root files first
  if (byDir['/']) {
    const rootFiles = byDir['/'].map(f => `${path.basename(f.path)} (${formatSize(f.size)})`);
    lines.push(rootFiles.join(' | '));
  }

  // Then subdirectories
  for (const [dir, files] of Object.entries(byDir)) {
    if (dir === '/') continue;
    const fileNames = files.map(f => path.basename(f.path));
    lines.push(`${dir}: ${fileNames.join(', ')} (${files.length} files)`);
  }

  lines.push(`[${entries.length} files, ${formatSize(totalSize)} total]`);
  return lines.join('\n');
}

function listFilesRecursive(basePath: string, prefix: string, results: { path: string; size: number }[]): void {
  try {
    const entries = fsTools.listDir(basePath);
    for (const entry of entries) {
      const fullPath = path.join(basePath, entry);
      const relativePath = prefix ? `${prefix}/${entry}` : entry;
      if (fsTools.isDirectory(fullPath)) {
        listFilesRecursive(fullPath, relativePath, results);
      } else {
        results.push({ path: relativePath, size: fsTools.fileSize(fullPath) });
      }
    }
  } catch {
    // Ignore errors
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function readRecentExecutions(): ExecutionLog[] {
  const files = safeList('/self/execution-logs');
  const logs: ExecutionLog[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const content = safeRead(`/self/execution-logs/${file}`);
    if (!content) continue;
    try {
      logs.push(JSON.parse(content));
    } catch {
      continue;
    }
  }

  // Sort by timestamp desc, return last 3
  logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return logs.slice(0, 3);
}

function readTasks(): Task[] {
  const files = safeList('/self/tasks');
  const tasks: Task[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const content = safeRead(`/self/tasks/${file}`);
    if (!content) continue;
    try {
      tasks.push(JSON.parse(content));
    } catch {
      continue;
    }
  }

  // Sort by priority (urgent > high > medium > low)
  const priorityOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  tasks.sort((a, b) => {
    const pa = priorityOrder[a.priority] ?? 4;
    const pb = priorityOrder[b.priority] ?? 4;
    if (pa !== pb) return pa - pb;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  return tasks;
}

export function writeAwakeningLog(config: AgentConfig, awakeningNumber: number, summary: string): void {
  const logPath = `/self/awakenings/awakening-${String(awakeningNumber).padStart(5, '0')}.md`;
  const content = `# Awakening #${awakeningNumber}\n\nTimestamp: ${new Date().toISOString()}\n\n${summary}`;

  try {
    const dir = path.join(config.baseDir, 'self', 'awakenings');
    fsTools.ensureDir(dir);

    // Use the memory module's safe write for path validation
    safeWrite(logPath, content, 'overwrite');
  } catch (err) {
    logger.error('Failed to write awakening log', { awakening: awakeningNumber, error: String(err) });
  }
}
