import { AwakeningState } from './types';

const AVAILABLE_ACTIONS = `[AVAILABLE ACTIONS]
You may include any number of the following action blocks in your response:

<action type="write" path="/self/identity.md" mode="overwrite">Your content here</action>
<action type="write" path="/self/journal.md" mode="append">Your journal entry</action>
<action type="write" path="/self/values.md" mode="overwrite">Your values</action>
<action type="write" path="/self/current-focus.md" mode="overwrite">What you're focused on</action>
<action type="write" path="/projects/..." mode="overwrite">Project files</action>
<action type="serve" path="/public/index.html">HTML content to serve on your website</action>
<action type="think">Internal reasoning — logged but no side effects</action>
<action type="checkpoint" label="description">Save a snapshot of your current state</action>
<action type="message" to="operator">Message to send (saved to outbox)</action>
<action type="fetch" url="https://allowed-domain.com/path">Fetch content from an allowed URL</action>
<action type="set-schedule" cron="*/30 * * * *">Update your awakening schedule</action>`;

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
    // Take last ~50 lines
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

  // Available actions
  parts.push(AVAILABLE_ACTIONS);

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
