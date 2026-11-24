import { haversineMiles, toGeoPoint } from '@/lib/launch-market';
import { ACTIVITY_NEARBY_CAP_MILES, chicagoCalendarDate } from '@/lib/activities/match';
import {
  ACTIVITY_STALE_AFTER_MS,
  isActivityCategory,
  isActivityCost,
} from '@/lib/activities/types';
import type { NotePromptActivity } from '@/lib/activities/note-copy';

export const ACTIVITY_NOTE_CANDIDATE_CAP = 6;

export type NoteSourceActivity = {
  id: string;
  name: string;
  category: string;
  source_url: string | null;
  lat: number | null;
  lon: number | null;
  valid_from: string | null;
  valid_until: string | null;
  last_verified_at: string | null;
  status: string;
  is_sample: boolean;
  kids_oriented: boolean;
  cost_category: string;
};

export type NoteSourceRestaurant = {
  id: string;
  name: string;
  cuisineTags: readonly string[];
  lat: number | null;
  lon: number | null;
};

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function officialUrl(sourceUrl: string | null): boolean {
  if (!sourceUrl) return false;
  return /^https:\/\/\S+$/.test(sourceUrl.trim());
}

function freshEnough(lastVerifiedAt: string | null, now: Date): boolean {
  if (!lastVerifiedAt) return false;
  const verified = new Date(lastVerifiedAt);
  if (Number.isNaN(verified.getTime())) return false;
  return now.getTime() - verified.getTime() <= ACTIVITY_STALE_AFTER_MS;
}

function calendarCurrent(activity: NoteSourceActivity, today: string): boolean {
  if (!today) return false;
  if (activity.valid_from && activity.valid_from > today) return false;
  if (activity.valid_until && activity.valid_until < today) return false;
  return true;
}

/**
 * Currently showing, non-kids activities within 5 miles.
 * Coordinate distance only. A Wanderbite restaurant name is not an outing.
 */
export function eligibleNoteActivities(args: {
  restaurant: NoteSourceRestaurant;
  activities: readonly NoteSourceActivity[];
  restaurantNames: readonly string[];
  now: Date;
}): NotePromptActivity[] {
  const origin = toGeoPoint(args.restaurant.lat, args.restaurant.lon);
  if (!origin) return [];
  const today = chicagoCalendarDate(args.now);
  const blocked = new Set(args.restaurantNames.map(normalizeName).filter(Boolean));
  const ranked: { activity: NotePromptActivity; miles: number }[] = [];
  for (const activity of args.activities) {
    if (activity.kids_oriented) continue;
    if (activity.status !== 'active' || activity.is_sample) continue;
    if (!isActivityCategory(activity.category) || !isActivityCost(activity.cost_category)) continue;
    if (!calendarCurrent(activity, today) || !officialUrl(activity.source_url)) continue;
    if (!freshEnough(activity.last_verified_at, args.now)) continue;
    if (blocked.has(normalizeName(activity.name))) continue;
    const point = toGeoPoint(activity.lat, activity.lon);
    if (!point) continue;
    const miles = haversineMiles(origin, point);
    if (miles > ACTIVITY_NEARBY_CAP_MILES) continue;
    ranked.push({
      activity: {
        id: activity.id,
        name: activity.name.trim(),
        category: activity.category,
      },
      miles,
    });
  }
  ranked.sort((left, right) => {
    if (left.miles !== right.miles) return left.miles - right.miles;
    const name = left.activity.name.localeCompare(right.activity.name);
    if (name !== 0) return name;
    return left.activity.id.localeCompare(right.activity.id);
  });
  return ranked.slice(0, ACTIVITY_NOTE_CANDIDATE_CAP).map((row) => row.activity);
}
