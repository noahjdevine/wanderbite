import { haversineMiles, toGeoPoint } from '@/lib/launch-market';
import { ACTIVITY_NEARBY_CAP_MILES, chicagoCalendarDate } from '@/lib/activities/match';
import {
  ACTIVITY_NOTE_WALKABLE_MILES,
  activityDisplayName,
  activityNoteWalkable,
  DOWNTOWN_WANDER_DEDUP_GROUP,
  downtownWanderAbout,
  downtownWanderKind,
  isEscapeRoomActivity,
  isHistoricDowntownNeighborhood,
  type NotePromptActivity,
} from '@/lib/activities/note-copy';
import {
  ACTIVITY_STALE_AFTER_MS,
  isActivityCategory,
  isActivityCost,
} from '@/lib/activities/types';

/** Varied set size. Real outings fill every seat that is not held for dessert. */
export const ACTIVITY_NOTE_CANDIDATE_CAP = 12;

/** Dessert can be the right next stop after a light meal, and it cannot crowd out the set. */
export const ACTIVITY_NOTE_DESSERT_CAP = 2;

/** Default uses of one activity in one notes run, including kept draft and approved notes. */
export const ACTIVITY_NOTE_MAX_USES_PER_ACTIVITY = 5;

/** Default escape-room citations in one notes run. A card still lists at most one. */
export const ACTIVITY_NOTE_MAX_ESCAPE_ROOM_USES = 6;

export const ACTIVITY_NOTE_MAX_USES_ENV = 'WANDERBITE_ACTIVITY_NOTES_MAX_USES_PER_ACTIVITY';
export const ACTIVITY_NOTE_MAX_ESCAPE_ROOM_USES_ENV = 'WANDERBITE_ACTIVITY_NOTES_MAX_ESCAPE_ROOM_USES';

const DESSERT_CATEGORY = 'dessert';

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
  /** restaurants.neighborhood. Historic Downtown McKinney changes downtown-wander distance. */
  neighborhood?: string | null;
};

export type ActivityNoteUseCaps = {
  maxUsesPerActivity: number;
  maxEscapeRoomUses: number;
};

type RankedNoteActivity = {
  activity: NotePromptActivity;
  miles: number;
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

function roundMiles(miles: number): number {
  return Math.round(miles * 10) / 10;
}

function compareCandidates(left: RankedNoteActivity, right: RankedNoteActivity): number {
  if (left.miles !== right.miles) return left.miles - right.miles;
  const name = left.activity.name.localeCompare(right.activity.name);
  if (name !== 0) return name;
  return left.activity.id.localeCompare(right.activity.id);
}

/**
 * Band 0 is every walkable distance, so those outings are equally walkable.
 * Later bands are half-mile slices, so nearby driving distances stay ahead of
 * a far unused place. Inside a band, fewer uses this run win. Equal uses stay
 * on distance, then name, then id, so a given use map has one order.
 */
export function activityNoteSpreadBand(miles: number): number {
  if (miles <= ACTIVITY_NOTE_WALKABLE_MILES) return 0;
  return Math.ceil(miles / ACTIVITY_NOTE_WALKABLE_MILES) - 1;
}

function spreadCompare(uses: ReadonlyMap<string, number>) {
  return (left: RankedNoteActivity, right: RankedNoteActivity): number => {
    const band = activityNoteSpreadBand(left.miles) - activityNoteSpreadBand(right.miles);
    if (band !== 0) return band;
    const leftUses = uses.get(left.activity.id) ?? 0;
    const rightUses = uses.get(right.activity.id) ?? 0;
    if (leftUses !== rightUses) return leftUses - rightUses;
    return compareCandidates(left, right);
  };
}

function readUseCap(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback;
  if (!/^\d+$/.test(raw.trim())) return fallback;
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) ? value : fallback;
}

export function activityNoteUseCaps(
  env: Record<string, string | undefined> = {},
): ActivityNoteUseCaps {
  return {
    maxUsesPerActivity: readUseCap(env[ACTIVITY_NOTE_MAX_USES_ENV], ACTIVITY_NOTE_MAX_USES_PER_ACTIVITY),
    maxEscapeRoomUses: readUseCap(env[ACTIVITY_NOTE_MAX_ESCAPE_ROOM_USES_ENV], ACTIVITY_NOTE_MAX_ESCAPE_ROOM_USES),
  };
}

function keepBest(
  rows: readonly RankedNoteActivity[],
  matches: (row: RankedNoteActivity) => boolean,
  compare: (left: RankedNoteActivity, right: RankedNoteActivity) => number,
): RankedNoteActivity[] {
  const group = rows.filter(matches);
  if (group.length <= 1) return [...rows];
  const best = [...group].sort(compare)[0];
  if (!best) return [...rows];
  return rows.filter((row) => !matches(row) || row.activity.id === best.activity.id);
}

/**
 * One place from each category per pass, in spread order, when the cap stops
 * a pass early. Later passes fill from the categories that remain.
 */
function pickDiverse(
  rows: readonly RankedNoteActivity[],
  limit: number,
  compare: (left: RankedNoteActivity, right: RankedNoteActivity) => number,
): RankedNoteActivity[] {
  const buckets = new Map<string, RankedNoteActivity[]>();
  for (const row of [...rows].sort(compare)) {
    const list = buckets.get(row.activity.category);
    if (list) list.push(row);
    else buckets.set(row.activity.category, [row]);
  }
  const selected: RankedNoteActivity[] = [];
  while (selected.length < limit) {
    const next = [...buckets.values()]
      .filter((list) => list.length > 0)
      .sort((left, right) => compare(left[0]!, right[0]!));
    if (next.length === 0) break;
    for (const list of next) {
      if (selected.length >= limit) break;
      const row = list.shift();
      if (row) selected.push(row);
    }
  }
  return selected;
}

function presentToModel(
  rows: readonly RankedNoteActivity[],
  compareOutings: (left: RankedNoteActivity, right: RankedNoteActivity) => number,
): NotePromptActivity[] {
  const desserts = rows
    .filter((row) => row.activity.category === DESSERT_CATEGORY)
    .sort(compareCandidates);
  const outings = rows
    .filter((row) => row.activity.category !== DESSERT_CATEGORY)
    .sort(compareOutings);
  return [...outings, ...desserts].map((row) => row.activity);
}

/**
 * Currently showing, non-kids activities within 5 miles.
 * Coordinate distance only. A Wanderbite restaurant name is not an outing.
 * The set prefers a spread of real outings and keeps at most two dessert shops.
 * Uses at the cap are left out before the spread. Escape rooms stop at the type
 * cap, and a card lists at most one. Tiny Doors and the historic tour share one seat.
 */
export function eligibleNoteActivities(args: {
  restaurant: NoteSourceRestaurant;
  activities: readonly NoteSourceActivity[];
  restaurantNames: readonly string[];
  now: Date;
  /** Citations already counted for this run. The caller omits this restaurant's own kept note. */
  activityUses?: ReadonlyMap<string, number>;
  /** Escape-room citations already counted. Separate from the per-activity cap. */
  escapeRoomUses?: number;
  maxUsesPerActivity?: number;
  maxEscapeRoomUses?: number;
}): NotePromptActivity[] {
  const origin = toGeoPoint(args.restaurant.lat, args.restaurant.lon);
  if (!origin) return [];
  const today = chicagoCalendarDate(args.now);
  const blocked = new Set(args.restaurantNames.map(normalizeName).filter(Boolean));
  const uses = args.activityUses ?? new Map<string, number>();
  const escapeRoomUses = args.escapeRoomUses ?? 0;
  const maxUses = args.maxUsesPerActivity ?? ACTIVITY_NOTE_MAX_USES_PER_ACTIVITY;
  const maxEscapeRooms = args.maxEscapeRoomUses ?? ACTIVITY_NOTE_MAX_ESCAPE_ROOM_USES;
  const inDowntown = isHistoricDowntownNeighborhood(args.restaurant.neighborhood);
  const ranked: RankedNoteActivity[] = [];
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
    const name = activity.name.trim();
    const escapeRoom = isEscapeRoomActivity(name);
    if ((uses.get(activity.id) ?? 0) >= maxUses) continue;
    if (escapeRoom && escapeRoomUses >= maxEscapeRooms) continue;
    const wander = downtownWanderKind(name);
    const areaWander = wander != null && inDowntown;
    ranked.push({
      activity: {
        id: activity.id,
        name,
        displayName: activityDisplayName(name),
        category: activity.category,
        miles: roundMiles(miles),
        walkable: activityNoteWalkable({ name, neighborhood: args.restaurant.neighborhood, miles }),
        ...(wander
          ? {
              area: areaWander ? 'downtown_wander' as const : 'downtown_drive' as const,
              about: downtownWanderAbout(wander, inDowntown),
              areaWander,
              dedupGroup: DOWNTOWN_WANDER_DEDUP_GROUP,
            }
          : {}),
        ...(escapeRoom ? { escapeRoom: true } : {}),
      },
      miles,
    });
  }
  const compareOutings = spreadCompare(uses);
  const varied = keepBest(
    keepBest(ranked, (row) => row.activity.dedupGroup === DOWNTOWN_WANDER_DEDUP_GROUP, compareOutings),
    (row) => row.activity.escapeRoom === true,
    compareOutings,
  );
  const desserts = varied.filter((row) => row.activity.category === DESSERT_CATEGORY);
  const outings = varied.filter((row) => row.activity.category !== DESSERT_CATEGORY);
  const dessertBudget = Math.min(ACTIVITY_NOTE_DESSERT_CAP, desserts.length);
  const chosenOutings = pickDiverse(outings, ACTIVITY_NOTE_CANDIDATE_CAP - dessertBudget, compareOutings);
  const dessertRoom = Math.min(
    ACTIVITY_NOTE_DESSERT_CAP,
    Math.max(0, ACTIVITY_NOTE_CANDIDATE_CAP - chosenOutings.length),
  );
  const chosenDesserts = [...desserts].sort(compareCandidates).slice(0, dessertRoom);
  return presentToModel([...chosenOutings, ...chosenDesserts], compareOutings);
}
