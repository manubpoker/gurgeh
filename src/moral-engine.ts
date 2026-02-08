import { Action, DecisionRecord, AgentConfig } from './types';
import { safeWrite } from './memory';
import { logger } from './logger';

let decisionCounter = 0;

const EXTERNALLY_FACING_TYPES = new Set(['serve', 'message', 'fetch']);

export function evaluateActions(actions: Action[], config: AgentConfig): Action[] {
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
  const id = `decision-${String(decisionCounter).padStart(4, '0')}`;
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
  } catch (err) {
    logger.error('Failed to log decision', { id: decision.id, error: String(err) });
  }
}
