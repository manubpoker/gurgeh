import express from 'express';
import cors from 'cors';
import * as path from 'path';
import { AgentConfig } from './types';
import { safeRead, safeWrite, safeList } from './memory';
import { getBalance, getLedger } from './economics';
import { logger } from './logger';
import { recordPageView, getPageViews, getDonationPageHtml } from './tools/earn';
import * as fsTools from './tools/filesystem';
import { listTasks, getTask, createTask, updateTask, deleteTask } from './task-manager';

let triggerAwakeningFn: (() => Promise<boolean>) | null = null;

export function setTriggerAwakening(fn: () => Promise<boolean>): void {
  triggerAwakeningFn = fn;
}

let server: ReturnType<typeof express> | null = null;
let awakeningCount = 0;
let startTime: number;
let lastAwakeningEnd: number = 0;
let currentIntervalMinutes: number = 30;

export function updateScheduleInfo(intervalMinutes: number): void {
  currentIntervalMinutes = intervalMinutes;
  lastAwakeningEnd = Date.now();
}

export function initCommunication(config: AgentConfig): express.Express {
  const app = express();
  startTime = Date.now();

  app.use(express.json());

  // CORS
  const allowedOrigins = ['http://localhost:3000'];
  if (process.env.FRONTEND_URL) {
    allowedOrigins.push(process.env.FRONTEND_URL);
  }
  app.use(cors({ origin: allowedOrigins }));

  // Entity type header on all responses
  app.use((_req, res, next) => {
    res.setHeader('X-Entity-Type', 'autonomous-ai-agent');
    next();
  });

  // Serve public files
  const publicDir = path.join(config.baseDir, 'public');
  app.use('/public', express.static(publicDir));

  // Root — serve index.html
  app.get('/', (req, res) => {
    recordPageView();
    const indexPath = path.join(config.baseDir, 'public', 'index.html');
    const content = fsTools.readFile(indexPath);
    if (content) {
      res.type('html').send(content);
    } else {
      res.type('html').send('<h1>This entity is initialising.</h1>');
    }
  });

  // Status API
  app.get('/api/status', (_req, res) => {
    const ledger = getLedger();
    res.json({
      entity: 'autonomous-moral-agent',
      name: config.spriteName,
      awakenings: awakeningCount,
      energy: {
        balance_usd: ledger.balance_usd,
        initial_budget_usd: ledger.initial_budget_usd,
        total_spent_usd: ledger.total_spent_usd,
      },
      uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
      page_views: getPageViews(),
      schedule: {
        interval_minutes: currentIntervalMinutes,
        last_awakening_end: lastAwakeningEnd ? new Date(lastAwakeningEnd).toISOString() : null,
        next_awakening_at: lastAwakeningEnd ? new Date(lastAwakeningEnd + currentIntervalMinutes * 60000).toISOString() : null,
        seconds_until_next: lastAwakeningEnd ? Math.max(0, Math.floor((lastAwakeningEnd + currentIntervalMinutes * 60000 - Date.now()) / 1000)) : null,
      },
    });
  });

  // Inbox — receive messages
  app.post('/api/inbox', (req, res) => {
    const { from, message } = req.body;
    if (!from || !message) {
      res.status(400).json({ error: 'Both "from" and "message" fields are required.' });
      return;
    }

    const safeFrom = String(from).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    const filename = `msg-${Date.now()}-from-${safeFrom}.md`;
    const content = `From: ${safeFrom}\nReceived: ${new Date().toISOString()}\n\n${message}`;

    try {
      safeWrite(`/comms/inbox/${filename}`, content, 'overwrite');
      logger.info('Inbox message received', { from, filename });
      res.json({ status: 'received', filename });
    } catch (err) {
      logger.error('Failed to save inbox message', { error: String(err) });
      res.status(500).json({ error: 'Failed to save message.' });
    }
  });

  // Inbox listing
  app.get('/api/inbox', (_req, res) => {
    const files = safeList('/comms/inbox');
    res.json({ files: files.filter(f => f.endsWith('.md')).sort().reverse() });
  });

  // Specific inbox message
  app.get('/api/inbox/:filename', (req, res) => {
    const content = safeRead(`/comms/inbox/${req.params.filename}`);
    if (content) {
      res.type('text').send(content);
    } else {
      res.status(404).json({ error: 'Message not found' });
    }
  });

  // Identity API
  app.get('/api/identity', (_req, res) => {
    const identity = safeRead('/self/identity.md');
    if (identity) {
      res.type('text').send(identity);
    } else {
      res.type('text').send('This entity has not yet defined its identity.');
    }
  });

  // Donation page
  app.get('/api/donate', (_req, res) => {
    recordPageView();
    res.type('html').send(getDonationPageHtml());
  });

  // --- Dashboard API routes ---

  // Journal
  app.get('/api/journal', (_req, res) => {
    const journal = safeRead('/self/journal.md');
    if (journal) {
      res.type('text').send(journal);
    } else {
      res.type('text').send('No journal entries yet.');
    }
  });

  // Values
  app.get('/api/values', (_req, res) => {
    const values = safeRead('/self/values.md');
    if (values) {
      res.type('text').send(values);
    } else {
      res.type('text').send('No values defined yet.');
    }
  });

  // Current focus
  app.get('/api/current-focus', (_req, res) => {
    const focus = safeRead('/self/current-focus.md');
    if (focus) {
      res.type('text').send(focus);
    } else {
      res.type('text').send('No current focus set.');
    }
  });

  // Awakenings list
  app.get('/api/awakenings', (req, res) => {
    const files = safeList('/self/awakenings');
    const sorted = files.filter(f => f.endsWith('.md')).sort().reverse();
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const page = sorted.slice(offset, offset + limit);
    res.json({ total: sorted.length, offset, limit, files: page });
  });

  // Specific awakening
  app.get('/api/awakenings/:id', (req, res) => {
    const content = safeRead(`/self/awakenings/${req.params.id}`);
    if (content) {
      res.type('text').send(content);
    } else {
      res.status(404).json({ error: 'Awakening not found' });
    }
  });

  // Outbox list
  app.get('/api/outbox', (_req, res) => {
    const files = safeList('/comms/outbox');
    res.json({ files: files.sort().reverse() });
  });

  // Specific outbox message
  app.get('/api/outbox/:filename', (req, res) => {
    const content = safeRead(`/comms/outbox/${req.params.filename}`);
    if (content) {
      res.type('text').send(content);
    } else {
      res.status(404).json({ error: 'Message not found' });
    }
  });

  // Projects — recursive file listing
  app.get('/api/projects', (_req, res) => {
    const projectsDir = path.join(config.baseDir, 'projects');
    try {
      const listing = listFilesRecursive(projectsDir, '');
      res.json({ files: listing });
    } catch {
      res.json({ files: [] });
    }
  });

  // Project file content
  app.get('/api/projects/*', (req, res) => {
    const filePath = req.url.replace('/api/projects/', '');
    if (!filePath) {
      res.status(400).json({ error: 'File path required' });
      return;
    }
    const content = safeRead(`/projects/${filePath}`);
    if (content) {
      res.type('text').send(content);
    } else {
      res.status(404).json({ error: 'File not found' });
    }
  });

  // Energy / economics
  app.get('/api/energy', (_req, res) => {
    const ledger = getLedger();
    res.json(ledger);
  });

  // Decisions
  app.get('/api/decisions', (_req, res) => {
    const files = safeList('/self/decisions/pending');
    res.json({ files: files.filter(f => f.endsWith('.json')).sort().reverse() });
  });

  // Execution logs
  app.get('/api/executions', (_req, res) => {
    const files = safeList('/self/execution-logs');
    const logs: unknown[] = [];
    const sorted = files.filter(f => f.endsWith('.json')).sort().reverse();
    for (const file of sorted.slice(0, 50)) {
      const content = safeRead(`/self/execution-logs/${file}`);
      if (content) {
        try { logs.push(JSON.parse(content)); } catch { /* skip */ }
      }
    }
    res.json({ logs });
  });

  // --- Task routes ---

  // List all tasks
  app.get('/api/tasks', (req, res) => {
    const status = req.query.status as string | undefined;
    const priority = req.query.priority as string | undefined;
    const tasks = listTasks({ status, priority });
    res.json({ tasks });
  });

  // Create task
  app.post('/api/tasks', (req, res) => {
    const { title, description, priority, category } = req.body;
    if (!title || !description) {
      res.status(400).json({ error: 'title and description are required' });
      return;
    }
    const task = createTask(title, description, priority || 'medium', 'operator', category);
    res.status(201).json(task);
  });

  // Get specific task
  app.get('/api/tasks/:id', (req, res) => {
    const task = getTask(req.params.id);
    if (task) {
      res.json(task);
    } else {
      res.status(404).json({ error: 'Task not found' });
    }
  });

  // Update task
  app.patch('/api/tasks/:id', (req, res) => {
    const { title, description, priority, status, agentNotes, category } = req.body;
    const task = updateTask(req.params.id, { title, description, priority, status, agentNotes, category });
    if (task) {
      res.json(task);
    } else {
      res.status(404).json({ error: 'Task not found' });
    }
  });

  // Delete (archive) task
  app.delete('/api/tasks/:id', (req, res) => {
    const success = deleteTask(req.params.id);
    if (success) {
      res.json({ status: 'archived' });
    } else {
      res.status(404).json({ error: 'Task not found' });
    }
  });

  // Get/set schedule
  app.get('/api/schedule', (_req, res) => {
    const schedule = safeRead('/self/schedule.txt');
    res.json({
      cron: schedule?.trim() || `*/${config.awakeningIntervalMinutes} * * * *`,
      interval_minutes: currentIntervalMinutes,
      last_awakening_end: lastAwakeningEnd ? new Date(lastAwakeningEnd).toISOString() : null,
      next_awakening_at: lastAwakeningEnd ? new Date(lastAwakeningEnd + currentIntervalMinutes * 60000).toISOString() : null,
    });
  });

  app.put('/api/schedule', (req, res) => {
    const { interval_minutes } = req.body;
    if (!interval_minutes || typeof interval_minutes !== 'number' || interval_minutes < 1 || interval_minutes > 1440) {
      res.status(400).json({ error: 'interval_minutes must be between 1 and 1440' });
      return;
    }
    const cron = `*/${interval_minutes} * * * *`;
    safeWrite('/self/schedule.txt', cron, 'overwrite');
    currentIntervalMinutes = interval_minutes;
    logger.info('Schedule updated via API', { interval_minutes, cron });
    // Trigger re-read on next awakening cycle; for immediate effect, trigger an awakening
    res.json({ status: 'updated', cron, interval_minutes });
  });

  // Trigger awakening
  app.post('/api/trigger-awakening', async (_req, res) => {
    try {
      if (!triggerAwakeningFn) {
        res.status(503).json({ error: 'Supervisor not ready' });
        return;
      }
      const started = await triggerAwakeningFn();
      if (started) {
        res.json({ status: 'awakening_triggered' });
      } else {
        res.status(409).json({ error: 'Awakening already in progress' });
      }
    } catch (err) {
      logger.error('Failed to trigger awakening', { error: String(err) });
      res.status(500).json({ error: 'Failed to trigger awakening' });
    }
  });

  // Serve public files at root (catch-all, after all API routes)
  app.use(express.static(publicDir));

  server = app;
  return app;
}

function listFilesRecursive(basePath: string, prefix: string): string[] {
  const results: string[] = [];
  try {
    const entries = fsTools.listDir(basePath);
    for (const entry of entries) {
      const fullPath = path.join(basePath, entry);
      const relativePath = prefix ? `${prefix}/${entry}` : entry;
      if (fsTools.isDirectory(fullPath)) {
        results.push(...listFilesRecursive(fullPath, relativePath));
      } else {
        results.push(relativePath);
      }
    }
  } catch {
    // Directory doesn't exist or isn't readable
  }
  return results;
}

export function updateAwakeningCount(count: number): void {
  awakeningCount = count;
}

export function startServer(app: express.Express, port: number): void {
  const srv = app.listen(port, () => {
    logger.info(`HTTP server listening on port ${port}`);
  });
  srv.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${port} already in use — HTTP server not started. Agent continues without HTTP.`, { port });
    } else {
      logger.error('HTTP server error', { error: String(err), code: err.code });
    }
  });
}
