export type PhotoCredit = {
  name: string;
  href: string;
};

const GOOGLE_CREDIT_HOSTS = new Set([
  'google.com',
  'www.google.com',
  'maps.google.com',
]);

function safeCreditHref(raw: string): string | null {
  const trimmed = raw.trim();
  const withProtocol = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (!GOOGLE_CREDIT_HOSTS.has(url.hostname)) return null;
  if (url.username || url.password) return null;
  return url.toString();
}

function creditFromHtml(html: string): PhotoCredit | null {
  const hrefMatch = html.match(/href\s*=\s*["']([^"']+)["']/i);
  const name = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!hrefMatch || !name || name.length > 200) return null;
  const href = safeCreditHref(hrefMatch[1] ?? '');
  if (!href) return null;
  return { name, href };
}

/**
 * Legacy Place Photos: empty html_attributions needs no extra credit.
 * A non-empty list must become safe author links or the photo is not shown.
 */
export function legacyPhotoCredit(
  attributions: string[] | undefined,
): PhotoCredit[] | null | 'unsafe' {
  const parts = (attributions ?? []).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const credits: PhotoCredit[] = [];
  for (const part of parts) {
    const credit = creditFromHtml(part);
    if (!credit) return 'unsafe';
    credits.push(credit);
  }
  return credits;
}

export function isSafePhotoCredit(value: unknown): value is PhotoCredit {
  if (!value || typeof value !== 'object') return false;
  const credit = value as { name?: unknown; href?: unknown };
  if (typeof credit.name !== 'string' || typeof credit.href !== 'string') return false;
  if (!credit.name.trim() || credit.name.length > 200) return false;
  return safeCreditHref(credit.href) === credit.href;
}
