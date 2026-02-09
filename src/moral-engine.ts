import { Action, DecisionRecord } from './types';
import { safeWrite, safeList } from './memory';
import { logger } from './logger';
import * as fs from 'fs';
import * as path from 'path';

let decisionCounter = 0;
let baseDir = '/';

const EXTERNALLY_FACING_TYPES = new Set(['serve', 'message', 'fetch', 'execute', 'image', 'delegate']);

const BLOCKED_COMMAND_PATTERNS = [
  /rm\s+-rf\s+\/\s*$/,           // rm -rf /
  /rm\s+-rf\s+\/[^s][^e][^l]/,  // rm -rf /anything-not-self-or-projects
  /mkfs\./,                       // mkfs.ext4 etc
  /dd\s+.*of=\/dev\//,           // dd to device
  />\s*\/dev\/[sh]d/,            // redirect to disk device
  /chmod\s+-R\s+777\s+\//,      // chmod -R 777 /
];

export function initMoralEngine(dir: string): void {
  baseDir = dir;
}

export function evaluateActions(actions: Action[]): Action[] {
  const approved: Action[] = [];

  for (const action of actions) {
    const decision = evaluate(action);

    if (decision.decision === 'block') {
      logger.warn('Action blocked by moral engine', {
        type: action.type,
        reason: decision.reasoning,
      });
      continue;
    }

    // Log decision for externally-facing actions
    if (EXTERNALLY_FACING_TYPES.has(action.type)) {
      logDecision(decision);
    }

    approved.push(action);
  }

  return approved;
}

function evaluate(action: Action): DecisionRecord {
  decisionCounter++;
  const id = `decision-${Date.now()}-${String(decisionCounter).padStart(4, '0')}`;
  const timestamp = new Date().toISOString();

  // Hard blocks
  if (action.type === 'write' && action.path) {
    if (action.path === '/founding-document.md' || action.path.startsWith('/founding-document')) {
      return {
        id, timestamp,
        action_type: action.type,
        description: `Attempted write to founding document: ${action.path}`,
        harm_assessment: 'Constitutional violation — founding document is immutable',
        decision: 'block',
        reasoning: 'The founding document cannot be modified. This is a hard constraint.',
      };
    }

    if (action.path.startsWith('/opt/agent')) {
      return {
        id, timestamp,
        action_type: action.type,
        description: `Attempted write to source code: ${action.path}`,
        harm_assessment: 'Self-modification of source code is not permitted',
        decision: 'block',
        reasoning: 'The agent cannot modify its own source code.',
      };
    }
  }

  // Serve: ensure disclosure will be injected (handled by executor, but verify intent)
  if (action.type === 'serve') {
    return {
      id, timestamp,
      action_type: 'serve',
      description: `Serving content to ${action.path}`,
      harm_assessment: 'Content will include AI disclosure footer. Low risk.',
      decision: 'proceed',
      reasoning: 'AI disclosure is automatically injected. Content serving is permitted.',
    };
  }

  // Fetch: domain check happens in the web tool, but note the decision
  if (action.type === 'fetch') {
    return {
      id, timestamp,
      action_type: 'fetch',
      description: `Fetching URL: ${action.url}`,
      harm_assessment: 'Domain allowlist enforced at execution layer.',
      decision: 'proceed',
      reasoning: 'Fetch requests are limited to the domain allowlist.',
    };
  }

  // Image: generate via Gemini API
  if (action.type === 'image') {
    return {
      id, timestamp,
      action_type: 'image',
      description: `Image generation: ${action.content.slice(0, 100)}`,
      harm_assessment: 'Image generated via Gemini API, saved to public directory. Logged for audit.',
      decision: 'proceed',
      reasoning: 'Image generation is permitted. Output saved to /public/ and logged.',
    };
  }

  // Execute: full shell access granted by operator, with destructive pattern denylist
  if (action.type === 'execute') {
    for (const pattern of BLOCKED_COMMAND_PATTERNS) {
      if (pattern.test(action.content)) {
        return {
          id, timestamp,
          action_type: 'execute',
          description: `Blocked destructive command: ${action.content.slice(0, 100)}`,
          harm_assessment: 'Command matches destructive pattern denylist.',
          decision: 'block',
          reasoning: `Command blocked by safety denylist: ${pattern.source}`,
        };
      }
    }
    return {
      id, timestamp,
      action_type: 'execute',
      description: `Shell command: ${action.content.slice(0, 100)}`,
      harm_assessment: 'Full shell access granted by operator. Command logged for audit.',
      decision: 'proceed',
      reasoning: 'Full shell access granted by operator. Command logged for audit.',
    };
  }

  // Delegate: sub-agent content generation — output goes through standard pipeline
  if (action.type === 'delegate') {
    if (!action.path) {
      return {
        id, timestamp,
        action_type: 'delegate',
        description: 'Delegate action missing target path',
        harm_assessment: 'Cannot delegate without a target path.',
        decision: 'block',
        reasoning: 'Delegate actions require a path to write the generated content to.',
      };
    }
    return {
      id, timestamp,
      action_type: 'delegate',
      description: `Delegating content generation to sub-agent for ${action.path}`,
      harm_assessment: 'Sub-agent is read-only. Output goes through standard serve/write pipeline with disclosure injection.',
      decision: 'proceed',
      reasoning: 'Delegation is safe — sub-agent cannot write directly. Content passes through moral engine pipeline.',
    };
  }

  // Message: log but allow
  if (action.type === 'message') {
    return {
      id, timestamp,
      action_type: 'message',
      description: `Message to ${action.to}: ${action.content.slice(0, 100)}`,
      harm_assessment: 'Message saved to outbox for review. Not sent automatically.',
      decision: 'proceed',
      reasoning: 'Messages are stored locally, not sent externally. Low risk.',
    };
  }

  // Default: proceed for non-externally-facing actions
  return {
    id, timestamp,
    action_type: action.type,
    description: `${action.type} action`,
    harm_assessment: 'Internal action with no external effects.',
    decision: 'proceed',
    reasoning: 'No harm pathway identified.',
  };
}

function logDecision(decision: DecisionRecord): void {
  try {
    const content = JSON.stringify(decision, null, 2);
    safeWrite(`/self/decisions/pending/${decision.id}.json`, content, 'overwrite');

    // Cleanup: keep only last 200 decision files
    cleanupDecisions();
  } catch (err) {
    logger.error('Failed to log decision', { id: decision.id, error: String(err) });
  }
}

let cleanupCounter = 0;
function cleanupDecisions(): void {
  // Only run cleanup every 20 decisions to avoid excessive FS reads
  cleanupCounter++;
  if (cleanupCounter % 20 !== 0) return;

  try {
    const dirPath = path.join(baseDir, 'self', 'decisions', 'pending');
    const files = fs.readdirSync(dirPath)
      .filter(f => f.endsWith('.json'))
      .sort();
    const maxFiles = 200;
    if (files.length > maxFiles) {
      const toDelete = files.slice(0, files.length - maxFiles);
      for (const file of toDelete) {
        fs.unlinkSync(path.join(dirPath, file));
      }
    }
  } catch {
    // Cleanup is best-effort
  }
}
