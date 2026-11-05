import { normalizeMenuUrl, type MenuSource } from '@/lib/recipes/menu-sources';

export const FETCHED_SOURCE_KINDS = ['public_menu', 'venue_page', 'event_page'] as const;
export type FetchedSourceKind = (typeof FETCHED_SOURCE_KINDS)[number];

export const ACTIVITY_SOURCE_KINDS = ['venue_page', 'event_page'] as const;
export type ActivitySourceKind = (typeof ACTIVITY_SOURCE_KINDS)[number];

export type SeedSource = {
  kind: 'public_menu';
  url: string;
  restaurantSlug: string;
  notes: string;
};

export type ActivitySeed = {
  kind: ActivitySourceKind;
  url: string;
  restaurantSlug: string | null;
  notes: string;
};

/** The #88 menu registry. SQL does not insert these URLs. */
export function seedSourcesFromRegistry(sources: readonly MenuSource[]): SeedSource[] {
  return sources.map((source) => ({
    kind: 'public_menu',
    url: source.menuUrl,
    restaurantSlug: source.restaurantSlug,
    notes: source.notes,
  }));
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isFetchedSourceKind(kind: string): kind is FetchedSourceKind {
  return (FETCHED_SOURCE_KINDS as readonly string[]).includes(kind);
}

export function isActivitySourceKind(kind: string): kind is ActivitySourceKind {
  return (ACTIVITY_SOURCE_KINDS as readonly string[]).includes(kind);
}

/** Venue and event pages use the same https rule as a public menu. */
export function loadActivitySourceRegistry(
  text: string,
): { ok: true; sources: ActivitySeed[] } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, reason: 'activity source registry is not JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'activity source registry must be an object' };
  }
  const sources = (parsed as { sources?: unknown }).sources;
  if (!Array.isArray(sources) || sources.length === 0) {
    return { ok: false, reason: 'activity source registry has no sources' };
  }
  const loaded: ActivitySeed[] = [];
  const urls = new Set<string>();
  for (const entry of sources) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, reason: 'activity source entry is not an object' };
    }
    const record = entry as Record<string, unknown>;
    const kind = record.kind;
    const rawUrl = record.url;
    const notes = record.notes;
    const slug = record.restaurant_slug;
    if (typeof kind !== 'string' || !isActivitySourceKind(kind)) {
      return { ok: false, reason: 'activity source kind must be venue_page or event_page' };
    }
    if (typeof rawUrl !== 'string') return { ok: false, reason: 'activity source is missing url' };
    const url = normalizeMenuUrl(rawUrl);
    if (!url) return { ok: false, reason: 'activity source url must be https without credentials' };
    if (typeof notes !== 'string' || notes.trim().length === 0) {
      return { ok: false, reason: 'activity source is missing notes' };
    }
    if (slug != null && (typeof slug !== 'string' || !SLUG_RE.test(slug))) {
      return { ok: false, reason: 'activity source restaurant_slug is invalid' };
    }
    if (urls.has(url)) return { ok: false, reason: 'activity source duplicates a URL' };
    urls.add(url);
    loaded.push({
      kind,
      url,
      restaurantSlug: typeof slug === 'string' ? slug : null,
      notes: notes.trim(),
    });
  }
  return { ok: true, sources: loaded };
}

export function activeFetchedSource(source: { status: string; kind: string; url: string }): string | null {
  if (!isFetchedSourceKind(source.kind)) return `kind ${source.kind} is not fetched by this runner`;
  if (source.status !== 'active') return `status ${source.status} is not active`;
  if (!normalizeMenuUrl(source.url)) return 'URL is not an https URL';
  return null;
}

export function activeMenuSource(source: { status: string; kind: string; url: string }): string | null {
  if (source.kind !== 'public_menu') return `kind ${source.kind} is not fetched by this runner`;
  return activeFetchedSource(source);
}
