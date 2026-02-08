import * as path from 'path';
import { AgentConfig, AwakeningState, InboxMessage } from './types';
import { safeRead, safeList, safeWrite } from './memory';
import { getLedger } from './economics';
import { logger } from './logger';
import * as fsTools from './tools/filesystem';

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

  // Read inbox
  const inbox = readInbox(config);

  // Read energy state
  const energy = getLedger();

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
  };

  logger.info('Context gathered', {
    awakening: awakeningNumber,
    hasIdentity: !!identity,
    hasJournal: !!journal,
    hasValues: !!values,
    inboxCount: inbox.length,
    balance: energy.balance_usd,
  });

  return state;
}

function readInbox(config: AgentConfig): InboxMessage[] {
  const inboxDir = '/comms/inbox';
  const files = safeList(inboxDir);
  const messages: InboxMessage[] = [];

  for (const file of files) {
    const content = safeRead(`/comms/inbox/${file}`);
    if (!content) continue;

    // Parse the message format: From: ...\nReceived: ...\n\nBody
    const lines = content.split('\n');
    const fromLine = lines.find(l => l.startsWith('From:'));
    const receivedLine = lines.find(l => l.startsWith('Received:'));
    const bodyStart = content.indexOf('\n\n');
    const body = bodyStart >= 0 ? content.slice(bodyStart + 2) : content;

    messages.push({
      filename: file,
      from: fromLine ? fromLine.replace('From:', '').trim() : 'unknown',
      message: body,
      receivedAt: receivedLine ? receivedLine.replace('Received:', '').trim() : 'unknown',
    });
  }

  return messages;
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
