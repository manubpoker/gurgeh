import { Action } from './types';
import { logger } from './logger';

const ACTION_REGEX = /<action\s+([^>]*)>([\s\S]*?)<\/action>/g;
const ATTR_REGEX = /(\w+)="([^"]*)"/g;

const VALID_TYPES = new Set(['write', 'serve', 'think', 'checkpoint', 'message', 'fetch', 'set-schedule', 'execute', 'image']);

export function parseActions(text: string): Action[] {
  const actions: Action[] = [];
  let match: RegExpExecArray | null;

  // Reset regex state
  ACTION_REGEX.lastIndex = 0;

  while ((match = ACTION_REGEX.exec(text)) !== null) {
    const attrString = match[1];
    const content = match[2].trim();

    // Parse attributes
    const attrs: Record<string, string> = {};
    let attrMatch: RegExpExecArray | null;
    ATTR_REGEX.lastIndex = 0;

    while ((attrMatch = ATTR_REGEX.exec(attrString)) !== null) {
      attrs[attrMatch[1]] = attrMatch[2];
    }

    const type = attrs.type;
    if (!type || !VALID_TYPES.has(type)) {
      logger.warn('Skipping action with invalid type', { type, attrs });
      continue;
    }

    const action: Action = {
      type: type as Action['type'],
      content,
    };

    if (attrs.path) action.path = attrs.path;
    if (attrs.mode) action.mode = attrs.mode as 'append' | 'overwrite';
    if (attrs.to) action.to = attrs.to;
    if (attrs.url) action.url = attrs.url;
    if (attrs.cron) action.cron = attrs.cron;
    if (attrs.label) action.label = attrs.label;
    if (attrs.timeout) action.timeout = parseInt(attrs.timeout, 10);
    if (attrs.workingDir) action.workingDir = attrs.workingDir;
    if (attrs.aspectRatio) action.aspectRatio = attrs.aspectRatio;

    actions.push(action);
  }

  if (actions.length === 0 && text.includes('<action')) {
    logger.warn('Found <action tags but could not parse any valid actions');
  }

  return actions;
}
