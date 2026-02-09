import Anthropic from '@anthropic-ai/sdk';
import * as path from 'path';
import * as fs from 'fs';
import { AgentConfig, PromptUsage } from '../types';
import { validatePath } from '../memory';
import * as fsTools from './filesystem';
import { logger } from '../logger';

export interface ScreenshotResult {
  imagePath: string;
  analysis: string;
  usage: PromptUsage;
}

let client: Anthropic | null = null;
let config: AgentConfig;
let screenshotsThisAwakening = 0;

const MAX_SCREENSHOTS_PER_AWAKENING = 3;

export function initScreenshot(cfg: AgentConfig): void {
  config = cfg;
  client = new Anthropic({ apiKey: cfg.anthropicApiKey });
}

export function resetScreenshotCounter(): void {
  screenshotsThisAwakening = 0;
}

export async function takeScreenshot(
  pagePath: string,
  analysisPrompt: string,
): Promise<ScreenshotResult | null> {
  if (!client) {
    logger.error('Screenshot client not initialized');
    return null;
  }

  if (screenshotsThisAwakening >= MAX_SCREENSHOTS_PER_AWAKENING) {
    logger.warn('Screenshot budget exceeded', {
      used: screenshotsThisAwakening,
      max: MAX_SCREENSHOTS_PER_AWAKENING,
    });
    return null;
  }

  screenshotsThisAwakening++;

  let puppeteer: typeof import('puppeteer');
  try {
    puppeteer = await import('puppeteer');
  } catch (err) {
    logger.error('Puppeteer not available', { error: String(err) });
    return null;
  }

  let browser;
  try {
    // Launch headless browser
    browser = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    const url = `http://localhost:${config.port}${pagePath}`;
    logger.info('Taking screenshot', { url });

    await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });

    // Capture PNG as buffer
    const pngBuffer = await page.screenshot({ type: 'png', fullPage: false }) as Buffer;

    await browser.close();
    browser = null;

    // Save PNG to /self/screenshots/
    const timestamp = Date.now();
    const screenshotRelPath = `/self/screenshots/review-${timestamp}.png`;
    const fullScreenshotPath = validatePath(screenshotRelPath);
    fsTools.ensureDir(path.dirname(fullScreenshotPath));
    fs.writeFileSync(fullScreenshotPath, pngBuffer);

    // Cleanup: cap at 20 screenshots
    cleanupDir(path.dirname(fullScreenshotPath), 20, '.png');

    // Send to Claude Opus 4.6 vision API
    const base64Image = pngBuffer.toString('base64');

    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 2048,
      system: 'You are reviewing a web page screenshot for an autonomous AI entity. Describe what you see: layout, visual quality, any broken elements, whether interactive controls appear functional. Be concise but thorough.',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: base64Image,
              },
            },
            {
              type: 'text',
              text: analysisPrompt || 'Describe this page and identify any visual issues.',
            },
          ],
        },
      ],
    });

    // Extract analysis text
    const analysisText = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    // Save analysis to /self/screenshot-reviews/
    const reviewRelPath = `/self/screenshot-reviews/review-${timestamp}.md`;
    const fullReviewPath = validatePath(reviewRelPath);
    fsTools.ensureDir(path.dirname(fullReviewPath));

    const reviewContent = `# Screenshot Review: ${pagePath}\n\nDate: ${new Date().toISOString()}\nPrompt: ${analysisPrompt}\n\n## Analysis\n\n${analysisText}\n`;
    fs.writeFileSync(fullReviewPath, reviewContent);

    // Cleanup: cap at 20 reviews
    cleanupDir(path.dirname(fullReviewPath), 20, '.md');

    const usage: PromptUsage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    };

    logger.info('Screenshot review completed', {
      path: pagePath,
      screenshotPath: screenshotRelPath,
      reviewPath: reviewRelPath,
      analysisLength: analysisText.length,
    });

    return {
      imagePath: screenshotRelPath,
      analysis: analysisText,
      usage,
    };
  } catch (err) {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
    logger.error('Screenshot failed', { path: pagePath, error: String(err) });
    return null;
  }
}

function cleanupDir(dirPath: string, maxFiles: number, ext: string): void {
  try {
    const files = fs.readdirSync(dirPath)
      .filter(f => f.endsWith(ext))
      .sort();
    if (files.length > maxFiles) {
      const toDelete = files.slice(0, files.length - maxFiles);
      for (const file of toDelete) {
        fs.unlinkSync(path.join(dirPath, file));
      }
    }
  } catch {
    // Cleanup is best-effort
  }
}
