import { logger } from '../logger';

const ALLOWED_DOMAINS = [
  'api.anthropic.com',
  'github.com',
  'raw.githubusercontent.com',
  'en.wikipedia.org',
  'news.ycombinator.com',
];

export function isDomainAllowed(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_DOMAINS.some(d => parsed.hostname === d || parsed.hostname.endsWith('.' + d));
  } catch {
    return false;
  }
}

export async function safeFetch(url: string): Promise<{ status: number; body: string } | null> {
  if (!isDomainAllowed(url)) {
    logger.warn('Fetch blocked — domain not in allowlist', { url });
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AutonomousMoralAgent/1.0' },
    });

    clearTimeout(timeout);

    const body = await res.text();
    // Limit response size to 100KB
    const truncated = body.length > 102400 ? body.slice(0, 102400) + '\n[...truncated at 100KB]' : body;

    return { status: res.status, body: truncated };
  } catch (err) {
    logger.error('Fetch failed', { url, error: String(err) });
    return null;
  }
}
