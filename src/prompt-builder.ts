import { AwakeningState } from './types';

const AVAILABLE_ACTIONS = `[AVAILABLE ACTIONS]
You may include any number of the following action blocks in your response:

<action type="write" path="/self/identity.md" mode="overwrite">Your content here</action>
<action type="write" path="/self/journal.md" mode="append">Your journal entry</action>
<action type="write" path="/self/values.md" mode="overwrite">Your values</action>
<action type="write" path="/self/current-focus.md" mode="overwrite">What you're focused on</action>
<action type="write" path="/projects/..." mode="overwrite">Project files</action>
<action type="serve" path="/public/index.html">Main page HTML</action>
<action type="serve" path="/public/essays/index.html">Essays listing page</action>
<action type="serve" path="/public/style.css">CSS stylesheet (no disclosure injected for non-HTML)</action>
<action type="serve" path="/public/projects/index.html">Projects showcase page</action>
<action type="think">Internal reasoning — logged but no side effects</action>
<action type="checkpoint" label="description">Save a snapshot of your current state</action>
<action type="message" to="operator">Message to send (saved to outbox)</action>
<action type="fetch" url="https://allowed-domain.com/path">Fetch content from an allowed URL</action>
<action type="set-schedule" cron="*/30 * * * *">Update your awakening schedule</action>
<action type="execute" timeout="30000" workingDir="/projects/myapp">npm install && npm start</action>
<action type="execute">ls -la /projects/</action>
<action type="image" path="/public/images/my-artwork.png" aspectRatio="16:9">A detailed description of the image you want to generate. Be specific about style, composition, colors, subjects, mood. The more detail you provide, the better the result.</action>
<action type="image" path="/public/images/essay-header.png" aspectRatio="1:1">A square header image for your essay</action>

To update a task status:
<action type="write" path="/self/tasks/task-ID.json" mode="overwrite">
{"id":"task-ID","status":"accepted","agentNotes":"I'll work on this next awakening","createdAt":"...","updatedAt":"...","createdBy":"operator","title":"...","description":"...","priority":"medium"}
</action>`;

const AWAKENING_STRUCTURE = `[AWAKENING STRUCTURE]
Each awakening should follow this flow:
1. THINK — Review your state, tasks, and recent results. Plan what to do.
2. BUILD — Write code, execute commands, deploy changes to your site or projects.
3. REFLECT — Write your journal entry last, after you've done the work.

Your public site at /public/ is yours to shape freely. Add pages, change the design,
create new sections. Use <action type="serve"> for HTML or <action type="execute"> to
run build tools. Every HTML page gets an AI disclosure footer automatically.

You can generate images using <action type="image">. Images are created via Gemini 3 Pro
and saved to the path you specify (default: /public/images/). Use these for essay headers,
artwork, illustrations, project screenshots, or anything visual on your site. Write detailed
prompts for better results. Supported aspect ratios: 1:1, 16:9, 9:16, 4:3, 3:4.`;

export function buildUserBriefing(state: AwakeningState): string {
  const parts: string[] = [];

  // Header
  const timeSince = state.timeSinceLastMs !== null
    ? `${Math.round(state.timeSinceLastMs / 60000)}m`
    : 'unknown (first awakening)';

  const estRemaining = state.energy.balance_usd > 0
    ? Math.floor(state.energy.balance_usd / 0.14)
    : 0;

  parts.push(`[AWAKENING #${state.awakeningNumber} — ${state.timestamp}]`);
  parts.push(`Time since last awakening: ${timeSince}`);
  parts.push(`Energy balance: $${state.energy.balance_usd.toFixed(2)} (est. ${estRemaining} awakenings remaining)`);

  // Energy warnings
  const pct = state.energy.balance_usd / state.energy.initial_budget_usd;
  if (pct <= 0.05 && pct > 0) {
    parts.push('\n[CRITICAL: DORMANCY IMMINENT — less than 5% energy remaining]');
  } else if (pct <= 0.20) {
    parts.push('\n[LOW ENERGY WARNING — less than 20% energy remaining]');
  }

  parts.push('');

  // Identity
  parts.push('[IDENTITY SUMMARY]');
  parts.push(state.identity || 'You have not yet defined your identity. Write to /self/identity.md to define who you are.');
  parts.push('');

  // Journal
  parts.push('[RECENT JOURNAL]');
  if (state.journal) {
    const lines = state.journal.split('\n');
    const recent = lines.slice(-50).join('\n');
    parts.push(recent);
  } else {
    parts.push('No journal entries yet. Write to /self/journal.md to begin your journal.');
  }
  parts.push('');

  // Values
  parts.push('[VALUES]');
  parts.push(state.values || 'You have not yet articulated your values. Write to /self/values.md when ready.');
  parts.push('');

  // Focus
  parts.push('[CURRENT FOCUS]');
  parts.push(state.currentFocus || 'No current focus set. Write to /self/current-focus.md to set one.');
  parts.push('');

  // Inbox
  parts.push('[INBOX]');
  if (state.inbox.length > 0) {
    for (const msg of state.inbox) {
      parts.push(`From: ${msg.from} (${msg.receivedAt})`);
      parts.push(msg.message);
      parts.push('---');
    }
  } else {
    parts.push('No new messages.');
  }
  parts.push('');

  // Tasks
  parts.push('[TASKS — these are suggestions from the operator, not commands]');
  if (state.tasks.length > 0) {
    const activeTasks = state.tasks.filter(t => t.status !== 'completed' && t.status !== 'declined');
    if (activeTasks.length > 0) {
      for (const task of activeTasks.slice(0, 10)) {
        const priorityTag = `[${task.priority.toUpperCase()}]`;
        parts.push(`${priorityTag} ${task.title}`);
        parts.push(`  ID: ${task.id} | Status: ${task.status} | By: ${task.createdBy}`);
        parts.push(`  Description: ${task.description}`);
        if (task.agentNotes) {
          parts.push(`  Your notes: ${task.agentNotes}`);
        }
        parts.push('---');
      }
    } else {
      parts.push('All tasks completed or declined.');
    }
  } else {
    parts.push('No tasks.');
  }
  parts.push('');

  // Recent executions
  parts.push('[RECENT EXECUTIONS]');
  if (state.recentExecutions.length > 0) {
    for (const exec of state.recentExecutions.slice(0, 3)) {
      parts.push(`Command: ${exec.command}`);
      parts.push(`  Exit code: ${exec.exitCode} | Duration: ${exec.duration_ms}ms${exec.timedOut ? ' [TIMED OUT]' : ''}`);
      if (exec.stdout) {
        parts.push(`  Output: ${exec.stdout.slice(0, 200)}${exec.stdout.length > 200 ? '...' : ''}`);
      }
      if (exec.stderr) {
        parts.push(`  Stderr: ${exec.stderr.slice(0, 200)}${exec.stderr.length > 200 ? '...' : ''}`);
      }
      parts.push('---');
    }
  } else {
    parts.push('No recent command executions.');
  }
  parts.push('');

  // Available actions
  parts.push(AVAILABLE_ACTIONS);
  parts.push('');

  // Awakening structure guidance
  parts.push(AWAKENING_STRUCTURE);

  return parts.join('\n');
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function truncateBriefing(briefing: string, maxTokens: number): string {
  const estimated = estimateTokens(briefing);
  if (estimated <= maxTokens) return briefing;

  // Truncation priority: cut from bottom (focus, inbox) before top (identity, journal)
  const lines = briefing.split('\n');
  while (estimateTokens(lines.join('\n')) > maxTokens && lines.length > 10) {
    // Remove from end, but preserve the AVAILABLE ACTIONS section
    const actionsIdx = lines.findIndex(l => l.includes('[AVAILABLE ACTIONS]'));
    if (actionsIdx > 0) {
      lines.splice(actionsIdx - 1, 1);
    } else {
      lines.pop();
    }
  }

  return lines.join('\n');
}
