/**
 * Pure quarterly drawing campaign checks.
 *
 * Prize cost plus the fulfillment allowance is the committed amount.
 * That sum may equal the authorized total and must not exceed it.
 * Sample campaigns stay labeled as sample prizes. Live campaigns
 * reject sample prizes. The only entry source in this slice is
 * `level_milestone`. Public-review sources are never eligible.
 *
 * `checkCampaignTransition` is the same lifecycle gate the database
 * applies before a campaign leaves draft. Activation in this slice
 * allows sample mode only. The caller supplies `now`; this file does
 * not read the clock.
 *
 * No database, network, or environment access. Official rules text
 * and real prize amounts are not decided here. Quarter bounds use
 * `chicagoQuarterKey` (America/Chicago), not a second calendar and
 * not the process time zone.
 */

import { chicagoQuarterKey } from '@/lib/progression/quarter';

/** Visible marker required on every sample prize. */
export const SAMPLE_PRIZE_MARKER = 'Sample prize';

/** Drawing entries in this slice come from level milestones only. */
export const LEVEL_MILESTONE_ENTRY_SOURCE = 'level_milestone' as const;

export const CAMPAIGN_ERROR_CODES = [
  'invalid_quarter_key',
  'invalid_mode',
  'invalid_rules_version',
  'non_integer_cents',
  'negative_cents',
  'empty_prizes',
  'invalid_label',
  'non_integer_quantity',
  'negative_quantity',
  'zero_quantity',
  'sample_prize_required',
  'sample_label_required',
  'live_sample_prize',
  'unknown_entry_source',
  'public_review_entry',
  'over_budget',
] as const;

export type CampaignErrorCode = (typeof CAMPAIGN_ERROR_CODES)[number];

export type CampaignMode = 'sample' | 'live';

export type CampaignPrize = {
  label: string;
  quantity: number;
  unitValueCents: number;
  isSample: boolean;
};

export type CampaignDraft = {
  quarterKey: string;
  mode: CampaignMode;
  /** Version token for later rules text. Not the rules themselves. */
  rulesVersion: string;
  totalBudgetCents: number;
  fulfillmentAllowanceCents: number;
  prizes: CampaignPrize[];
  eligibleEntrySources: readonly string[];
};

export type CampaignValidation =
  | { ok: true; committedCents: number }
  | { ok: false; errors: CampaignErrorCode[] };

export type CampaignWindow = {
  /** Inclusive America/Chicago quarter start, as an ISO instant. */
  startsAt: string;
  /** Exclusive America/Chicago quarter end, as an ISO instant. */
  endsAt: string;
};

/** Lifecycle codes shared with the database transition. over_budget is shared with draft checks. */
export const CAMPAIGN_TRANSITION_ERROR_CODES = [
  'invalid_transition',
  'live_activation_blocked',
  'over_budget',
  'campaign_window_ended',
  'no_prizes',
] as const;

export type CampaignTransitionError = (typeof CAMPAIGN_TRANSITION_ERROR_CODES)[number];

export type CampaignStatus = 'draft' | 'active' | 'closed';

/** Fields the lifecycle gate needs. Amounts are the stored cents, not a fresh draft. */
export type CampaignTransitionState = {
  status: CampaignStatus;
  mode: CampaignMode;
  /** Exclusive quarter end, as an ISO instant. Activation requires now < endsAt. */
  endsAt: string;
  prizeCount: number;
  totalBudgetCents: number;
  committedCents: number;
};

export type CampaignTransitionResult =
  | { ok: true }
  | { ok: false; error: CampaignTransitionError };

const QUARTER_KEY = /^(\d{4})-Q([1-4])$/;

const PUBLIC_REVIEW_SOURCES = new Set([
  'review',
  'reviews',
  'public_review',
  'public_reviews',
  'google_review',
  'yelp',
  'yelp_review',
  'rating',
  'ratings',
  'bite_note',
  'public_note',
]);

const CHICAGO = 'America/Chicago';

const chicagoWallFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: CHICAGO,
  calendar: 'gregory',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/**
 * Reject a draft whose prizes and fulfillment do not fit the authorized total.
 * Field problems are reported with their own codes. This function does not throw.
 */
export function validateCampaignDraft(draft: CampaignDraft): CampaignValidation {
  const errors: CampaignErrorCode[] = [];
  const input = asRecord(draft);

  const quarterKey = input?.quarterKey;
  const mode = input?.mode;
  const rulesVersion = input?.rulesVersion;
  const totalBudgetCents = input?.totalBudgetCents;
  const fulfillmentAllowanceCents = input?.fulfillmentAllowanceCents;
  const prizes = input?.prizes;
  const eligibleEntrySources = input?.eligibleEntrySources;

  if (typeof quarterKey !== 'string' || !QUARTER_KEY.test(quarterKey)) {
    pushCode(errors, 'invalid_quarter_key');
  }
  if (mode !== 'sample' && mode !== 'live') {
    pushCode(errors, 'invalid_mode');
  }
  if (typeof rulesVersion !== 'string' || rulesVersion.trim() === '') {
    pushCode(errors, 'invalid_rules_version');
  }

  const totalCode = centsCode(totalBudgetCents);
  if (totalCode) pushCode(errors, totalCode);
  const fulfillmentCode = centsCode(fulfillmentAllowanceCents);
  if (fulfillmentCode) pushCode(errors, fulfillmentCode);

  const prizeRows = Array.isArray(prizes) ? prizes : null;
  if (!prizeRows || prizeRows.length === 0) {
    pushCode(errors, 'empty_prizes');
  } else {
    const prizeMode = mode === 'sample' || mode === 'live' ? mode : null;
    for (const prize of prizeRows) {
      readPrize(prize, prizeMode, errors);
    }
  }

  readEntrySources(eligibleEntrySources, errors);

  const committedCents = sumCommitted(fulfillmentAllowanceCents, prizeRows);
  if (committedCents === null) {
    if (prizeRows && prizeRows.length > 0 && !hasMoneyOrQuantityError(errors)) {
      pushCode(errors, 'non_integer_cents');
    }
  } else if (totalCode === null && committedCents > (totalBudgetCents as number)) {
    pushCode(errors, 'over_budget');
  }

  if (errors.length > 0) return { ok: false, errors };
  if (committedCents === null) return { ok: false, errors: ['non_integer_cents'] };
  return { ok: true, committedCents };
}

/**
 * Check `next` on its own. A valid `current` campaign is not permission
 * to commit more than `next.totalBudgetCents`. When the prize commitment
 * is unchanged, a total below that committed amount is `over_budget`.
 */
export function checkCampaignEdit(current: CampaignDraft, next: CampaignDraft): CampaignValidation {
  const proposed = validateCampaignDraft(next);
  if (lowersUnchangedCommitmentBelowTotal(current, next)) {
    return withOverBudget(proposed);
  }
  return proposed;
}

/**
 * Allowed moves are draft → active, active → closed, and draft → closed.
 * Activation requires sample mode, `now` strictly before `endsAt`,
 * at least one prize, and committed cents at or under the total.
 * `now` equal to `endsAt` is campaign_window_ended. This does not throw.
 */
export function checkCampaignTransition(
  current: CampaignTransitionState,
  toStatus: string,
  now: string,
): CampaignTransitionResult {
  const row = asRecord(current);
  const status = row?.status;
  const allowed =
    (status === 'draft' && toStatus === 'active') ||
    (status === 'active' && toStatus === 'closed') ||
    (status === 'draft' && toStatus === 'closed');
  if (!allowed) return { ok: false, error: 'invalid_transition' };
  if (toStatus !== 'active') return { ok: true };
  if (row?.mode !== 'sample') return { ok: false, error: 'live_activation_blocked' };
  if (windowEnded(row.endsAt, now)) return { ok: false, error: 'campaign_window_ended' };
  if (!hasPrizeCount(row.prizeCount)) return { ok: false, error: 'no_prizes' };
  if (!budgetFits(row.committedCents, row.totalBudgetCents)) {
    return { ok: false, error: 'over_budget' };
  }
  return { ok: true };
}

/**
 * Sample mode always starts the visible label with `SAMPLE_PRIZE_MARKER`.
 * A label that already starts with the marker is not prefixed a second time.
 * Live mode returns the trimmed label unchanged.
 */
export function displayPrizeLabel(prize: Pick<CampaignPrize, 'label'>, mode: CampaignMode): string {
  const label = typeof prize?.label === 'string' ? prize.label.trim() : '';
  if (mode !== 'sample') return label;
  if (label.startsWith(SAMPLE_PRIZE_MARKER)) return label;
  return label.length > 0 ? `${SAMPLE_PRIZE_MARKER}: ${label}` : SAMPLE_PRIZE_MARKER;
}

/**
 * Inclusive start and exclusive end of the America/Chicago quarter.
 * Month starts are the inverse of `chicagoQuarterKey` (`ceil(month / 3)`).
 * The returned instants are checked with that function. A malformed key
 * returns null and does not throw.
 */
export function campaignWindow(quarterKey: string): CampaignWindow | null {
  if (typeof quarterKey !== 'string') return null;
  const match = QUARTER_KEY.exec(quarterKey);
  if (!match) return null;
  const year = Number(match[1]);
  const quarter = Number(match[2]);
  const startMonth = (quarter - 1) * 3 + 1;
  const endYear = quarter === 4 ? year + 1 : year;
  const endMonth = quarter === 4 ? 1 : startMonth + 3;
  const starts = chicagoMidnight(year, startMonth, 1);
  const ends = chicagoMidnight(endYear, endMonth, 1);
  if (!starts || !ends) return null;
  if (!edgesMatchQuarter(quarterKey, starts, ends)) return null;
  return { startsAt: starts.toISOString(), endsAt: ends.toISOString() };
}

function lowersUnchangedCommitmentBelowTotal(current: CampaignDraft, next: CampaignDraft): boolean {
  const previous = readableCommittedCents(current);
  const proposed = readableCommittedCents(next);
  if (previous === null || proposed === null) return false;
  if (!isWholeCents(next.totalBudgetCents)) return false;
  if (commitmentSignature(current) !== commitmentSignature(next)) return false;
  return next.totalBudgetCents < previous;
}

function withOverBudget(result: CampaignValidation): CampaignValidation {
  if (result.ok) return { ok: false, errors: ['over_budget'] };
  if (result.errors.includes('over_budget')) return result;
  return { ok: false, errors: [...result.errors, 'over_budget'] };
}

function windowEnded(endsAt: unknown, now: unknown): boolean {
  const endMs = instantMs(endsAt);
  const nowMs = instantMs(now);
  if (endMs === null || nowMs === null) return true;
  return nowMs >= endMs;
}

function instantMs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return ms;
}

function hasPrizeCount(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function budgetFits(committed: unknown, total: unknown): boolean {
  return (
    typeof committed === 'number' &&
    typeof total === 'number' &&
    Number.isSafeInteger(committed) &&
    Number.isSafeInteger(total) &&
    committed <= total
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pushCode(errors: CampaignErrorCode[], code: CampaignErrorCode) {
  if (!errors.includes(code)) errors.push(code);
}

function isWholeCents(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Non-integer and NaN share one code. Negatives keep their own. */
function centsCode(value: unknown): 'non_integer_cents' | 'negative_cents' | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(value)) {
    return 'non_integer_cents';
  }
  if (value < 0) return 'negative_cents';
  return null;
}

function quantityCode(
  value: unknown,
): 'non_integer_quantity' | 'negative_quantity' | 'zero_quantity' | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(value)) {
    return 'non_integer_quantity';
  }
  if (value < 0) return 'negative_quantity';
  if (value === 0) return 'zero_quantity';
  return null;
}

function readPrize(prize: unknown, mode: CampaignMode | null, errors: CampaignErrorCode[]) {
  const row = asRecord(prize);
  const label = row?.label;
  const labelText = typeof label === 'string' ? label.trim() : '';
  if (typeof label !== 'string' || labelText === '') {
    pushCode(errors, 'invalid_label');
  }

  const quantity = quantityCode(row?.quantity);
  if (quantity) pushCode(errors, quantity);
  const unit = centsCode(row?.unitValueCents);
  if (unit) pushCode(errors, unit);

  if (mode === 'sample') {
    if (row?.isSample !== true) pushCode(errors, 'sample_prize_required');
    if (typeof label !== 'string' || !label.includes(SAMPLE_PRIZE_MARKER)) {
      pushCode(errors, 'sample_label_required');
    }
  } else if (mode === 'live' && row?.isSample === true) {
    pushCode(errors, 'live_sample_prize');
  }
}

function readEntrySources(sources: unknown, errors: CampaignErrorCode[]) {
  if (!Array.isArray(sources) || sources.length === 0) {
    pushCode(errors, 'unknown_entry_source');
    return;
  }
  for (const source of sources) {
    if (typeof source !== 'string') {
      pushCode(errors, 'unknown_entry_source');
      continue;
    }
    if (source.trim() === LEVEL_MILESTONE_ENTRY_SOURCE) continue;
    const normalized = source.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (isPublicReviewSource(normalized)) {
      pushCode(errors, 'public_review_entry');
      continue;
    }
    pushCode(errors, 'unknown_entry_source');
  }
}

function isPublicReviewSource(normalized: string): boolean {
  if (PUBLIC_REVIEW_SOURCES.has(normalized)) return true;
  return normalized.includes('review');
}

function hasMoneyOrQuantityError(errors: readonly CampaignErrorCode[]): boolean {
  return errors.some(
    (code) =>
      code === 'non_integer_cents' ||
      code === 'negative_cents' ||
      code === 'non_integer_quantity' ||
      code === 'negative_quantity' ||
      code === 'zero_quantity' ||
      code === 'empty_prizes',
  );
}

function readableCommittedCents(draft: CampaignDraft): number | null {
  const input = asRecord(draft);
  if (!input) return null;
  return sumCommitted(input.fulfillmentAllowanceCents, input.prizes);
}

function sumCommitted(fulfillment: unknown, prizes: unknown): number | null {
  if (!isWholeCents(fulfillment)) return null;
  if (!Array.isArray(prizes) || prizes.length === 0) return null;
  let committed = 0;
  for (const prize of prizes) {
    const row = asRecord(prize);
    if (!row || quantityCode(row.quantity) || centsCode(row.unitValueCents)) return null;
    const quantity = row.quantity as number;
    const unitValueCents = row.unitValueCents as number;
    const product = quantity * unitValueCents;
    if (!Number.isSafeInteger(product)) return null;
    committed += product;
    if (!Number.isSafeInteger(committed)) return null;
  }
  committed += fulfillment;
  if (!Number.isSafeInteger(committed)) return null;
  return committed;
}

function commitmentSignature(draft: CampaignDraft): string | null {
  const input = asRecord(draft);
  if (!input || !Array.isArray(input.prizes) || !isWholeCents(input.fulfillmentAllowanceCents)) {
    return null;
  }
  const parts: string[] = [];
  for (const prize of input.prizes) {
    const row = asRecord(prize);
    if (!row || quantityCode(row.quantity) || centsCode(row.unitValueCents)) return null;
    parts.push(`${row.quantity as number}x${row.unitValueCents as number}`);
  }
  if (parts.length === 0) return null;
  return `${input.fulfillmentAllowanceCents}|${parts.join(',')}`;
}

function edgesMatchQuarter(quarterKey: string, starts: Date, ends: Date): boolean {
  try {
    const startKey = chicagoQuarterKey(starts.toISOString());
    const beforeStart = chicagoQuarterKey(new Date(starts.getTime() - 1).toISOString());
    const beforeEnd = chicagoQuarterKey(new Date(ends.getTime() - 1).toISOString());
    const endKey = chicagoQuarterKey(ends.toISOString());
    return startKey === quarterKey && beforeStart !== quarterKey && beforeEnd === quarterKey && endKey !== quarterKey;
  } catch {
    return false;
  }
}

function chicagoMidnight(year: number, month: number, day: number): Date | null {
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  // 18:00 UTC is afternoon or evening in Chicago, still the same civil date.
  const probe = new Date(Date.UTC(year, month - 1, day, 18, 0, 0, 0));
  const offset = chicagoOffsetMs(probe);
  if (!Number.isFinite(offset)) return null;
  let midnightMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - offset;
  const offsetAtMidnight = chicagoOffsetMs(new Date(midnightMs));
  if (Number.isFinite(offsetAtMidnight) && offsetAtMidnight !== offset) {
    midnightMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - offsetAtMidnight;
  }
  const midnight = new Date(midnightMs);
  const wall = chicagoWallClock(midnight);
  if (!wall || wall.year !== year || wall.month !== month || wall.day !== day || wall.hour !== 0 || wall.minute !== 0) {
    return null;
  }
  return midnight;
}

function chicagoOffsetMs(instant: Date): number {
  const wall = chicagoWallClock(instant);
  if (!wall) return Number.NaN;
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second, instant.getUTCMilliseconds());
  return asUtc - instant.getTime();
}

function chicagoWallClock(instant: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} | null {
  const parts = chicagoWallFormat.formatToParts(instant);
  const pick = (type: Intl.DateTimeFormatPartTypes) => {
    const value = parts.find((part) => part.type === type)?.value;
    if (!value) return Number.NaN;
    return Number(value);
  };
  let hour = pick('hour');
  if (hour === 24) hour = 0;
  const wall = {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour,
    minute: pick('minute'),
    second: pick('second'),
  };
  if (Object.values(wall).some((part) => !Number.isInteger(part))) return null;
  return wall;
}
