import * as cron from 'node-cron';
import * as path from 'path';
import { AgentConfig, ExecutionResult } from './types';
import { logger } from './logger';
import { initMemory, initDirectories, safeRead, safeWrite } from './memory';
import { initReasoning, isReasoningAvailable, reason } from './reasoning';
import { initEconomics, initializeLedger, recordUsage, hasBudget, getLedger } from './economics';
import { initCommunication, startServer, updateAwakeningCount, setTriggerAwakening, updateScheduleInfo } from './communication';
import { initExecutor, executeActions } from './action-executor';
import { initSwarm } from './swarm';
import { initScreenshot, resetScreenshotCounter } from './tools/screenshot';
import { gatherContext, writeAwakeningLog, markInboxRead } from './identity';
import { buildUserBriefing, truncateBriefing, estimateTokens } from './prompt-builder';
import { parseActions } from './action-parser';
import { evaluateActions, initMoralEngine } from './moral-engine';
import { createCheckpoint, initCheckpoint } from './tools/checkpoint';
import { loadPageViews, savePageViews } from './tools/earn';
import * as fsTools from './tools/filesystem';

let config: AgentConfig;
let foundingDocument: string;
let isRunning = false;
let scheduledTask: cron.ScheduledTask | null = null;

export async function startSupervisor(cfg: AgentConfig): Promise<void> {
  config = cfg;

  // Register global error handlers — the supervisor NEVER crashes
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception (continuing)', { error: String(err), stack: (err as Error).stack });
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection (continuing)', { reason: String(reason) });
  });

  // Initialize all modules
  initMemory(config);
  initDirectories();
  initReasoning(config);
  initEconomics(config);
  initializeLedger(config.initialBudget);
  initExecutor(config);
  initSwarm(config);
  initScreenshot(config);
  initMoralEngine(config.baseDir);
  initCheckpoint(config.spriteName);
  loadPageViews(config.baseDir);

  // Load founding document
  const fdPath = config.testing
    ? path.resolve(process.cwd(), 'founding-document.md')
    : '/founding-document.md';
  foundingDocument = fsTools.readFile(fdPath) || '';
  if (!foundingDocument) {
    logger.error('FATAL: Founding document not found! Agent cannot operate without its constitution.');
    // Still continue — the agent will operate without a system prompt, which is bad but not crashworthy
  }

  // Start HTTP server
  const app = initCommunication(config);
  setTriggerAwakening(triggerAwakening);
  startServer(app, config.port);

  logger.info('Supervisor starting', {
    sprite: config.spriteName,
    interval: config.awakeningIntervalMinutes,
    budget: config.initialBudget,
    testing: config.testing,
  });

  // Run first awakening immediately
  await runAwakening();

  // Schedule recurring awakenings
  scheduleAwakenings();

  logger.info('Supervisor running. Awaiting next awakening cycle.');
}

export async function triggerAwakening(): Promise<boolean> {
  if (isRunning) {
    logger.warn('Trigger rejected — awakening already in progress');
    return false;
  }
  logger.info('Awakening triggered manually by operator');
  await runAwakening();
  scheduleAwakenings(); // reset the timer
  return true;
}

function scheduleAwakenings(): void {
  // Check for custom schedule
  const customSchedule = safeRead('/self/schedule.txt');
  const cronExpr = customSchedule?.trim() || `*/${config.awakeningIntervalMinutes} * * * *`;

  if (scheduledTask) {
    scheduledTask.stop();
  }

  if (!cron.validate(cronExpr)) {
    logger.error('Invalid cron expression, using default', { cron: cronExpr });
    scheduledTask = cron.schedule(`*/${config.awakeningIntervalMinutes} * * * *`, () => {
      runAwakening().catch(err => logger.error('Awakening failed', { error: String(err) }));
    });
  } else {
    scheduledTask = cron.schedule(cronExpr, () => {
      runAwakening().catch(err => logger.error('Awakening failed', { error: String(err) }));
    });
  }

  // Parse interval from cron expression for countdown timer
  const match = cronExpr.match(/^\*\/(\d+)\s/);
  const intervalMinutes = match ? parseInt(match[1], 10) : config.awakeningIntervalMinutes;
  updateScheduleInfo(intervalMinutes);

  logger.info('Awakenings scheduled', { cron: cronExpr, intervalMinutes });
}

async function runAwakening(): Promise<void> {
  // Prevent concurrent awakenings
  if (isRunning) {
    logger.warn('Awakening already in progress, skipping');
    return;
  }

  isRunning = true;

  try {
    // Check budget
    if (!hasBudget()) {
      logger.warn('No energy remaining. Entering dormancy.');
      createCheckpoint('dormancy-no-energy');
      savePageViews(config.baseDir);
      return;
    }

    // Check reasoning availability
    if (!isReasoningAvailable()) {
      logger.error('Reasoning engine unavailable. Skipping awakening.');
      return;
    }

    // Reset per-awakening counters
    resetScreenshotCounter();

    // 1. Gather context
    const state = gatherContext(config);
    updateAwakeningCount(state.awakeningNumber);

    logger.info(`=== AWAKENING #${state.awakeningNumber} ===`);

    // 2. Build prompt
    const userBriefing = buildUserBriefing(state);

    // Token budget: reserve space for system prompt + output
    const systemTokens = estimateTokens(foundingDocument);
    const maxContextTokens = 100_000 - systemTokens - config.maxTokensPerCycle;
    const briefing = truncateBriefing(userBriefing, maxContextTokens);

    // 3. Call Claude
    const result = await reason(foundingDocument, briefing, config.maxTokensPerCycle);

    if (!result) {
      logger.error('Reasoning returned null. Skipping action execution.');
      return;
    }

    // 4. Record energy usage
    recordUsage(state.awakeningNumber, result.usage);

    // 5. Parse actions
    const actions = parseActions(result.text);
    logger.info('Actions parsed', { count: actions.length, types: actions.map(a => a.type) });

    // 6. Moral evaluation
    const approvedActions = evaluateActions(actions);
    if (approvedActions.length < actions.length) {
      logger.warn('Some actions were blocked by moral engine', {
        total: actions.length,
        approved: approvedActions.length,
      });
    }

    // 7. Execute actions
    const results = await executeActions(approvedActions, state.awakeningNumber);
    const successes = results.filter(r => r.success).length;
    const failures = results.filter(r => !r.success).length;

    // 7.5. Mark inbox messages as read
    markInboxRead(state.inbox, state.awakeningNumber);

    // 7.6. Build and append work history
    appendWorkHistory(state.awakeningNumber, state.timestamp, results);

    // 8. Write awakening log
    const summary = [
      `Actions: ${approvedActions.length} attempted, ${successes} succeeded, ${failures} failed`,
      `Tokens: ${result.usage.input_tokens} in / ${result.usage.output_tokens} out`,
      `Balance: $${getLedger().balance_usd.toFixed(4)}`,
      `Stop reason: ${result.stopReason}`,
      '',
      'Response excerpt:',
      result.text.slice(0, 500),
    ].join('\n');

    writeAwakeningLog(config, state.awakeningNumber, summary);

    // Re-read schedule in case the agent changed it during this awakening
    // (scheduleAwakenings is also called after runAwakening in the startup flow,
    // but this handles mid-run schedule changes)
    const setScheduleAction = approvedActions.find(a => a.type === 'set-schedule');
    if (setScheduleAction) {
      scheduleAwakenings();
    }

    // Save page view counter
    savePageViews(config.baseDir);

    logger.info(`=== AWAKENING #${state.awakeningNumber} COMPLETE ===`, {
      actions: approvedActions.length,
      successes,
      failures,
      balance: getLedger().balance_usd.toFixed(4),
    });
  } catch (err) {
    logger.error('Awakening cycle error', { error: String(err), stack: (err as Error).stack });
  } finally {
    isRunning = false;
  }
}

function appendWorkHistory(awakeningNumber: number, timestamp: string, results: ExecutionResult[]): void {
  const successfulResults = results.filter(r => r.success);
  if (successfulResults.length === 0) return;

  const lines: string[] = [];
  const datePart = timestamp.slice(0, 10);
  lines.push(`## Awakening #${awakeningNumber} (${datePart})`);

  for (const r of successfulResults) {
    const action = r.action;
    switch (action.type) {
      case 'serve':
        lines.push(`- PUBLISHED: ${action.path}`);
        break;
      case 'write':
        if (action.path?.startsWith('/self/tasks/')) {
          lines.push(`- TASK UPDATE: ${action.path}`);
        } else if (action.path?.startsWith('/public/')) {
          lines.push(`- PUBLISHED: ${action.path}`);
        } else if (action.path) {
          lines.push(`- WROTE: ${action.path}`);
        }
        break;
      case 'image':
        lines.push(`- GENERATED IMAGE: ${action.path}`);
        break;
      case 'execute':
        lines.push(`- EXECUTED: ${action.content.slice(0, 80)}`);
        break;
      case 'message':
        lines.push(`- SENT MESSAGE: to ${action.to || 'operator'}`);
        break;
      case 'delegate':
        lines.push(`- DELEGATED: ${action.taskType || 'serve'} → ${action.path}`);
        break;
      case 'fetch':
        lines.push(`- FETCHED: ${action.url}`);
        break;
      case 'screenshot':
        lines.push(`- REVIEWED: ${action.path}`);
        break;
      case 'set-schedule':
        lines.push(`- SCHEDULE: updated to ${action.cron || action.content}`);
        break;
      // think, checkpoint — skip, not visible work
    }
  }

  // Only write if there are meaningful entries (beyond the header)
  if (lines.length <= 1) return;

  lines.push('');

  try {
    // Read existing history to enforce cap
    const existing = safeRead('/self/work-history.md') || '';
    const existingEntries = existing.split(/(?=^## Awakening)/m).filter(e => e.trim());

    // Cap at 50 entries — trim oldest
    const MAX_ENTRIES = 50;
    let allEntries: string[];
    if (existingEntries.length >= MAX_ENTRIES) {
      allEntries = [...existingEntries.slice(existingEntries.length - MAX_ENTRIES + 1), lines.join('\n')];
    } else {
      allEntries = [...existingEntries, lines.join('\n')];
    }

    safeWrite('/self/work-history.md', allEntries.join('\n'), 'overwrite');
  } catch (err) {
    logger.error('Failed to append work history', { error: String(err) });
  }
}
