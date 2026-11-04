import { pluralNoun } from '@/lib/format/text';
import { countDistinctNeighborhoods, distinctNeighborhoods } from '@/lib/progress/neighborhoods';
import { stampKind } from '@/lib/passport/passport-board';
import type { VisitStatus } from '@/lib/visits/visit-status';

/**
 * America/Chicago calendar day as `yyyy-mm-dd`.
 * `formatToParts` plus an explicit time zone, so the process TZ cannot move it.
 */
const chicagoCalendar = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export type PassportMapVisit = {
  id: string;
  verifiedAt: string;
  visitStatus: VisitStatus;
  restaurant: {
    name: string;
    lat: number | null;
    lon: number | null;
    cuisine_tags?: string[] | null;
    neighborhood?: string | null;
  };
};

export type MapPoint = {
  id: string;
  name: string;
  longitude: number;
  latitude: number;
  neighborhood: string | null;
  cuisineTags: string[] | null;
  verifiedAt: string;
  visitStatus: VisitStatus;
};

export type RouteLine = {
  type: 'Feature';
  properties: Record<string, never>;
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
};

export function chicagoCalendarKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = chicagoCalendar.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

export function hasMapCoordinates(
  lat: number | null | undefined,
  lon: number | null | undefined,
): boolean {
  if (lat == null || lon == null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
  return true;
}

function compareChicago(a: PassportMapVisit, b: PassportMapVisit): number {
  const aKey = chicagoCalendarKey(a.verifiedAt) ?? '';
  const bKey = chicagoCalendarKey(b.verifiedAt) ?? '';
  if (aKey !== bKey) return aKey < bKey ? -1 : 1;
  const aMs = new Date(a.verifiedAt).getTime();
  const bMs = new Date(b.verifiedAt).getTime();
  const aTime = Number.isNaN(aMs) ? 0 : aMs;
  const bTime = Number.isNaN(bMs) ? 0 : bMs;
  if (aTime !== bTime) return aTime - bTime;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

function isOnMap(visit: PassportMapVisit): boolean {
  return stampKind(visit.visitStatus) === 'stamp' && hasMapCoordinates(visit.restaurant.lat, visit.restaurant.lon);
}

/** Stamp-worthy visits with coordinates, oldest Chicago day first. */
export function routeStops<T extends PassportMapVisit>(visits: readonly T[]): T[] {
  return visits.filter((visit) => isOnMap(visit)).slice().sort(compareChicago);
}

/** Stamp-worthy visits that cannot be pinned. Pending and expired codes are omitted. */
export function visitsNotOnMap<T extends PassportMapVisit>(visits: readonly T[]): T[] {
  return visits
    .filter(
      (visit) =>
        stampKind(visit.visitStatus) === 'stamp' &&
        !hasMapCoordinates(visit.restaurant.lat, visit.restaurant.lon),
    )
    .slice()
    .sort(compareChicago);
}

export function mapPoints(visits: readonly PassportMapVisit[]): MapPoint[] {
  return routeStops(visits).map((visit) => ({
    id: visit.id,
    name: visit.restaurant.name,
    longitude: Number(visit.restaurant.lon),
    latitude: Number(visit.restaurant.lat),
    neighborhood: visit.restaurant.neighborhood?.trim() || null,
    cuisineTags: visit.restaurant.cuisine_tags ?? null,
    verifiedAt: visit.verifiedAt,
    visitStatus: visit.visitStatus,
  }));
}

/**
 * Neighborhoods explored on stamp-worthy visits, including visits with no coordinates.
 * Same trim and uniqueness rules as `countDistinctNeighborhoods`.
 */
export function exploredNeighborhoodNames(visits: readonly PassportMapVisit[]): string[] {
  return distinctNeighborhoods(
    visits
      .filter((visit) => stampKind(visit.visitStatus) === 'stamp')
      .map((visit) => visit.restaurant.neighborhood),
  );
}

/** Pins whose neighborhood counts under the shared neighborhood definition. */
export function neighborhoodGlowPoints(points: readonly MapPoint[]): MapPoint[] {
  const names = new Set(distinctNeighborhoods(points.map((point) => point.neighborhood)));
  return points.filter((point) => {
    const name = point.neighborhood?.trim();
    return Boolean(name && names.has(name));
  });
}

export function routeLine(points: readonly { longitude: number; latitude: number }[]): RouteLine | null {
  if (points.length < 2) return null;
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: points.map((point) => [point.longitude, point.latitude]),
    },
  };
}

export function boundsFromPoints(
  points: readonly { longitude: number; latitude: number }[],
): [[number, number], [number, number]] | null {
  const first = points[0];
  if (!first) return null;
  let minLng = first.longitude;
  let maxLng = first.longitude;
  let minLat = first.latitude;
  let maxLat = first.latitude;
  for (const point of points) {
    minLng = Math.min(minLng, point.longitude);
    maxLng = Math.max(maxLng, point.longitude);
    minLat = Math.min(minLat, point.latitude);
    maxLat = Math.max(maxLat, point.latitude);
  }
  if (minLng === maxLng && minLat === maxLat) {
    const pad = 0.025;
    return [
      [minLng - pad, minLat - pad],
      [maxLng + pad, maxLat + pad],
    ];
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

type PartnerSetVisit = {
  visitStatus: VisitStatus;
  restaurant: { id: string; neighborhood?: string | null };
};

/**
 * Neighborhoods on stamp-worthy visits whose restaurant is in the partner set.
 * That set is the active launch-market restaurants counted as M.
 * A paused or other-market visit does not add its neighborhood.
 * `getMemberProgress` keeps its own neighborhoods number.
 */
export function exploredNeighborhoodsInPartnerSet(
  visits: readonly PartnerSetVisit[],
  partnerRestaurantIds: readonly string[],
): number {
  const ids = new Set(partnerRestaurantIds);
  return countDistinctNeighborhoods(
    visits
      .filter(
        (visit) => stampKind(visit.visitStatus) === 'stamp' && ids.has(visit.restaurant.id),
      )
      .map((visit) => visit.restaurant.neighborhood),
  );
}

/**
 * `explored` is `exploredNeighborhoodsInPartnerSet`.
 * `partnerNeighborhoods` is the distinct neighborhood set on active launch-market restaurants.
 * A null on either side means that read did not load, so the line is omitted.
 * The shown count is clamped so the line cannot read N greater than M.
 */
export function neighborhoodCounterLabel(
  explored: number | null,
  partnerNeighborhoods: number | null,
  city: string,
): string | null {
  if (explored == null || partnerNeighborhoods == null) return null;
  const partner = Math.max(0, partnerNeighborhoods);
  const shown = Math.min(Math.max(0, explored), partner);
  return `${shown} of ${partner} ${city} ${pluralNoun(partner, 'neighborhood')} explored`;
}
