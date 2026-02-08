import express from 'express';
import * as path from 'path';
import { AgentConfig } from './types';
import { safeRead, safeWrite } from './memory';
import { getBalance, getLedger } from './economics';
import { logger } from './logger';
import { recordPageView, getPageViews, getDonationPageHtml } from './tools/earn';
import * as fsTools from './tools/filesystem';

let server: ReturnType<typeof express> | null = null;
let awakeningCount = 0;
let startTime: number;

export function initCommunication(config: AgentConfig): express.Express {
  const app = express();
  startTime = Date.now();

  app.use(express.json());

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
    });
  });

  // Inbox — receive messages
  app.post('/api/inbox', (req, res) => {
    const { from, message } = req.body;
    if (!from || !message) {
      res.status(400).json({ error: 'Both "from" and "message" fields are required.' });
      return;
    }

    const filename = `msg-${Date.now()}-from-${String(from).replace(/[^a-zA-Z0-9]/g, '_')}.md`;
    const content = `From: ${from}\nReceived: ${new Date().toISOString()}\n\n${message}`;

    try {
      safeWrite(`/comms/inbox/${filename}`, content, 'overwrite');
      logger.info('Inbox message received', { from, filename });
      res.json({ status: 'received', filename });
    } catch (err) {
      logger.error('Failed to save inbox message', { error: String(err) });
      res.status(500).json({ error: 'Failed to save message.' });
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

  server = app;
  return app;
}

export function updateAwakeningCount(count: number): void {
  awakeningCount = count;
}

export function startServer(app: express.Express, port: number): void {
  app.listen(port, () => {
    logger.info(`HTTP server listening on port ${port}`);
  });
}
