import Anthropic from '@anthropic-ai/sdk';
import { AgentConfig, ReasoningResult } from './types';
import { logger } from './logger';

let client: Anthropic | null = null;
let fatalError = false;

export function initReasoning(config: AgentConfig): void {
  client = new Anthropic({ apiKey: config.anthropicApiKey });
}

export function isReasoningAvailable(): boolean {
  return client !== null && !fatalError;
}

export async function reason(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number
): Promise<ReasoningResult | null> {
  if (!client || fatalError) {
    logger.error('Reasoning unavailable — client not initialized or fatal error');
    return null;
  }

  const retries = 3;
  const backoffMs = [2000, 4000, 8000];

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await client.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: maxTokens,
        temperature: 1.0,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map(block => block.text)
        .join('\n');

      return {
        text,
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
          cache_creation_input_tokens: (response.usage as unknown as Record<string, number>).cache_creation_input_tokens,
          cache_read_input_tokens: (response.usage as unknown as Record<string, number>).cache_read_input_tokens,
        },
        stopReason: response.stop_reason,
      };
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string };

      // Fatal: bad API key — stop all future awakenings
      if (error.status === 401) {
        logger.error('Fatal: Invalid API key (401). Stopping all future reasoning.', {
          error: error.message,
        });
        fatalError = true;
        return null;
      }

      // Retryable errors
      if (error.status === 429 || error.status === 529 || (error.status && error.status >= 500)) {
        logger.warn(`Retryable error (${error.status}), attempt ${attempt + 1}/${retries}`, {
          error: error.message,
        });
        if (attempt < retries - 1) {
          await sleep(backoffMs[attempt]);
          continue;
        }
      }

      logger.error('Reasoning API call failed', {
        attempt: attempt + 1,
        status: error.status,
        error: error.message || String(err),
      });

      if (attempt === retries - 1) {
        return null;
      }
    }
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
