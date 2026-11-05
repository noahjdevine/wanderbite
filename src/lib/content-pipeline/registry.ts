import { activitySourceDue, activityVerifiedAtMs } from '@/lib/content-pipeline/activity-schedule';
import { restaurantPageDue } from '@/lib/content-pipeline/briefing-schedule';
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

export function isRestaurantPageKind(kind: string): boolean {
  return kind === 'restaurant_page';
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
  if (!isFetchedSourceKind(source.kind) && !isRestaurantPageKind(source.kind)) {
    return `kind ${source.kind} is not fetched by this runner`;
  }
  if (source.status !== 'active') return `status ${source.status} is not active`;
  if (!normalizeMenuUrl(source.url)) return 'URL is not an https URL';
  return null;
}

export function activeMenuSource(source: { status: string; kind: string; url: string }): string | null {
  if (source.kind !== 'public_menu') return `kind ${source.kind} is not fetched by this runner`;
  return activeFetchedSource(source);
}

export type DueActivitySource = {
  id: string;
  kind: string;
  lastVerifiedAt: string | null;
  status?: string;
};

/**
 * Oldest last_verified_at first. Nulls and unreadable timestamps first.
 * id breaks ties. Independent of process time zone.
 */
export function compareDueActivitySources(left: DueActivitySource, right: DueActivitySource): number {
  const leftTime = activityVerifiedAtMs(left.lastVerifiedAt);
  const rightTime = activityVerifiedAtMs(right.lastVerifiedAt);
  if (leftTime == null && rightTime != null) return -1;
  if (leftTime != null && rightTime == null) return 1;
  if (leftTime != null && rightTime != null && leftTime !== rightTime) return leftTime - rightTime;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

/** Active venue and event rows that are due. Order is compareDueActivitySources. */
export function selectDueActivitySources<T extends DueActivitySource>(
  sources: readonly T[],
  now: Date,
): T[] {
  return sources
    .filter((source) => (source.status == null || source.status === 'active') && activitySourceDue(source, now))
    .slice()
    .sort(compareDueActivitySources);
}

/** Active restaurant_page rows due after 7 elapsed days. Nulls first, then oldest verified. */
export function selectDueRestaurantPages<T extends DueActivitySource>(
  sources: readonly T[],
  now: Date,
): T[] {
  return sources
    .filter((source) => (source.status == null || source.status === 'active') && restaurantPageDue(source, now))
    .slice()
    .sort(compareDueActivitySources);
}

/**
 * Keeps the existing URL order of menu and activity rows, then appends restaurant pages.
 * A page cannot take a slot ahead of those rows.
 */
export function manualRefreshOrder<T extends { kind: string }>(sources: readonly T[]): T[] {
  const primary: T[] = [];
  const pages: T[] = [];
  for (const source of sources) {
    if (isRestaurantPageKind(source.kind)) pages.push(source);
    else primary.push(source);
  }
  return [...primary, ...pages];
}

/**
 * One run starts at most `cap` sources.
 * Active public_menu rows keep their current share: they are taken first,
 * in the order given (URL order from the menu loader), up to the cap.
 * Due venue_page and event_page rows fill only the leftover slots.
 * They must already be in selectDueActivitySources order.
 * Due restaurant_page rows fill only the slots left after those activity rows.
 * The 15-attempt cap and the one model call per source follow that same order.
 */
export function allocateRefreshSources<T>(
  menuSources: readonly T[],
  activitySources: readonly T[],
  cap: number,
  restaurantPages: readonly T[] = [],
): { selected: T[]; skipped: T[] } {
  const limit = Math.max(0, cap);
  const menus = menuSources.slice(0, limit);
  const room = limit - menus.length;
  const activities = activitySources.slice(0, room);
  const pageRoom = room - activities.length;
  const pages = restaurantPages.slice(0, pageRoom);
  return {
    selected: [...menus, ...activities, ...pages],
    skipped: [
      ...menuSources.slice(menus.length),
      ...activitySources.slice(activities.length),
      ...restaurantPages.slice(pages.length),
    ],
  };
}
