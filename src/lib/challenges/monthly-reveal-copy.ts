import { cuisineLabel, normalizeCuisineIds } from '@/lib/cuisines';

export const REVEAL_SUMMARY_CAP = 280;
export const REVEAL_LABEL_CAP = 80;

export const MONTHLY_REVEAL_FOCUS_KEY = 'wb-monthly-reveal-focus';

export const REVEAL_TRY_AGAIN = 'Could not reveal your challenges. Please try again.';

export const SWAPPED_SLOT_REASON = 'Swapped in this month.';

export const OCCASION_CHIPS = ['Weeknight', 'Date night', 'Celebration', 'Casual'] as const;

export const DISCOVERY_CHIPS = ['Familiar', 'Something new', 'Adventurous'] as const;

const TRY_AGAIN_REASONS = new Set([
  'capacity_full',
  'invalid_restaurants',
  'incomplete_cycle',
  'retryable',
  'below_floor',
  'assignment_failed',
]);

const DIETARY_LABELS: Record<string, string> = {
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  gluten_free: 'Gluten-Free',
  halal: 'Halal',
  kosher: 'Kosher',
  dairy_free: 'Dairy-Free',
  pescatarian: 'Pescatarian',
};

const DISTANCE_LABELS: Record<string, string> = {
  '5_mi': '5 miles',
  '15_mi': '15 miles',
  '25_mi': '25 miles',
  '40_mi': '40 miles',
};

export type SlotReason = {
  restaurantId: string;
  text: string;
};

export type MonthlyRevealPanel =
  | { mode: 'off' }
  | { mode: 'curation'; constraintLines: string[] }
  | { mode: 'revealed'; reasons: SlotReason[] };

/** Saved reason only when this slot still has that restaurant. */
export function reasonForSlot(
  reasons: readonly SlotReason[] | null | undefined,
  restaurantId: string,
): string | null {
  if (!reasons || reasons.length === 0) return null;
  const match = reasons.find((reason) => reason.restaurantId === restaurantId);
  return match ? match.text : SWAPPED_SLOT_REASON;
}

export function reasonsFromRevealJson(value: unknown): SlotReason[] | null {
  if (!Array.isArray(value)) return null;
  const reasons: SlotReason[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const restaurantId = 'restaurant_id' in entry ? entry.restaurant_id : null;
    const text = 'text' in entry ? entry.text : null;
    if (typeof restaurantId !== 'string' || typeof text !== 'string') return null;
    reasons.push({ restaurantId, text });
  }
  return reasons;
}

export function revealMemberMessage(result: { error: string; reason: string }): string {
  if (result.reason === 'thin_pool') return result.error;
  if (TRY_AGAIN_REASONS.has(result.reason)) return REVEAL_TRY_AGAIN;
  return result.error;
}

export function appendRevealTranscript(current: string, transcript: string): string {
  const addition = transcript.trim();
  if (!addition) return current.slice(0, REVEAL_SUMMARY_CAP);
  const base = current.trim();
  const next = base ? `${base} ${addition}` : addition;
  return next.slice(0, REVEAL_SUMMARY_CAP);
}

function labeledList(flags: readonly string[] | null | undefined, labels: Record<string, string>): string {
  const items = (flags ?? []).map((flag) => labels[flag] ?? flag).filter((flag) => flag.length > 0);
  return items.length > 0 ? items.join(', ') : 'none saved';
}

export function curationConstraintLines(args: {
  distanceBand: string | null;
  dietaryFlags: readonly string[] | null;
  allergyFlags: readonly string[] | null;
  excludedCuisines: readonly string[] | null;
}): string[] {
  const miles = args.distanceBand ? DISTANCE_LABELS[args.distanceBand] : null;
  const distance = miles
    ? `Travel distance: ${miles} from your ZIP. This is a ZIP-distance band, not a driving-time estimate.`
    : 'Travel distance: none saved. Assignment uses a ZIP-distance band, not a driving-time estimate.';
  const excluded = normalizeCuisineIds([...(args.excludedCuisines ?? [])]).map((id) => cuisineLabel(id));
  return [
    distance,
    `Dietary flags: ${labeledList(args.dietaryFlags, DIETARY_LABELS)}.`,
    `Excluded cuisines: ${excluded.length > 0 ? excluded.join(', ') : 'none saved'}.`,
    `Allergies: ${labeledList(args.allergyFlags, {})}.`,
    'These saved preferences decide which restaurants can be assigned. Your note is stored with the reveal and does not choose the restaurants.',
  ];
}
