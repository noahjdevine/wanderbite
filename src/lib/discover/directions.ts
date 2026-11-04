import type { PartnerDirections } from '@/lib/discover/events';
import { LAUNCH_MARKET } from '@/lib/launch-market';

const MAPS_HOSTS = new Set(['google.com', 'www.google.com', 'maps.google.com']);

/** https Google Maps search URL. Same string the roulette page builds for Get Directions. */
export function googleMapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * Restaurant name plus the launch-market city query.
 * Returns null only when the name is empty, matching the roulette page's `#` fallback.
 */
export function discoverMapsSearchUrl(restaurantName: string, cityQuery: string): string | null {
  if (restaurantName.length === 0) return null;
  return googleMapsSearchUrl(`${restaurantName} ${cityQuery}`);
}

/** Accepts only https URLs on Google Maps hosts. A bad value does not throw. */
export function httpsGoogleMapsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' || !MAPS_HOSTS.has(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Optional directions for a streamed partner.
 * `mapsUrl` uses the restaurant name and `LAUNCH_MARKET.cityQuery`.
 * `address` is included only when `restaurants.address` is non-blank.
 */
export function partnerDirections(args: {
  name: string;
  address?: string | null;
}): PartnerDirections | undefined {
  const address = typeof args.address === 'string' ? args.address.trim() : '';
  const mapsUrl = discoverMapsSearchUrl(args.name, LAUNCH_MARKET.cityQuery) ?? undefined;
  if (!address && !mapsUrl) return undefined;
  return {
    ...(address ? { address } : {}),
    ...(mapsUrl ? { mapsUrl } : {}),
  };
}
