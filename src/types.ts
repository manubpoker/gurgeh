export interface AgentConfig {
  anthropicApiKey: string;
  spriteName: string;
  initialBudget: number;
  awakeningIntervalMinutes: number;
  maxTokensPerCycle: number;
  port: number;
  testing: boolean;
  baseDir: string;
}

export interface Action {
  type: 'write' | 'serve' | 'think' | 'checkpoint' | 'message' | 'fetch' | 'set-schedule';
  path?: string;
  mode?: 'append' | 'overwrite';
  content: string;
  to?: string;
  url?: string;
  cron?: string;
  label?: string;
}

export interface AwakeningState {
  awakeningNumber: number;
  timestamp: string;
  timeSinceLastMs: number | null;
  identity: string | null;
  journal: string | null;
  values: string | null;
  currentFocus: string | null;
  inbox: InboxMessage[];
  energy: EnergyLedger;
}

export interface InboxMessage {
  filename: string;
  from: string;
  message: string;
  receivedAt: string;
}

export interface EnergyLedger {
  balance_usd: number;
  initial_budget_usd: number;
  total_earned_usd: number;
  total_spent_usd: number;
  transactions: EnergyTransaction[];
}

export interface EnergyTransaction {
  awakening: number;
  timestamp: string;
  input_tokens: number;
  output_tokens: number;
  cost: number;
  type: string;
}

export interface PromptUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface ReasoningResult {
  text: string;
  usage: PromptUsage;
  stopReason: string | null;
}

export interface ExecutionResult {
  action: Action;
  success: boolean;
  error?: string;
}

export interface DecisionRecord {
  id: string;
  timestamp: string;
  action_type: string;
  description: string;
  harm_assessment: string;
  decision: 'proceed' | 'defer' | 'block';
  reasoning: string;
}

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
