export interface AgentConfig {
  anthropicApiKey: string;
  spriteName: string;
  initialBudget: number;
  awakeningIntervalMinutes: number;
  maxTokensPerCycle: number;
  port: number;
  testing: boolean;
  baseDir: string;
  swarmMaxBudget: number;
  swarmMaxTurns: number;
  swarmMaxConcurrent: number;
}

export interface Action {
  type: 'write' | 'serve' | 'think' | 'checkpoint' | 'message' | 'fetch' | 'set-schedule' | 'execute' | 'image' | 'delegate';
  path?: string;
  mode?: 'append' | 'overwrite';
  content: string;
  to?: string;
  url?: string;
  cron?: string;
  label?: string;
  timeout?: number;
  workingDir?: string;
  aspectRatio?: string;
  taskType?: 'serve' | 'code';
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
  recentExecutions: ExecutionLog[];
  tasks: Task[];
  siteManifest: string | null;
  workHistory: string | null;
  memorySummary: string | null;
}

export interface ExecutionLog {
  id: string;
  awakening: number;
  timestamp: string;
  command: string;
  workingDir: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  duration_ms: number;
  timedOut: boolean;
}

export interface Task {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: 'operator' | 'agent';
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'suggested' | 'accepted' | 'in_progress' | 'completed' | 'declined';
  category?: string;
  agentNotes?: string;
  completedAt?: string;
}

export interface InboxMessage {
  filename: string;
  from: string;
  message: string;
  receivedAt: string;
  isNew: boolean;
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
