/** Public path for restaurant cards when no safe manual image or Place photo is available. */
export const RESTAURANT_IMAGE_PLACEHOLDER = '/images/restaurant-placeholder.jpg';

const MANUAL_IMAGE_ORIGIN = 'https://www.wanderbite.co';
const MANUAL_IMAGE_RE = /^\/images\/[A-Za-z0-9._/-]+$/;

export type RestaurantImageFields = {
  id: string;
  google_place_id?: string | null;
  image_url?: string | null;
};

/** Exact lowercase true. Any other value leaves outbound Places calls enabled. */
export function isGooglePlacesOutboundDisabled(): boolean {
  return process.env.WANDERBITE_GOOGLE_PLACES_OUTBOUND_DISABLED === 'true';
}

/**
 * Same-origin static file under /images/. Rejects protocol-relative URLs,
 * backslashes, dot-segments, queries, and hashes. `/\evil.example/x` parses
 * as another host, so the raw string must survive URL parsing unchanged.
 */
export function safeManualImagePath(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  if (raw !== raw.trim() || !raw) return null;
  const value = raw;
  if (!MANUAL_IMAGE_RE.test(value)) return null;
  if (value.split('/').includes('..')) return null;

  let url: URL;
  try {
    url = new URL(value, MANUAL_IMAGE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== MANUAL_IMAGE_ORIGIN) return null;
  if (url.pathname !== value) return null;
  if (url.search || url.hash) return null;
  if (!url.pathname.startsWith('/images/')) return null;
  return url.pathname;
}

export function manualImagePathForSave(
  raw: string | null | undefined,
): { ok: true; value: string | null } | { ok: false } {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) return { ok: true, value: null };
  const safe = safeManualImagePath(trimmed);
  if (!safe) return { ok: false };
  return { ok: true, value: safe };
}

/** Path for the server proxy that resolves one Legacy Place photo by restaurant id. */
export function restaurantImageProxyUrl(restaurantId: string): string {
  return `/api/restaurant-image/${restaurantId}`;
}

/**
 * Card image choice. A safe /images path is used directly. A place id uses the
 * proxy. Stored absolute URLs, including key-bearing and rehosted photos, are ignored.
 */
export function restaurantDisplayImageUrl(row: RestaurantImageFields): string {
  const manual = safeManualImagePath(row.image_url);
  if (manual) return manual;
  if (row.id && row.google_place_id?.trim()) {
    return restaurantImageProxyUrl(row.id);
  }
  return RESTAURANT_IMAGE_PLACEHOLDER;
}
