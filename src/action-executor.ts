import { Action, ExecutionResult, ExecutionLog, AgentConfig } from './types';
import { logger } from './logger';
import { safeWrite, safeAppend } from './memory';
import { injectDisclosure } from './tools/serve';
import { createCheckpoint } from './tools/checkpoint';
import { safeFetch } from './tools/web';
import * as fsTools from './tools/filesystem';
import * as path from 'path';
import { exec } from 'child_process';

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
    case 'execute':
      return await executeCommand(action);
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

async function executeCommand(action: Action): Promise<ExecutionResult> {
  const command = action.content;
  if (!command) {
    return { action, success: false, error: 'Execute action requires a command' };
  }

  const timeout = action.timeout || 30000;
  const workingDir = action.workingDir
    ? (config.testing ? path.join(config.baseDir, action.workingDir.replace(/^\/+/, '')) : action.workingDir)
    : (config.testing ? path.join(config.baseDir, 'projects') : '/projects');

  const startTime = Date.now();

  return new Promise((resolve) => {
    const child = exec(command, {
      timeout,
      cwd: workingDir,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env },
    }, (error, stdout, stderr) => {
      const duration_ms = Date.now() - startTime;
      const timedOut = error?.killed === true;
      const exitCode = error ? (error.code ?? null) : 0;

      // Truncate output to 50KB each
      const maxOutput = 50 * 1024;
      const truncStdout = stdout.length > maxOutput ? stdout.slice(0, maxOutput) + '\n... [truncated]' : stdout;
      const truncStderr = stderr.length > maxOutput ? stderr.slice(0, maxOutput) + '\n... [truncated]' : stderr;

      const log: ExecutionLog = {
        id: `exec-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        awakening: 0, // Will be set by caller if needed
        timestamp: new Date().toISOString(),
        command,
        workingDir,
        exitCode: typeof exitCode === 'number' ? exitCode : null,
        stdout: truncStdout,
        stderr: truncStderr,
        duration_ms,
        timedOut,
      };

      // Save execution log
      try {
        const logDir = path.join(config.baseDir, 'self', 'execution-logs');
        fsTools.ensureDir(logDir);
        safeWrite(`/self/execution-logs/${log.id}.json`, JSON.stringify(log, null, 2), 'overwrite');
      } catch (err) {
        logger.error('Failed to save execution log', { error: String(err) });
      }

      logger.info('Execute action completed', {
        command: command.slice(0, 100),
        exitCode,
        duration_ms,
        timedOut,
      });

      resolve({
        action,
        success: exitCode === 0,
        error: exitCode !== 0 ? `Exit code ${exitCode}${timedOut ? ' (timed out)' : ''}: ${truncStderr.slice(0, 200)}` : undefined,
      });
    });
  });
}
