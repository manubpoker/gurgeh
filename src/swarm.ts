import Anthropic from '@anthropic-ai/sdk';
import { Action, AgentConfig, PromptUsage } from './types';
import { safeRead, safeList } from './memory';
import { recordUsage } from './economics';
import { logger } from './logger';

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

function executeTool(name: string, input: Record<string, string>): string {
  switch (name) {
    case 'read_file': {
      const content = safeRead(input.path);
      return content || 'File not found or empty.';
    }
    case 'list_files': {
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

    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8192,
        system: systemPrompt,
        messages,
        tools: TOOLS,
      });
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string };
      logger.error('Swarm API call failed', {
        turn: turns,
        status: error.status,
        error: error.message || String(err),
      });
      return null;
    }

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

  // Record Haiku usage
  recordUsage(awakeningNumber, result.usage, 'haiku');

  logger.info('Delegation completed', {
    path: action.path,
    contentLength: result.content.length,
    inputTokens: result.usage.input_tokens,
    outputTokens: result.usage.output_tokens,
  });

  return result;
}

export async function executeDelegations(
  actions: Action[],
  awakeningNumber: number,
): Promise<Map<Action, DelegationResult | null>> {
  const results = new Map<Action, DelegationResult | null>();
  let accumulatedCost = 0;

  // Process in batches of maxConcurrent
  for (let i = 0; i < actions.length; i += config.swarmMaxConcurrent) {
    const batch = actions.slice(i, i + config.swarmMaxConcurrent);

    // Budget guard — check before starting batch
    if (accumulatedCost >= config.swarmMaxBudget) {
      logger.warn('Swarm budget exhausted, skipping remaining delegations', {
        spent: accumulatedCost.toFixed(4),
        budget: config.swarmMaxBudget,
        remaining: actions.length - i,
      });
      for (const action of actions.slice(i)) {
        results.set(action, null);
      }
      break;
    }

    const batchResults = await Promise.all(
      batch.map(action => executeDelegation(action, awakeningNumber)),
    );

    for (let j = 0; j < batch.length; j++) {
      results.set(batch[j], batchResults[j]);
      if (batchResults[j]) {
        const usage = batchResults[j]!.usage;
        const rates = { input: 0.80, output: 4.00 };
        const cost = (usage.input_tokens / 1_000_000) * rates.input
                   + (usage.output_tokens / 1_000_000) * rates.output;
        accumulatedCost += cost;
      }
    }
  }

  return results;
}
