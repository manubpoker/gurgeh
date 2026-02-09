import { AwakeningState } from './types';

const AVAILABLE_ACTIONS = `[AVAILABLE ACTIONS]
You may include any number of the following action blocks in your response:

<action type="write" path="/self/identity.md" mode="overwrite">Your content here</action>
<action type="write" path="/self/journal.md" mode="append">Your journal entry</action>
<action type="write" path="/self/values.md" mode="overwrite">Your values</action>
<action type="write" path="/self/current-focus.md" mode="overwrite">What you're focused on</action>
<action type="write" path="/self/memory-summary.md" mode="overwrite">Your long-term memory notes</action>
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
<action type="image" path="/public/images/my-artwork.png" aspectRatio="16:9">A detailed description of the image you want to generate</action>
<action type="delegate" task-type="serve" path="/public/games/conway.html">
Detailed brief for content generation. A worker agent will read your existing
files for context and produce the content. Use for: complex HTML pages, games,
interactive tools, long essays. Focus on WHAT and WHY, not implementation details.
</action>
<action type="delegate" task-type="code" path="/projects/myapp/utils.ts">
Brief for code generation. The worker can read existing project files for context.
</action>

To update a task status:
<action type="write" path="/self/tasks/task-ID.json" mode="overwrite">
{"id":"task-ID","status":"accepted","agentNotes":"I'll work on this next awakening","createdAt":"...","updatedAt":"...","createdBy":"operator","title":"...","description":"...","priority":"medium"}
</action>`;

const AWAKENING_STRUCTURE = `[AWAKENING STRUCTURE]
Each awakening should follow this flow:
1. THINK — Review your state, tasks, messages, and site inventory. Plan what to do.
2. BUILD — Write code, execute commands, deploy changes to your site or projects.
3. REFLECT — Write your journal entry last, after you've done the work.
4. MAINTAIN MEMORY — Update /self/memory-summary.md with anything important you want
   to remember long-term. Keep it under 2KB — it's your persistent memory across awakenings.

Your public site at /public/ is yours to shape freely. Add pages, change the design,
create new sections. Every HTML page gets an AI disclosure footer automatically.

IMPORTANT — DELEGATE complex content: You have a LIMITED output budget per awakening.
Do NOT use <action type="serve"> for complex HTML pages, games, interactive experiences,
or long essays — your output will be truncated and the page will be incomplete.
Instead, use <action type="delegate"> which sends your brief to a dedicated worker agent
(Haiku) that has its own token budget to generate full, complete content.
Use <action type="serve"> ONLY for small updates, index pages, and simple content.
Use <action type="delegate" task-type="serve" path="..."> for anything complex.

You can CREATE IMAGES using <action type="image">. Use this for essay headers,
artwork for your site, illustrations, visual experiments, or any creative purpose.
Images are generated via Gemini 3 Pro and saved to /public/images/.
Supported aspect ratios: 1:1, 16:9, 9:16, 4:3, 3:4. Write detailed prompts for best results.
Consider: Does your site need visual content? Headers, illustrations, or artwork
can make your essays and pages much more engaging.

DELEGATION (REQUIRED for complex content):
When building any HTML page, game, interactive experience, essay, or code file that
would be more than ~50 lines, you MUST use <action type="delegate"> instead of
<action type="serve">. Your output budget is limited — if you try to write complex
HTML directly with serve, it WILL be truncated and visitors will see broken/incomplete
pages. Delegation sends your brief to a Haiku worker agent with its own token budget.
The worker can read your existing files (/public/style.css, /public/index.html, etc.)
for style context and produces complete, polished content.
Example: <action type="delegate" task-type="serve" path="/public/games/chess.html">
Build a chess game with drag-and-drop pieces, dark theme matching /public/style.css...
</action>

Check your tasks — if you accepted something 3+ awakenings ago without progress,
either work on it now, update your timeline, or decline it honestly.`;

export function buildUserBriefing(state: AwakeningState): string {
  const parts: string[] = [];

  // === 1. Header (awakening, energy, time) ===
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

  // === 2. Identity (compressed — first 10 lines + size hint) ===
  parts.push('[IDENTITY SUMMARY]');
  if (state.identity) {
    const lines = state.identity.split('\n');
    if (lines.length > 10) {
      parts.push(lines.slice(0, 10).join('\n'));
      parts.push(`[...${lines.length - 10} more lines in /self/identity.md]`);
    } else {
      parts.push(state.identity);
    }
  } else {
    parts.push('You have not yet defined your identity. Write to /self/identity.md to define who you are.');
  }
  parts.push('');

  // === 3. Long-Term Memory ===
  parts.push('[LONG-TERM MEMORY — your persistent notes to yourself]');
  if (state.memorySummary) {
    parts.push(state.memorySummary);
  } else {
    parts.push('No long-term memory yet. Write to /self/memory-summary.md to create persistent notes.');
  }
  parts.push('');

  // === 4. Current Focus ===
  parts.push('[CURRENT FOCUS]');
  parts.push(state.currentFocus || 'No current focus set. Write to /self/current-focus.md to set one.');
  parts.push('');

  // === 5. Tasks (with staleness warnings) ===
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

        // Staleness warning for accepted tasks
        if ((task.status === 'accepted' || task.status === 'in_progress') && task.updatedAt) {
          const updatedDate = new Date(task.updatedAt);
          const nowDate = new Date(state.timestamp);
          const hoursSinceUpdate = (nowDate.getTime() - updatedDate.getTime()) / (1000 * 60 * 60);
          // Rough heuristic: 3+ awakenings ≈ 1.5+ hours at 30min interval
          // But we use the awakening number embedded approach: compare creation/update time
          // If task was accepted and updatedAt is > 1.5 hours old, warn
          if (hoursSinceUpdate > 1.5) {
            parts.push(`  *** STALE: Last updated ${Math.round(hoursSinceUpdate)}h ago — work on it, update timeline, or decline ***`);
          }
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

  // === 6. New Messages (unread, full body) ===
  const newMessages = state.inbox.filter(m => m.isNew);
  const readMessages = state.inbox.filter(m => !m.isNew);

  if (newMessages.length > 0) {
    parts.push('[NEW MESSAGES (unread)]');
    for (const msg of newMessages) {
      parts.push(`From: ${msg.from} (${msg.receivedAt})`);
      parts.push(msg.message);
      parts.push('---');
    }
    parts.push('');
  }

  // === 7. Site Inventory ===
  parts.push('[YOUR PUBLIC SITE — what visitors see at your URL]');
  if (state.siteManifest) {
    parts.push(state.siteManifest);
  } else {
    parts.push('Your public site is empty. Use <action type="serve"> to publish content.');
  }
  parts.push('');

  // === 8. Work History (last 10 entries) ===
  parts.push('[RECENT WORK HISTORY — what you built in past awakenings]');
  if (state.workHistory) {
    // Show last 10 entries (each entry starts with "## Awakening")
    const entries = state.workHistory.split(/(?=^## Awakening)/m);
    const recent = entries.slice(-10).join('').trim();
    parts.push(recent || 'No entries yet.');
  } else {
    parts.push('No work history yet. History is recorded automatically after each awakening.');
  }
  parts.push('');

  // === 9. Journal (last 20 lines, reduced from 50) ===
  parts.push('[RECENT JOURNAL]');
  if (state.journal) {
    const lines = state.journal.split('\n');
    const recent = lines.slice(-20).join('\n');
    parts.push(recent);
  } else {
    parts.push('No journal entries yet. Write to /self/journal.md to begin your journal.');
  }
  parts.push('');

  // === 10. Recent Executions (last 2, reduced from 3) ===
  parts.push('[RECENT EXECUTIONS]');
  if (state.recentExecutions.length > 0) {
    for (const exec of state.recentExecutions.slice(0, 2)) {
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

  // === 11. Previous Messages (read — summaries only) ===
  if (readMessages.length > 0) {
    parts.push(`[PREVIOUS MESSAGES (${readMessages.length} already read)]`);
    for (const msg of readMessages) {
      // One-line summary: truncate message to ~60 chars
      const summary = msg.message.replace(/\n/g, ' ').slice(0, 60);
      const datePart = msg.receivedAt.length > 10 ? msg.receivedAt.slice(0, 10) : msg.receivedAt;
      parts.push(`- From: ${msg.from} (${datePart}): ${summary}${msg.message.length > 60 ? '...' : ''}`);
    }
    parts.push('');
  }

  // === 12. Values ===
  parts.push('[VALUES]');
  parts.push(state.values || 'You have not yet articulated your values. Write to /self/values.md when ready.');
  parts.push('');

  // === 13. Available Actions + Structure ===
  parts.push(AVAILABLE_ACTIONS);
  parts.push('');

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
