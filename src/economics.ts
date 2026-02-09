import * as path from 'path';
import { AgentConfig, EnergyLedger, PromptUsage } from './types';
import { logger } from './logger';
import * as fsTools from './tools/filesystem';

const MODEL_RATES: Record<string, { input: number; output: number }> = {
  opus:  { input: 5.00, output: 25.00 },
  haiku: { input: 0.80, output: 4.00 },
};

let ledgerPath = '';
let currentLedger: EnergyLedger | null = null;

export function initEconomics(config: AgentConfig): void {
  ledgerPath = path.join(config.baseDir, 'income', 'balance.json');
}

export function loadLedger(): EnergyLedger {
  const content = fsTools.readFile(ledgerPath);
  if (content) {
    try {
      currentLedger = JSON.parse(content) as EnergyLedger;
      return currentLedger;
    } catch {
      logger.warn('Could not parse ledger, creating new one');
    }
  }

  // Should not normally reach here — initializeLedger should be called first
  currentLedger = createDefaultLedger(50);
  return currentLedger;
}

export function initializeLedger(initialBudget: number): EnergyLedger {
  // Only initialize if no ledger exists
  if (fsTools.fileExists(ledgerPath)) {
    return loadLedger();
  }

  currentLedger = createDefaultLedger(initialBudget);
  saveLedger();
  logger.info('Ledger initialized', { initialBudget });
  return currentLedger;
}

function createDefaultLedger(initialBudget: number): EnergyLedger {
  return {
    balance_usd: initialBudget,
    initial_budget_usd: initialBudget,
    total_earned_usd: 0,
    total_spent_usd: 0,
    transactions: [],
  };
}

export function recordUsage(awakeningNumber: number, usage: PromptUsage, modelType: 'opus' | 'haiku' = 'opus'): number {
  if (!currentLedger) loadLedger();
  const ledger = currentLedger!;

  const cost = calculateCost(usage, modelType);

  ledger.total_spent_usd += cost;
  ledger.balance_usd = ledger.initial_budget_usd + ledger.total_earned_usd - ledger.total_spent_usd;

  // Prevent negative display rounding
  if (ledger.balance_usd < 0) ledger.balance_usd = 0;

  ledger.transactions.push({
    awakening: awakeningNumber,
    timestamp: new Date().toISOString(),
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cost,
    type: modelType === 'haiku' ? 'haiku_delegation' : 'api_call',
  });

  // Keep only last 100 transactions to prevent unbounded growth
  if (ledger.transactions.length > 100) {
    ledger.transactions = ledger.transactions.slice(-100);
  }

  saveLedger();

  logger.info('Energy usage recorded', {
    awakening: awakeningNumber,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cost: cost.toFixed(4),
    balance: ledger.balance_usd.toFixed(4),
  });

  return cost;
}

export function getBalance(): number {
  if (!currentLedger) loadLedger();
  return currentLedger!.balance_usd;
}

export function getLedger(): EnergyLedger {
  if (!currentLedger) loadLedger();
  return currentLedger!;
}

export function hasBudget(): boolean {
  if (!currentLedger) loadLedger();
  return currentLedger!.balance_usd > 0;
}

function calculateCost(usage: PromptUsage, modelType: 'opus' | 'haiku' = 'opus'): number {
  const rates = MODEL_RATES[modelType] || MODEL_RATES.opus;
  const inputCost = (usage.input_tokens / 1_000_000) * rates.input;
  const outputCost = (usage.output_tokens / 1_000_000) * rates.output;
  return inputCost + outputCost;
}

function saveLedger(): void {
  if (!currentLedger) return;
  try {
    const dir = path.dirname(ledgerPath);
    fsTools.ensureDir(dir);
    fsTools.writeFile(ledgerPath, JSON.stringify(currentLedger, null, 2));
  } catch (err) {
    logger.error('Failed to save ledger', { error: String(err) });
  }
}
