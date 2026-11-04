/** Fixed E06 catalog. Museums, walks, classes, sports, and arts. */
export const ACTIVITY_CATEGORIES = ['museum', 'walk', 'class', 'sports', 'arts'] as const;
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

export const ACTIVITY_COST_CATEGORIES = ['free', '$', '$$', '$$$', 'unknown'] as const;
export type ActivityCostCategory = (typeof ACTIVITY_COST_CATEGORIES)[number];

export const ACTIVITY_STATUSES = ['active', 'paused', 'expired'] as const;

/** Drop a row whose last_verified_at is older than this. */
export const ACTIVITY_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export const ACTIVITY_MATCH_LIMIT = 2;

/** Profile default when a member has no saved distance band. */
export const ACTIVITY_DEFAULT_BOUND_MILES = 15;

export const NEARBY_IDEA_HEADING = 'Optional nearby idea';

export const OPTIONAL_ACTIVITY_LABEL =
  'Optional suggestion. Independently operated. Admission or booking may cost extra.';

export const CHECK_HOURS_LABEL = 'Check hours on their site';

export const SAMPLE_BADGE_LABEL = 'Sample';

/**
 * Other launch ZIPs. This is a static list, not a drive time and not a
 * ZIP-centroid distance.
 */
export const LAUNCH_ADJACENT_ZIPS: Readonly<Record<string, readonly string[]>> = {
  '75069': ['75070', '75071', '75072'],
  '75070': ['75069', '75071', '75072'],
  '75071': ['75069', '75070', '75072'],
  '75072': ['75069', '75070', '75071'],
};

const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  museum: 'Museum',
  walk: 'Walk',
  class: 'Class',
  sports: 'Sports',
  arts: 'Arts',
};

const COST_LABELS: Record<ActivityCostCategory, string> = {
  free: 'Free',
  $: '$',
  $$: '$$',
  $$$: '$$$',
  unknown: 'Cost unknown',
};

export type ActivityRecord = {
  id: string;
  name: string;
  category: string;
  source_url: string | null;
  lat: number | null;
  lon: number | null;
  zip: string | null;
  typical_duration_minutes: number | null;
  cost_category: string;
  hours_note: string | null;
  valid_from: string | null;
  valid_until: string | null;
  weather_dependent: boolean;
  booking_required: boolean;
  last_verified_at: string | null;
  status: string;
  is_sample: boolean;
  version: number;
};

export type ActivityRestaurant = {
  id: string;
  lat: number | null;
  lon: number | null;
  address: string | null;
};

export type ActivityLocationMethod = 'coordinates' | 'zip';

export type ActivitySuggestions = {
  byRestaurantId: Record<string, ActivitySuggestion[]>;
};

export type ActivitySuggestion = {
  id: string;
  name: string;
  categoryLabel: string;
  durationLabel: string | null;
  costLabel: string;
  hoursLabel: string;
  hoursKnown: boolean;
  sourceUrl: string;
  sampleLabel: string | null;
  weatherLabel: string | null;
  bookingLabel: string | null;
  locationMethod: ActivityLocationMethod;
};

export function isActivityCategory(value: string): value is ActivityCategory {
  return (ACTIVITY_CATEGORIES as readonly string[]).includes(value);
}

export function isActivityCost(value: string): value is ActivityCostCategory {
  return (ACTIVITY_COST_CATEGORIES as readonly string[]).includes(value);
}

export function categoryLabel(category: ActivityCategory): string {
  return CATEGORY_LABELS[category];
}

export function costLabel(cost: ActivityCostCategory): string {
  return COST_LABELS[cost];
}

/** Sample rows always show the badge. Non-production shows it on every suggestion. */
export function sampleLabelFor(isSample: boolean, nodeEnv: string | undefined): string | null {
  if (isSample || nodeEnv !== 'production') return SAMPLE_BADGE_LABEL;
  return null;
}

export function hoursPresentation(hoursNote: string | null): {
  hoursLabel: string;
  hoursKnown: boolean;
} {
  const note = hoursNote?.trim() ?? '';
  if (!note) return { hoursLabel: CHECK_HOURS_LABEL, hoursKnown: false };
  return { hoursLabel: note, hoursKnown: true };
}

export function durationLabel(minutes: number | null): string | null {
  if (minutes == null || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return null;
  return `Typical duration: ${minutes} min`;
}
