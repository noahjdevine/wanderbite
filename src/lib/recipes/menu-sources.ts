export type MenuSource = {
  restaurantSlug: string;
  menuUrl: string;
  notes: string;
};

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function normalizeMenuUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  url.hash = '';
  return url.toString();
}

export function loadMenuSources(text: string): { ok: true; sources: MenuSource[] } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, reason: 'menu source registry is not JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'menu source registry must be an object' };
  }
  const sources = (parsed as { sources?: unknown }).sources;
  if (!Array.isArray(sources) || sources.length === 0) {
    return { ok: false, reason: 'menu source registry has no sources' };
  }
  const loaded: MenuSource[] = [];
  const slugs = new Set<string>();
  const urls = new Set<string>();
  for (const entry of sources) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, reason: 'menu source entry is not an object' };
    }
    const record = entry as Record<string, unknown>;
    const slug = record.restaurant_slug;
    const menuUrl = record.menu_url;
    const notes = record.notes;
    if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
      return { ok: false, reason: 'menu source restaurant_slug is invalid' };
    }
    if (typeof menuUrl !== 'string') {
      return { ok: false, reason: `menu source ${slug} is missing menu_url` };
    }
    const normalized = normalizeMenuUrl(menuUrl);
    if (!normalized) {
      return { ok: false, reason: `menu source ${slug} menu_url must be https without credentials` };
    }
    if (typeof notes !== 'string' || notes.trim().length === 0) {
      return { ok: false, reason: `menu source ${slug} is missing notes` };
    }
    if (slugs.has(slug) || urls.has(normalized)) {
      return { ok: false, reason: `menu source ${slug} duplicates a slug or URL` };
    }
    slugs.add(slug);
    urls.add(normalized);
    loaded.push({ restaurantSlug: slug, menuUrl: normalized, notes: notes.trim() });
  }
  return { ok: true, sources: loaded };
}

/** True only when the URL is one of the registry URLs. Fetch refuses everything else. */
export function menuUrlAllowlisted(menuUrl: string, allowlist: readonly string[]): boolean {
  const normalized = normalizeMenuUrl(menuUrl);
  if (!normalized) return false;
  return allowlist.includes(normalized);
}
