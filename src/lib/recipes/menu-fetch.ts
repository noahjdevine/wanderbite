import { menuUrlAllowlisted } from '@/lib/recipes/menu-sources';
import { robotsAllowsPath } from '@/lib/recipes/menu-robots';

export const MENU_FETCH_USER_AGENT =
  'WanderbiteMenuDraftBot/1.0 (+https://wanderbite.com; operator offline inspired-by recipe drafts)';

export const MENU_FETCH_MIN_INTERVAL_MS = 1000;
export const MENU_FETCH_TIMEOUT_MS = 10_000;
export const MENU_FETCH_MAX_BYTES = 1_000_000;

export type RequestPacer = { armed: boolean; lastAt: number };

export function emptyRequestPacer(): RequestPacer {
  return { armed: false, lastAt: 0 };
}

export type MenuFetchResult =
  | { ok: true; html: string; retrievedAt: string }
  | { ok: false; reason: string };

export async function paceMenuRequest(
  pacer: RequestPacer,
  now: () => Date,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  const at = now().getTime();
  if (pacer.armed) {
    const wait = MENU_FETCH_MIN_INTERVAL_MS - (at - pacer.lastAt);
    if (wait > 0) await sleep(wait);
  }
  pacer.armed = true;
  pacer.lastAt = now().getTime();
}

async function readCapped(response: Response): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > MENU_FETCH_MAX_BYTES) return { ok: false, reason: 'response exceeds size cap' };
    return { ok: true, text };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    if (!step.value) continue;
    total += step.value.byteLength;
    if (total > MENU_FETCH_MAX_BYTES) {
      await reader.cancel();
      return { ok: false, reason: 'response exceeds size cap' };
    }
    chunks.push(step.value);
  }
  return { ok: true, text: Buffer.concat(chunks).toString('utf8') };
}

async function requestOnce(
  fetchImpl: typeof fetch,
  url: string,
  accept: string,
  pacer: RequestPacer,
  now: () => Date,
  sleep: (ms: number) => Promise<void>,
): Promise<{ ok: true; response: Response } | { ok: false; reason: string }> {
  await paceMenuRequest(pacer, now, sleep);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MENU_FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'user-agent': MENU_FETCH_USER_AGENT,
        accept,
      },
      signal: controller.signal,
    });
    return { ok: true, response };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return { ok: false, reason: 'request timed out' };
    return { ok: false, reason: 'request failed' };
  } finally {
    clearTimeout(timer);
  }
}

function redirected(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function looksLikeHtml(contentType: string, body: string): boolean {
  if (/application\/pdf|\bpdf\b/i.test(contentType) || body.startsWith('%PDF')) return false;
  if (/^image\//i.test(contentType) || body.startsWith('\u0089PNG') || body.startsWith('GIF8') || body.startsWith('\u00ff\u00d8')) {
    return false;
  }
  if (/text\/html|application\/xhtml\+xml/i.test(contentType)) return true;
  if (contentType.trim().length > 0) return false;
  return /^\s*</.test(body);
}

function skipKind(contentType: string, body: string): string | null {
  if (/application\/pdf|\bpdf\b/i.test(contentType) || body.startsWith('%PDF')) return 'skipped PDF';
  if (/^image\//i.test(contentType) || body.startsWith('\u0089PNG') || body.startsWith('GIF8')) return 'skipped image';
  if (!looksLikeHtml(contentType, body)) return 'skipped non-HTML response';
  return null;
}

/**
 * One GET of an allowlisted menu URL. Checks robots.txt for that path first.
 * Does not follow redirects or any other link.
 */
export async function fetchAllowlistedMenu(args: {
  menuUrl: string;
  allowlist: readonly string[];
  fetchImpl: typeof fetch;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  pacer: RequestPacer;
}): Promise<MenuFetchResult> {
  if (!menuUrlAllowlisted(args.menuUrl, args.allowlist)) {
    return { ok: false, reason: 'URL is not in the menu source registry' };
  }
  let menu: URL;
  try {
    menu = new URL(args.menuUrl);
  } catch {
    return { ok: false, reason: 'URL is not in the menu source registry' };
  }
  const robotsUrl = new URL('/robots.txt', menu).toString();
  const robots = await requestOnce(
    args.fetchImpl,
    robotsUrl,
    'text/plain',
    args.pacer,
    args.now,
    args.sleep,
  );
  if (!robots.ok) return { ok: false, reason: `robots.txt unavailable (${robots.reason})` };
  if (redirected(robots.response.status)) {
    return { ok: false, reason: 'robots.txt redirect refused' };
  }
  if (robots.response.status === 404 || robots.response.status === 410) {
    await robots.response.body?.cancel();
  } else if (robots.response.status !== 200) {
    await robots.response.body?.cancel();
    return { ok: false, reason: `robots.txt unavailable (${robots.response.status})` };
  } else {
    const robotsType = robots.response.headers.get('content-type') ?? '';
    if (/text\/html|application\/xhtml\+xml/i.test(robotsType)) {
      await robots.response.body?.cancel();
      return { ok: false, reason: 'robots.txt was not plain text' };
    }
    const robotsBody = await readCapped(robots.response);
    if (!robotsBody.ok) return { ok: false, reason: 'robots.txt exceeds size cap' };
    const path = `${menu.pathname}${menu.search}`;
    if (!robotsAllowsPath(robotsBody.text, path, MENU_FETCH_USER_AGENT)) {
      return { ok: false, reason: 'robots.txt disallows the menu path' };
    }
  }

  const page = await requestOnce(
    args.fetchImpl,
    args.menuUrl,
    'text/html,application/xhtml+xml;q=0.9',
    args.pacer,
    args.now,
    args.sleep,
  );
  if (!page.ok) return page;
  if (redirected(page.response.status)) {
    await page.response.body?.cancel();
    return { ok: false, reason: 'redirect refused; the registry URL must return the menu itself' };
  }
  if (page.response.status !== 200) {
    await page.response.body?.cancel();
    return { ok: false, reason: `menu page returned ${page.response.status}` };
  }
  const pageType = page.response.headers.get('content-type') ?? '';
  const body = await readCapped(page.response);
  if (!body.ok) return body;
  const skipped = skipKind(pageType, body.text);
  if (skipped) return { ok: false, reason: skipped };
  return { ok: true, html: body.text, retrievedAt: args.now().toISOString() };
}
