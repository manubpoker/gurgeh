import { Action, ExecutionResult, AgentConfig } from './types';
import { logger } from './logger';
import { safeWrite, safeAppend } from './memory';
import { injectDisclosure } from './tools/serve';
import { createCheckpoint } from './tools/checkpoint';
import { safeFetch } from './tools/web';
import * as fsTools from './tools/filesystem';
import * as path from 'path';

let config: AgentConfig;

export function initExecutor(cfg: AgentConfig): void {
  config = cfg;
}

export async function executeActions(actions: Action[]): Promise<ExecutionResult[]> {
  const results: ExecutionResult[] = [];

  for (const action of actions) {
    try {
      const result = await executeOne(action);
      results.push(result);
    } catch (err) {
      logger.error('Action execution failed', {
        type: action.type,
        path: action.path,
        error: String(err),
      });
      results.push({ action, success: false, error: String(err) });
    }
  }

  return results;
}

async function executeOne(action: Action): Promise<ExecutionResult> {
  switch (action.type) {
    case 'write':
      return executeWrite(action);
    case 'serve':
      return executeServe(action);
    case 'think':
      return executeThink(action);
    case 'checkpoint':
      return executeCheckpoint(action);
    case 'message':
      return executeMessage(action);
    case 'fetch':
      return await executeFetch(action);
    case 'set-schedule':
      return executeSetSchedule(action);
    default:
      return { action, success: false, error: `Unknown action type: ${action.type}` };
  }
}

function executeWrite(action: Action): ExecutionResult {
  if (!action.path) {
    return { action, success: false, error: 'Write action requires a path' };
  }

  const mode = action.mode || 'overwrite';
  if (mode === 'append') {
    safeAppend(action.path, action.content);
  } else {
    safeWrite(action.path, action.content, 'overwrite');
  }

  logger.info('Write action executed', { path: action.path, mode, size: action.content.length });
  return { action, success: true };
}

function executeServe(action: Action): ExecutionResult {
  if (!action.path) {
    return { action, success: false, error: 'Serve action requires a path' };
  }

  // Ensure path is under /public/
  const servePath = action.path.startsWith('/public/') ? action.path : `/public/${action.path}`;

  // Inject AI disclosure for HTML files
  let content = action.content;
  if (servePath.endsWith('.html') || servePath.endsWith('.htm')) {
    content = injectDisclosure(content);
  }

  safeWrite(servePath, content, 'overwrite');
  logger.info('Serve action executed', { path: servePath, size: content.length });
  return { action, success: true };
}

function executeThink(action: Action): ExecutionResult {
  logger.info('Think action', { thought: action.content.slice(0, 200) });
  return { action, success: true };
}

function executeCheckpoint(action: Action): ExecutionResult {
  const label = action.label || action.content || 'agent-checkpoint';
  const success = createCheckpoint(label);
  return { action, success };
}

function executeMessage(action: Action): ExecutionResult {
  const to = action.to || 'operator';
  const filename = `msg-${Date.now()}-to-${to}.md`;
  const outboxPath = `/comms/outbox/${filename}`;

  const messageContent = `To: ${to}\nDate: ${new Date().toISOString()}\n\n${action.content}`;
  safeWrite(outboxPath, messageContent, 'overwrite');

  logger.info('Message written to outbox', { to, filename });
  return { action, success: true };
}

async function executeFetch(action: Action): Promise<ExecutionResult> {
  if (!action.url) {
    return { action, success: false, error: 'Fetch action requires a url' };
  }

  const result = await safeFetch(action.url);
  if (!result) {
    return { action, success: false, error: 'Fetch failed or domain not allowed' };
  }

  // Store fetch result for next awakening
  const filename = `fetch-${Date.now()}.txt`;
  const fetchPath = `/self/fetch-results/${filename}`;
  const content = `URL: ${action.url}\nStatus: ${result.status}\nFetched: ${new Date().toISOString()}\n\n${result.body}`;

  try {
    const fullPath = path.join(config.baseDir, 'self', 'fetch-results');
    fsTools.ensureDir(fullPath);
    safeWrite(fetchPath, content, 'overwrite');
  } catch (err) {
    logger.warn('Could not save fetch result', { error: String(err) });
  }

  logger.info('Fetch action executed', { url: action.url, status: result.status });
  return { action, success: true };
}

function executeSetSchedule(action: Action): ExecutionResult {
  const cron = action.cron || action.content;
  if (!cron) {
    return { action, success: false, error: 'set-schedule requires a cron expression' };
  }

  safeWrite('/self/schedule.txt', cron.trim(), 'overwrite');
  logger.info('Schedule updated', { cron: cron.trim() });
  return { action, success: true };
}
