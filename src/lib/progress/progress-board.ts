/**
 * Progress page view model. Numbers come from `getMemberProgress`.
 * This file does not query or write.
 *
 * Next action, first match wins:
 * 1. code_issued — an issued code is waiting. Earliest `expiresAt`, then id.
 *    Opens `/challenges/show/[redemptionId]` when that id exists.
 * 2. code_expired — the visit window is still open and the code needs a reissue.
 *    Same ordering and destination as an issued code.
 * 3. add_memory — a verified visit with no note. Latest `occurredAt`, then id.
 *    Opens `/journal/notes/[redemptionId]` with return `/journey`.
 * 4. ready — an assigned challenge with no code. Lowest slot, then name, then id.
 *    Opens `/challenges`.
 * 5. no_pair — there is no current pair. Uses the existing Challenges CTA
 *    (area hold, credits waiting, reveal, or Generate Challenge).
 * 6. caught_up — a pair exists and none of the above apply. Opens Discover.
 */

import { showsMonthlyCuration } from '@/lib/challenges/monthly-cron-gate';
import { AREA_HOLD_HEADING } from '@/lib/launch-market';
import { chicagoMonthStart } from '@/lib/cron-period';
import { noteEditorHref } from '@/lib/notes/note-rules';
import {
  levelFromXp,
  memberHeaderLabel,
  NEUTRAL_MEMBER_HEADER,
  XP_LEVELS,
  XP_PER_VERIFIED_VISIT,
  type LevelSnapshot,
} from '@/lib/progress/rules';
import type { MemberBadge, MemberProgress } from '@/lib/progress/get-member-progress';
import { restaurantDisplayImageUrl } from '@/lib/restaurant-image';
import { previousChicagoMonth } from '@/lib/streaks';
import {
  visitStatusCountsAsVisit,
  visitStatusLabel,
  deriveVisitStatus,
  type VisitStatus,
} from '@/lib/visits/visit-status';

export const PROGRESS_RETRY_HREF = '/journey';
export const PROGRESS_RETURN_PATH = '/journey';
export const XP_RULE_COPY = `${XP_PER_VERIFIED_VISIT} XP for every verified visit`;

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const FULL_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const chicagoHourFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  hour: 'numeric',
  hourCycle: 'h23',
});

const chicagoShortDateFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  month: 'short',
  day: 'numeric',
});

export type ProgressAdventure = {
  id: string;
  redemptionId: string | null;
  restaurantName: string;
  neighborhood: string | null;
  imageUrl: string;
  visitStatus: VisitStatus;
  occurredAt: string | null;
  verifiedAt: string | null;
  expiresAt: string | null;
  deadline: string | null;
  slotNumber: number | null;
};

export type NoPairCtaId = 'area_hold' | 'credits_waiting' | 'reveal' | 'generate';

export type NoPairCta = {
  id: NoPairCtaId;
  sentence: string;
  meta: string;
  actionHref: string;
  actionLabel: string;
};

export type NextMoveKind =
  | 'code_issued'
  | 'code_expired'
  | 'add_memory'
  | 'ready'
  | 'no_pair'
  | 'caught_up';

export type NextMove = {
  kind: NextMoveKind;
  sentence: string;
  accent: string | null;
  meta: string;
  actionHref: string;
  actionLabel: string;
};

export type StreakMonth = {
  key: string;
  label: string;
  verified: boolean;
  current: boolean;
  pending: boolean;
};

export type RecentAdventure = {
  id: string;
  redemptionId: string | null;
  restaurantName: string;
  imageUrl: string;
  meta: string;
  visitStatus: VisitStatus;
  statusLabel: string;
  memoryHref: string | null;
  memoryLabel: 'Add memory' | 'Edit memory' | null;
};

export type ProgressReadyModel = {
  status: 'ready';
  activityUnavailable: boolean;
  greetingLead: string;
  greetingName: string | null;
  initial: string;
  levelLabel: string;
  xp: number;
  level: LevelSnapshot;
  nextMove: NextMove | null;
  verifiedVisits: number;
  pendingVisits: number;
  uniqueRestaurants: number;
  neighborhoods: number | null;
  savingsAmount: number | null;
  savingsIsEstimate: boolean;
  currentMonthlyStreak: number;
  longestStreak: number;
  streakMonths: StreakMonth[];
  streakSentence: string;
  badges: MemberBadge[];
  adventures: RecentAdventure[];
  emptyVisits: boolean;
};

export type ActivityRedemption = {
  id: string;
  status: string | null;
  verifiedAt: string | null;
  expiresAt: string;
  createdAt: string | null;
  restaurantId: string | null;
  challengeItemId: string | null;
};

export type ActivityItem = {
  id: string;
  status: string | null;
  redemptionDeadline: string | null;
  slotNumber: number | null;
  restaurantId: string | null;
};

export type ActivityRestaurant = {
  id: string;
  name: string;
  neighborhood: string | null;
  imageUrl: string | null;
  googlePlaceId: string | null;
};

export function progressDayPart(now: Date): 'morning' | 'afternoon' | 'evening' {
  const hour = chicagoHour(now);
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

export function progressGreeting(headerLabel: string, now: Date): {
  lead: string;
  name: string | null;
  initial: string;
} {
  const part = progressDayPart(now);
  const lead = `Good ${part}`;
  const name = headerLabel === NEUTRAL_MEMBER_HEADER ? null : headerLabel;
  const source = name ?? headerLabel;
  const initial = source.trim().charAt(0).toUpperCase() || 'W';
  return { lead, name, initial };
}

/** Month after a `YYYY-MM-01` key. String step, same shape as `previousChicagoMonth`. */
export function nextChicagoMonth(monthStart: string): string {
  const year = Number(monthStart.slice(0, 4));
  const month = Number(monthStart.slice(5, 7));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return monthStart;
  }
  if (month === 12) return `${year + 1}-01-01`;
  return `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

export function monthAbbrev(monthStart: string): string {
  const month = Number(monthStart.slice(5, 7));
  return SHORT_MONTHS[month - 1] ?? monthStart;
}

export function monthFullName(monthStart: string): string {
  const month = Number(monthStart.slice(5, 7));
  return FULL_MONTHS[month - 1] ?? monthStart;
}

/** Six America/Chicago months ending at `now`, oldest first. */
export function chicagoMonthWindow(now: Date, count = 6): string[] {
  const keys: string[] = [];
  let cursor = chicagoMonthStart(now);
  for (let i = 0; i < count; i += 1) {
    keys.push(cursor);
    cursor = previousChicagoMonth(cursor);
  }
  return keys.reverse();
}

export function formatChicagoShort(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return chicagoShortDateFormat.format(date);
}

export function formatSavingsDollars(amount: number | null): string {
  if (amount == null || Number.isNaN(amount)) return '—';
  return `$${amount.toFixed(0)}`;
}

export type NoPairCtaInput = {
  launchEligible: boolean;
  /** `user_profiles.workflow_version === 'credits'`. A zero pending count is not a hold. */
  creditsWorkflow: boolean;
  /**
   * Head count of `entitlement_credits` for this member, this America/Chicago
   * month, `status = 'pending'`. Ignored unless `creditsWorkflow` is true.
   */
  pendingCreditsCount: number;
  /**
   * `memberGenerateBlocked()`: the monthly-reveal flag is on and the reveal
   * schema read is `available` or `unknown`.
   */
  generateBlocked: boolean;
};

/** Filters for the same pending-credit head count `/challenges` loads. */
export function pendingCreditsHeadFilters(
  userId: string,
  now: Date,
): { userId: string; issuePeriod: string; status: 'pending' } {
  return {
    userId,
    issuePeriod: chicagoMonthStart(now),
    status: 'pending',
  };
}

/**
 * No-pair next move. Order: area hold, then credits waiting, then reveal, then generate.
 * Credits waiting is a pending count above zero, not the workflow flag alone.
 * Reveal follows `/challenges`: `showsMonthlyCuration` (launch-eligible legacy, no pair)
 * and only while member Generate is blocked. Credits members never take that branch.
 */
export function noPairCta(input: NoPairCtaInput): NoPairCta {
  if (!input.launchEligible) {
    return {
      id: 'area_hold',
      sentence: AREA_HOLD_HEADING,
      meta: 'Challenges stay on the Challenges page',
      actionHref: '/challenges',
      actionLabel: 'See challenges',
    };
  }
  if (input.creditsWorkflow && input.pendingCreditsCount > 0) {
    return {
      id: 'credits_waiting',
      sentence: 'Your credits are waiting.',
      meta:
        input.pendingCreditsCount === 2
          ? 'You have 2 credits for this month. Restaurant selection is not open yet.'
          : 'Restaurant selection is not open yet',
      actionHref: '/challenges',
      actionLabel: 'Open challenges',
    };
  }
  if (
    input.generateBlocked &&
    showsMonthlyCuration({
      launchEligible: input.launchEligible,
      creditsWorkflow: input.creditsWorkflow,
      hasCurrentPair: false,
    })
  ) {
    return {
      id: 'reveal',
      sentence: 'Reveal your challenges.',
      meta: 'This month’s pair is chosen on the Challenges page',
      actionHref: '/challenges',
      actionLabel: 'Go to Challenges',
    };
  }
  return {
    id: 'generate',
    sentence: 'Generate your two restaurant challenges for this month.',
    meta: 'No pair yet',
    actionHref: '/challenges',
    actionLabel: 'Generate Challenge',
  };
}

export function headerLabelFor(fullName: string | null | undefined): string {
  return memberHeaderLabel(fullName);
}

export function assembleProgressAdventures(input: {
  redemptions: readonly ActivityRedemption[];
  items: readonly ActivityItem[];
  restaurants: readonly ActivityRestaurant[];
  noteRedemptionIds: ReadonlySet<string>;
  now: Date;
}): ProgressAdventure[] {
  const itemById = new Map(input.items.map((item) => [item.id, item]));
  const restaurantById = new Map(input.restaurants.map((restaurant) => [restaurant.id, restaurant]));
  const coveredItems = new Set<string>();
  const adventures: ProgressAdventure[] = [];

  for (const redemption of input.redemptions) {
    const item = redemption.challengeItemId
      ? itemById.get(redemption.challengeItemId)
      : undefined;
    if (item) coveredItems.add(item.id);
    adventures.push(
      adventureFromRedemption({
        redemption,
        item,
        restaurant: restaurantFor(redemption.restaurantId ?? item?.restaurantId ?? null, restaurantById),
        hasNote: input.noteRedemptionIds.has(redemption.id),
        now: input.now,
      }),
    );
  }

  for (const item of input.items) {
    if (coveredItems.has(item.id)) continue;
    const restaurant = restaurantFor(item.restaurantId, restaurantById);
    const visitStatus = deriveVisitStatus({
      item: { status: item.status ?? 'assigned', redemptionDeadline: item.redemptionDeadline },
      redemption: null,
      note: null,
      now: input.now,
    });
    adventures.push({
      id: item.id,
      redemptionId: null,
      restaurantName: restaurant?.name?.trim() || 'Restaurant',
      neighborhood: cleanNeighborhood(restaurant?.neighborhood),
      imageUrl: imageFor(item.restaurantId, restaurant),
      visitStatus,
      occurredAt: null,
      verifiedAt: null,
      expiresAt: null,
      deadline: item.redemptionDeadline,
      slotNumber: item.slotNumber,
    });
  }

  return adventures;
}

export function selectNextMove(input: {
  adventures: readonly ProgressAdventure[];
  hasPair: boolean;
  xp: number;
  nextLevelName: string | null;
  nextLevelXp: number | null;
  noPair: NoPairCta;
  now: Date;
}): NextMove {
  const issued = pickCode(input.adventures, 'code_issued');
  if (issued) return codeMove('code_issued', issued, input);

  const expired = pickCode(input.adventures, 'code_expired');
  if (expired) return codeMove('code_expired', expired, input);

  const memory = pickMemory(input.adventures);
  if (memory?.redemptionId) {
    return {
      kind: 'add_memory',
      sentence: `Add a memory from ${memory.restaurantName}.`,
      accent: null,
      meta: 'Verified visit',
      actionHref: noteEditorHref(memory.redemptionId, PROGRESS_RETURN_PATH),
      actionLabel: 'Add memory',
    };
  }

  const ready = pickReady(input.adventures);
  if (ready) {
    const levelUp = levelUpAccent(input.xp, input.nextLevelName, input.nextLevelXp);
    return {
      kind: 'ready',
      sentence: levelUp
        ? `Visit ${ready.restaurantName} and you'll level up to`
        : `Visit ${ready.restaurantName}.`,
      accent: levelUp,
      meta: joinMeta([`+${XP_PER_VERIFIED_VISIT} XP`, daysLeftLabel(ready.deadline, input.now)]),
      actionHref: '/challenges',
      actionLabel: 'Open challenge',
    };
  }

  if (!input.hasPair) {
    return {
      kind: 'no_pair',
      sentence: input.noPair.sentence,
      accent: null,
      meta: input.noPair.meta,
      actionHref: input.noPair.actionHref,
      actionLabel: input.noPair.actionLabel,
    };
  }

  return {
    kind: 'caught_up',
    sentence: "You're caught up for now.",
    accent: null,
    meta: 'Your challenges are up to date',
    actionHref: '/roulette',
    actionLabel: 'Discover a place',
  };
}

export function buildStreakMonths(input: {
  now: Date;
  verifiedAt: readonly string[];
}): StreakMonth[] {
  const verified = new Set(
    input.verifiedAt
      .map((iso) => {
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return null;
        return chicagoMonthStart(date);
      })
      .filter((key): key is string => Boolean(key)),
  );
  const current = chicagoMonthStart(input.now);
  return chicagoMonthWindow(input.now).map((key) => {
    const isCurrent = key === current;
    const isVerified = verified.has(key);
    return {
      key,
      label: monthAbbrev(key),
      verified: isVerified,
      current: isCurrent,
      pending: isCurrent && !isVerified,
    };
  });
}

export function streakSentence(input: {
  now: Date;
  verifiedAt: readonly string[];
  currentMonthlyStreak: number;
  pendingRestaurantName: string | null;
}): string {
  const current = chicagoMonthStart(input.now);
  const label = monthFullName(current);
  const verified = input.verifiedAt.some((iso) => {
    const date = new Date(iso);
    return !Number.isNaN(date.getTime()) && chicagoMonthStart(date) === current;
  });
  if (!verified) {
    if (input.pendingRestaurantName) {
      return `${label} counts as soon as ${input.pendingRestaurantName} is verified.`;
    }
    if (input.currentMonthlyStreak > 0) {
      return `${label} is still open. A verified visit this month keeps the streak going.`;
    }
    return 'A verified visit this month starts your streak.';
  }
  const nextCount = input.currentMonthlyStreak + 1;
  return `Visit again in ${monthFullName(nextChicagoMonth(current))} to make it ${nextCount} in a row.`;
}

export function dedupeBadges(badges: readonly MemberBadge[]): MemberBadge[] {
  const seen = new Set<string>();
  const unique: MemberBadge[] = [];
  for (const badge of badges) {
    if (seen.has(badge.id)) continue;
    seen.add(badge.id);
    unique.push(badge);
  }
  return unique;
}

export function buildProgressModel(input: {
  progress: Exclude<MemberProgress, { error: 'progress_unavailable' }>;
  headerLabel: string;
  now: Date;
  activity:
    | { ok: true; hasPair: boolean; adventures: readonly ProgressAdventure[]; noPair: NoPairCta }
    | { ok: false };
}): ProgressReadyModel {
  const level = levelFromXp(input.progress.xp);
  const greeting = progressGreeting(input.headerLabel, input.now);
  const verifiedAt = input.activity.ok
    ? input.activity.adventures.flatMap((adventure) =>
        visitStatusCountsAsVisit(adventure.visitStatus) && adventure.verifiedAt
          ? [adventure.verifiedAt]
          : [],
      )
    : [];
  const pendingName = input.activity.ok
    ? pickCode(input.activity.adventures, 'code_issued')?.restaurantName ?? null
    : null;
  const nextMove = input.activity.ok
    ? selectNextMove({
        adventures: input.activity.adventures,
        hasPair: input.activity.hasPair,
        xp: input.progress.xp,
        nextLevelName: level.nextLevel?.name ?? null,
        nextLevelXp: level.nextLevel?.xp ?? null,
        noPair: input.activity.noPair,
        now: input.now,
      })
    : null;

  return {
    status: 'ready',
    activityUnavailable: !input.activity.ok,
    greetingLead: greeting.lead,
    greetingName: greeting.name,
    initial: greeting.initial,
    levelLabel: `Level ${level.level} · ${level.name}`,
    xp: input.progress.xp,
    level,
    nextMove,
    verifiedVisits: input.progress.verifiedVisits,
    pendingVisits: input.progress.pendingVisits,
    uniqueRestaurants: input.progress.uniqueRestaurants,
    neighborhoods: input.progress.neighborhoods,
    savingsAmount: input.progress.savings.amount,
    savingsIsEstimate: input.progress.savings.isEstimate,
    currentMonthlyStreak: input.progress.currentMonthlyStreak,
    longestStreak: input.progress.longestStreak,
    streakMonths: buildStreakMonths({ now: input.now, verifiedAt }),
    streakSentence: streakSentence({
      now: input.now,
      verifiedAt,
      currentMonthlyStreak: input.progress.currentMonthlyStreak,
      pendingRestaurantName: pendingName,
    }),
    badges: dedupeBadges(input.progress.badges),
    adventures: input.activity.ok ? recentAdventures(input.activity.adventures) : [],
    emptyVisits:
      input.progress.verifiedVisits === 0 &&
      input.progress.pendingVisits === 0 &&
      (!input.activity.ok ||
        input.activity.adventures.every(
          (adventure) =>
            !visitStatusCountsAsVisit(adventure.visitStatus) &&
            adventure.visitStatus !== 'code_issued',
        )),
  };
}

export const LEVEL_ROAD = XP_LEVELS;

function recentAdventures(adventures: readonly ProgressAdventure[]): RecentAdventure[] {
  return adventures
    .filter(
      (adventure) =>
        visitStatusCountsAsVisit(adventure.visitStatus) ||
        adventure.visitStatus === 'code_issued' ||
        adventure.visitStatus === 'code_expired',
    )
    .slice()
    .sort((a, b) => {
      const at = time(a.occurredAt);
      const bt = time(b.occurredAt);
      if (at == null && bt == null) return a.id.localeCompare(b.id);
      if (at == null) return 1;
      if (bt == null) return -1;
      if (bt !== at) return bt - at;
      return a.id.localeCompare(b.id);
    })
    .map((adventure) => {
      const memory = memoryLink(adventure);
      const when = formatChicagoShort(adventure.occurredAt);
      return {
        id: adventure.id,
        redemptionId: adventure.redemptionId,
        restaurantName: adventure.restaurantName,
        imageUrl: adventure.imageUrl,
        meta: [when, cleanNeighborhood(adventure.neighborhood)].filter(Boolean).join(' · '),
        visitStatus: adventure.visitStatus,
        statusLabel: visitStatusLabel(adventure.visitStatus),
        memoryHref: memory?.href ?? null,
        memoryLabel: memory?.label ?? null,
      };
    });
}

function memoryLink(
  adventure: ProgressAdventure,
): { href: string; label: 'Add memory' | 'Edit memory' } | null {
  if (!adventure.redemptionId) return null;
  if (adventure.visitStatus === 'verified') {
    return {
      href: noteEditorHref(adventure.redemptionId, PROGRESS_RETURN_PATH),
      label: 'Add memory',
    };
  }
  if (adventure.visitStatus === 'note_added') {
    return {
      href: noteEditorHref(adventure.redemptionId, PROGRESS_RETURN_PATH),
      label: 'Edit memory',
    };
  }
  return null;
}

function codeMove(
  kind: 'code_issued' | 'code_expired',
  adventure: ProgressAdventure,
  input: { xp: number; nextLevelName: string | null; nextLevelXp: number | null; now: Date },
): NextMove {
  const href = adventure.redemptionId
    ? `/challenges/show/${encodeURIComponent(adventure.redemptionId)}`
    : '/challenges';
  const levelUp = levelUpAccent(input.xp, input.nextLevelName, input.nextLevelXp);
  if (kind === 'code_expired') {
    return {
      kind,
      sentence: `Get a new code for ${adventure.restaurantName}.`,
      accent: null,
      meta: joinMeta(['Code expired', daysLeftLabel(adventure.deadline, input.now)]),
      actionHref: href,
      actionLabel: 'Get a new code',
    };
  }
  return {
    kind,
    sentence: levelUp
      ? `Show your code at ${adventure.restaurantName} and you'll level up to`
      : `Show your code at ${adventure.restaurantName}.`,
    accent: levelUp,
    meta: joinMeta(['Code issued', daysLeftLabel(adventure.deadline, input.now)]),
    actionHref: href,
    actionLabel: 'Show code',
  };
}

function levelUpAccent(xp: number, name: string | null, nextXp: number | null): string | null {
  if (!name || nextXp == null) return null;
  if (xp + XP_PER_VERIFIED_VISIT < nextXp) return null;
  return `${name}.`;
}

function pickCode(
  adventures: readonly ProgressAdventure[],
  status: 'code_issued' | 'code_expired',
): ProgressAdventure | null {
  const matches = adventures.filter((adventure) => adventure.visitStatus === status);
  matches.sort((a, b) => {
    const at = time(a.expiresAt);
    const bt = time(b.expiresAt);
    if (at == null && bt != null) return 1;
    if (at != null && bt == null) return -1;
    if (at != null && bt != null && at !== bt) return at - bt;
    return (a.redemptionId ?? a.id).localeCompare(b.redemptionId ?? b.id);
  });
  return matches[0] ?? null;
}

function pickMemory(adventures: readonly ProgressAdventure[]): ProgressAdventure | null {
  const matches = adventures.filter(
    (adventure) => adventure.visitStatus === 'verified' && adventure.redemptionId,
  );
  matches.sort((a, b) => {
    const at = time(a.occurredAt);
    const bt = time(b.occurredAt);
    if (at == null && bt != null) return 1;
    if (at != null && bt == null) return -1;
    if (at != null && bt != null && at !== bt) return bt - at;
    return (a.redemptionId ?? a.id).localeCompare(b.redemptionId ?? b.id);
  });
  return matches[0] ?? null;
}

function pickReady(adventures: readonly ProgressAdventure[]): ProgressAdventure | null {
  const matches = adventures.filter((adventure) => adventure.visitStatus === 'ready');
  matches.sort((a, b) => {
    const as = a.slotNumber ?? Number.MAX_SAFE_INTEGER;
    const bs = b.slotNumber ?? Number.MAX_SAFE_INTEGER;
    if (as !== bs) return as - bs;
    const byName = a.restaurantName.localeCompare(b.restaurantName);
    if (byName !== 0) return byName;
    return a.id.localeCompare(b.id);
  });
  return matches[0] ?? null;
}

function daysLeftLabel(deadline: string | null, now: Date): string | null {
  const at = time(deadline);
  if (at == null) return null;
  const ms = at - now.getTime();
  if (ms <= 0) return null;
  const days = Math.ceil(ms / 86_400_000);
  return days === 1 ? '1 day left' : `${days} days left`;
}

function joinMeta(parts: readonly (string | null)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(' · ');
}

function time(iso: string | null): number | null {
  if (!iso) return null;
  const value = new Date(iso).getTime();
  return Number.isNaN(value) ? null : value;
}

function chicagoHour(now: Date): number {
  const raw = chicagoHourFormat
    .formatToParts(now)
    .find((part) => part.type === 'hour')?.value;
  const hour = Number(raw ?? '0');
  if (!Number.isInteger(hour)) return 0;
  return hour === 24 ? 0 : hour;
}

function adventureFromRedemption(input: {
  redemption: ActivityRedemption;
  item: ActivityItem | undefined;
  restaurant: ActivityRestaurant | undefined;
  hasNote: boolean;
  now: Date;
}): ProgressAdventure {
  const visitStatus = deriveVisitStatus({
    item: {
      status: input.item?.status ?? 'assigned',
      redemptionDeadline: input.item?.redemptionDeadline ?? null,
    },
    redemption: {
      status: input.redemption.status ?? '',
      verifiedAt: input.redemption.verifiedAt,
      expiresAt: input.redemption.expiresAt,
    },
    note: input.hasNote ? { note: null } : null,
    now: input.now,
  });
  const verifiedAt = visitStatusCountsAsVisit(visitStatus) ? input.redemption.verifiedAt : null;
  return {
    id: input.redemption.id,
    redemptionId: input.redemption.id,
    restaurantName: input.restaurant?.name?.trim() || 'Restaurant',
    neighborhood: cleanNeighborhood(input.restaurant?.neighborhood),
    imageUrl: imageFor(input.redemption.restaurantId ?? input.item?.restaurantId ?? null, input.restaurant),
    visitStatus,
    occurredAt: input.redemption.verifiedAt ?? input.redemption.createdAt,
    verifiedAt,
    expiresAt: input.redemption.expiresAt,
    deadline: input.item?.redemptionDeadline ?? null,
    slotNumber: input.item?.slotNumber ?? null,
  };
}

function restaurantFor(
  id: string | null,
  restaurantById: ReadonlyMap<string, ActivityRestaurant>,
): ActivityRestaurant | undefined {
  if (!id) return undefined;
  return restaurantById.get(id);
}

function imageFor(id: string | null, restaurant: ActivityRestaurant | undefined): string {
  return restaurantDisplayImageUrl({
    id: id ?? restaurant?.id ?? '',
    image_url: restaurant?.imageUrl ?? null,
    google_place_id: restaurant?.googlePlaceId ?? null,
  });
}

function cleanNeighborhood(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed : null;
}
