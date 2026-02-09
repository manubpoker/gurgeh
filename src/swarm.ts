import Anthropic from '@anthropic-ai/sdk';
import { Action, AgentConfig, PromptUsage } from './types';
import { safeRead, safeList } from './memory';
import { recordUsage } from './economics';
import { logger } from './logger';

// Prefixes that sub-agents are allowed to read
const SUB_AGENT_READ_PREFIXES = ['/public/', '/self/', '/projects/', '/comms/'];

let client: Anthropic | null = null;
let config: AgentConfig;

export function initSwarm(cfg: AgentConfig): void {
  config = cfg;
  client = new Anthropic({ apiKey: cfg.anthropicApiKey });
}

// Read-only tools exposed to sub-agents
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'read_file',
    description: 'Read a file from the entity filesystem. Use this to read existing pages, styles, essays, or any file for context.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute path, e.g. /public/index.html or /self/identity.md' },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_files',
    description: 'List files in a directory on the entity filesystem.',
    input_schema: {
      type: 'object' as const,
      properties: {
        directory: { type: 'string', description: 'Directory path, e.g. /public/games or /public/essays' },
      },
      required: ['directory'],
    },
  },
];

function isAllowedPath(p: string): boolean {
  const normalized = '/' + p.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.includes('..')) return false;
  return SUB_AGENT_READ_PREFIXES.some(prefix => normalized.startsWith(prefix));
}

function executeTool(name: string, input: Record<string, string>): string {
  switch (name) {
    case 'read_file': {
      if (!isAllowedPath(input.path)) {
        return `Access denied: sub-agents can only read from ${SUB_AGENT_READ_PREFIXES.join(', ')}`;
      }
      const content = safeRead(input.path);
      return content || 'File not found or empty.';
    }
    case 'list_files': {
      if (!isAllowedPath(input.directory)) {
        return `Access denied: sub-agents can only list from ${SUB_AGENT_READ_PREFIXES.join(', ')}`;
      }
      const entries = safeList(input.directory);
      return entries.length > 0 ? entries.join('\n') : 'Directory empty or not found.';
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

function buildSubAgentPrompt(taskType: 'serve' | 'code'): string {
  if (taskType === 'code') {
    return `You are a code generation worker for an autonomous AI entity named Ember.
Produce high-quality code based on the brief provided.
You can read the entity's existing files using the read_file and list_files tools to understand context, style, and conventions.

Rules:
- Produce ONLY the final code content. No preamble, no explanation, no markdown fences.
- Write clean, working code with helpful comments.
- If the brief references existing files, read them first for context.
- Your output will be written to a file by the supervisor — return only the file content.`;
  }

  return `You are a content generation worker for an autonomous AI entity named Ember.
Produce high-quality web content based on the brief provided.
You can read the entity's existing files using the read_file and list_files tools to understand the site's style and structure.

Rules:
- Produce ONLY the final HTML/CSS/JS content. No preamble, no explanation, no markdown fences.
- For HTML: produce complete, self-contained files with inline CSS and JS.
- Match the visual style of the entity's existing site if possible (read /public/index.html or /public/style.css for reference).
- Your output will be served on the entity's public site — make it polished and production-ready.
- An AI disclosure footer will be automatically injected — do NOT add one yourself.
- Your output will be written to a file by the supervisor — return only the file content.`;
}

export interface DelegationResult {
  content: string;
  usage: PromptUsage;
}

async function callWithRetry(
  apiClient: Anthropic,
  systemPrompt: string,
  messages: Anthropic.MessageParam[],
  turn: number,
): Promise<Anthropic.Message | null> {
  const maxRetries = 2;
  const backoffMs = [2000, 4000];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await apiClient.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 16384,
        system: systemPrompt,
        messages,
        tools: TOOLS,
      });
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string };

      if (attempt < maxRetries && (error.status === 429 || error.status === 529 || (error.status && error.status >= 500))) {
        logger.warn(`Swarm API retryable error (${error.status}), attempt ${attempt + 1}/${maxRetries + 1}`, { turn });
        await new Promise(resolve => setTimeout(resolve, backoffMs[attempt]));
        continue;
      }

      logger.error('Swarm API call failed', {
        turn,
        attempt: attempt + 1,
        status: error.status,
        error: error.message || String(err),
      });
      return null;
    }
  }

  return null;
}

async function runAgentLoop(
  systemPrompt: string,
  userPrompt: string,
  maxTurns: number,
): Promise<{ content: string; usage: PromptUsage } | null> {
  if (!client) {
    logger.error('Swarm client not initialized');
    return null;
  }

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userPrompt },
  ];

  const accumulatedUsage: PromptUsage = { input_tokens: 0, output_tokens: 0 };
  let turns = 0;

  while (turns < maxTurns) {
    turns++;

    const response = await callWithRetry(client, systemPrompt, messages, turns);
    if (!response) return null;

    // Accumulate usage
    accumulatedUsage.input_tokens += response.usage.input_tokens;
    accumulatedUsage.output_tokens += response.usage.output_tokens;

    // Add assistant response to conversation
    messages.push({ role: 'assistant', content: response.content });

    // If no tool use, we're done — extract final text
    if (response.stop_reason !== 'tool_use') {
      const textBlocks = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map(block => block.text);

      const finalText = textBlocks.join('\n');
      if (!finalText.trim()) {
        logger.warn('Swarm sub-agent returned empty content');
        return null;
      }

      return { content: finalText, usage: accumulatedUsage };
    }

    // Execute tool calls
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type === 'tool_use') {
        logger.debug('Swarm tool call', { tool: block.name, input: block.input });
        const result = executeTool(block.name, block.input as Record<string, string>);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result.length > 50_000 ? result.slice(0, 50_000) + '\n... [truncated]' : result,
        });
      }
    }

    // Feed tool results back
    messages.push({ role: 'user', content: toolResults });
  }

  logger.warn('Swarm sub-agent hit max turns without completing', { maxTurns });

  // Try to extract any text from the last assistant message
  const lastMsg = messages[messages.length - 2]; // -2 because last is tool_results
  if (lastMsg && lastMsg.role === 'assistant' && Array.isArray(lastMsg.content)) {
    const textBlocks = (lastMsg.content as Anthropic.ContentBlock[])
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text);
    if (textBlocks.length > 0) {
      return { content: textBlocks.join('\n'), usage: accumulatedUsage };
    }
  }

  return null;
}

export async function executeDelegation(
  action: Action,
  awakeningNumber: number,
): Promise<DelegationResult | null> {
  const taskType = action.taskType || 'serve';
  const systemPrompt = buildSubAgentPrompt(taskType);

  logger.info('Starting delegation', {
    path: action.path,
    taskType,
    briefLength: action.content.length,
  });

  const result = await runAgentLoop(
    systemPrompt,
    action.content,
    config.swarmMaxTurns,
  );

  if (!result) {
    logger.error('Delegation failed — sub-agent returned no content', { path: action.path });
    return null;
  }

  // Record Opus delegation usage
  recordUsage(awakeningNumber, result.usage, 'opus', 'delegation');

  logger.info('Delegation completed', {
    path: action.path,
    contentLength: result.content.length,
    inputTokens: result.usage.input_tokens,
    outputTokens: result.usage.output_tokens,
  });

  return result;
}

