import {
  haversineMiles,
  milesForDistanceBand,
  parseDistanceBand,
  toGeoPoint,
} from '@/lib/launch-market';
import {
  ACTIVITY_DEFAULT_BOUND_MILES,
  ACTIVITY_MATCH_LIMIT,
  ACTIVITY_STALE_AFTER_MS,
  LAUNCH_ADJACENT_ZIPS,
  categoryLabel,
  costLabel,
  durationLabel,
  hoursPresentation,
  isActivityCategory,
  isActivityCost,
  sampleLabelFor,
  type ActivityLocationMethod,
  type ActivityRecord,
  type ActivityRestaurant,
  type ActivitySuggestion,
} from '@/lib/activities/types';

const chicagoDateFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** America/Chicago calendar date as YYYY-MM-DD. Independent of process TZ. */
export function chicagoCalendarDate(now: Date): string {
  const parts = chicagoDateFormat.formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) return '';
  return `${year}-${month}-${day}`;
}

/** Calendar-day shift on a YYYY-MM-DD string. Does not use the process time zone. */
export function shiftCalendarDate(isoDate: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

/**
 * Last 5-digit ZIP in a restaurant address. Same rule as `zipFromAddress`
 * in the catalog importer. Restaurants have no zip column.
 */
export function restaurantZip(address: string | null | undefined): string | null {
  if (!address) return null;
  const matches = address.match(/\b\d{5}(?:-\d{4})?\b/g);
  if (!matches || matches.length === 0) return null;
  return matches[matches.length - 1]?.slice(0, 5) ?? null;
}

function activityZip(zip: string | null): string | null {
  if (!zip) return null;
  const match = /^(\d{5})(?:-\d{4})?$/.exec(zip.trim());
  return match?.[1] ?? null;
}

export function activityBoundMiles(distanceBand: string | null | undefined): number {
  const band = parseDistanceBand(distanceBand);
  if (!band) return ACTIVITY_DEFAULT_BOUND_MILES;
  return milesForDistanceBand(band);
}

function officialUrl(sourceUrl: string | null): string | null {
  if (!sourceUrl) return null;
  const trimmed = sourceUrl.trim();
  if (!/^https:\/\/\S+$/.test(trimmed)) return null;
  return trimmed;
}

function freshEnough(lastVerifiedAt: string | null, now: Date): boolean {
  if (!lastVerifiedAt) return false;
  const verified = new Date(lastVerifiedAt);
  if (Number.isNaN(verified.getTime())) return false;
  return now.getTime() - verified.getTime() <= ACTIVITY_STALE_AFTER_MS;
}

function calendarCurrent(activity: ActivityRecord, today: string): boolean {
  if (!today) return false;
  if (activity.valid_from && activity.valid_from > today) return false;
  if (activity.valid_until && activity.valid_until < today) return false;
  return true;
}

type Ranked = {
  suggestion: ActivitySuggestion;
  method: ActivityLocationMethod;
  distanceMiles: number | null;
  zipRank: number;
  name: string;
  id: string;
};

function zipRank(restaurantZipCode: string, activityZipCode: string): number | null {
  if (restaurantZipCode === activityZipCode) return 0;
  const adjacent = LAUNCH_ADJACENT_ZIPS[restaurantZipCode] ?? [];
  if (adjacent.includes(activityZipCode)) return 1;
  return null;
}

function toSuggestion(
  activity: ActivityRecord,
  method: ActivityLocationMethod,
  nodeEnv: string | undefined,
): ActivitySuggestion {
  const hours = hoursPresentation(activity.hours_note);
  const category = isActivityCategory(activity.category) ? activity.category : 'arts';
  const cost = isActivityCost(activity.cost_category) ? activity.cost_category : 'unknown';
  return {
    id: activity.id,
    name: activity.name.trim(),
    categoryLabel: categoryLabel(category),
    durationLabel: durationLabel(activity.typical_duration_minutes),
    costLabel: costLabel(cost),
    hoursLabel: hours.hoursLabel,
    hoursKnown: hours.hoursKnown,
    sourceUrl: officialUrl(activity.source_url) ?? '',
    sampleLabel: sampleLabelFor(activity.is_sample, nodeEnv),
    weatherLabel: activity.weather_dependent ? 'Weather dependent' : null,
    bookingLabel: activity.booking_required ? 'Booking required' : null,
    locationMethod: method,
  };
}

/**
 * Up to two activities for one restaurant.
 * Coordinates are used only when both sides have them, and only against the
 * member's saved distance band (or 15 miles when that band is missing).
 * Otherwise the match is same ZIP or an adjacent launch ZIP. That path is
 * not a driving time.
 * Unknown hours stay in the result with a check-hours line. A missing
 * official URL or a stale last_verified_at drops the row.
 */
export function matchActivities(args: {
  restaurant: ActivityRestaurant;
  activities: readonly ActivityRecord[];
  distanceBand: string | null;
  now: Date;
  nodeEnv?: string;
}): ActivitySuggestion[] {
  const today = chicagoCalendarDate(args.now);
  const origin = toGeoPoint(args.restaurant.lat, args.restaurant.lon);
  const bound = activityBoundMiles(args.distanceBand);
  const placeZip = restaurantZip(args.restaurant.address);
  const ranked: Ranked[] = [];

  for (const activity of args.activities) {
    if (activity.status !== 'active') continue;
    if (!isActivityCategory(activity.category) || !isActivityCost(activity.cost_category)) continue;
    if (!calendarCurrent(activity, today)) continue;
    if (!officialUrl(activity.source_url)) continue;
    if (!freshEnough(activity.last_verified_at, args.now)) continue;

    const point = toGeoPoint(activity.lat, activity.lon);
    let method: ActivityLocationMethod | null = null;
    let distanceMiles: number | null = null;
    let rank: number | null = null;

    if (origin && point) {
      const miles = haversineMiles(origin, point);
      if (miles <= bound) {
        method = 'coordinates';
        distanceMiles = miles;
        rank = 0;
      }
    } else if (placeZip) {
      const code = activityZip(activity.zip);
      if (code) {
        const zip = zipRank(placeZip, code);
        if (zip != null) {
          method = 'zip';
          rank = zip;
        }
      }
    }

    if (!method || rank == null) continue;
    ranked.push({
      suggestion: toSuggestion(activity, method, args.nodeEnv),
      method,
      distanceMiles,
      zipRank: rank,
      name: activity.name,
      id: activity.id,
    });
  }

  ranked.sort((left, right) => {
    const methodOrder = Number(left.method === 'zip') - Number(right.method === 'zip');
    if (methodOrder !== 0) return methodOrder;
    if (left.method === 'coordinates' && right.method === 'coordinates') {
      const distance = (left.distanceMiles ?? 0) - (right.distanceMiles ?? 0);
      if (distance !== 0) return distance;
    } else if (left.zipRank !== right.zipRank) {
      return left.zipRank - right.zipRank;
    }
    const name = left.name.localeCompare(right.name);
    if (name !== 0) return name;
    return left.id.localeCompare(right.id);
  });

  return ranked.slice(0, ACTIVITY_MATCH_LIMIT).map((row) => row.suggestion);
}

export function matchActivitiesForRestaurants(args: {
  restaurants: readonly ActivityRestaurant[];
  activities: readonly ActivityRecord[];
  distanceBand: string | null;
  now: Date;
  nodeEnv?: string;
}): Record<string, ActivitySuggestion[]> {
  const byRestaurantId: Record<string, ActivitySuggestion[]> = {};
  for (const restaurant of args.restaurants) {
    const matches = matchActivities({
      restaurant,
      activities: args.activities,
      distanceBand: args.distanceBand,
      now: args.now,
      nodeEnv: args.nodeEnv,
    });
    if (matches.length > 0) byRestaurantId[restaurant.id] = matches;
  }
  return byRestaurantId;
}
