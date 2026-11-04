import 'server-only';

import { createClient } from '@/lib/supabase/server';
import {
  activitiesEnabled,
  activitySchemaMissing,
  logActivitiesReadFailedOnce,
  logActivitiesUnavailableOnce,
} from '@/lib/activities/flag';
import { matchActivitiesForRestaurants } from '@/lib/activities/match';
import type {
  ActivityRecord,
  ActivityRestaurant,
  ActivitySuggestions,
} from '@/lib/activities/types';

export const ACTIVITY_COLUMNS =
  'id, name, category, source_url, lat, lon, zip, typical_duration_minutes, cost_category, hours_note, valid_from, valid_until, weather_dependent, booking_required, last_verified_at, status, is_sample, version';

const EMPTY: ActivitySuggestions = { byRestaurantId: {} };

function isActivityRecord(value: ActivityRecord): boolean {
  return typeof value.id === 'string' && typeof value.name === 'string';
}

/**
 * Flag off returns immediately and does not query. A missing table also
 * returns nothing so the challenge page still renders before the migration
 * is applied. This function does not write credits, offers, or visits.
 */
export async function loadActivitySuggestions(args: {
  restaurants: readonly ActivityRestaurant[];
  distanceBand: string | null;
  now?: Date;
}): Promise<ActivitySuggestions> {
  if (!activitiesEnabled()) return EMPTY;
  if (args.restaurants.length === 0) return EMPTY;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('activities')
    .select(ACTIVITY_COLUMNS)
    .eq('status', 'active');
  if (error) {
    if (activitySchemaMissing(error)) logActivitiesUnavailableOnce();
    else logActivitiesReadFailedOnce();
    return EMPTY;
  }
  const activities = (data ?? []).filter(isActivityRecord);
  return {
    byRestaurantId: matchActivitiesForRestaurants({
      restaurants: args.restaurants,
      activities,
      distanceBand: args.distanceBand,
      now: args.now ?? new Date(),
      nodeEnv: process.env.NODE_ENV,
    }),
  };
}
