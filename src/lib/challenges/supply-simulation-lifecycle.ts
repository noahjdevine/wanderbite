import { addMonths, subMonths } from 'date-fns';
import { chicagoMonthStart } from '@/lib/cron-period';

export const ASSIGNMENT_HOURS = 840;
const CHICAGO = 'America/Chicago';

export type CreditStatus = 'pending' | 'linked' | 'spent' | 'expired';
export type ItemStatus = 'assigned' | 'swapped_out' | 'redeemed' | 'expired';
export type ReservationStatus = 'reserved' | 'released' | 'consumed';

export type SimCredit = {
  id: string;
  issuePeriod: string;
  slot: 1 | 2;
  status: CreditStatus;
  challengeItemId: string | null;
  issuedAt: Date;
  expiresAt: Date;
  issueK: number;
};

export type SimItem = {
  id: string;
  creditId: string | null;
  restaurantId: string;
  slot: 1 | 2;
  status: ItemStatus;
  assignedAt: Date;
  deadline: Date;
  issuePeriod: string;
};

export type SimReservation = {
  itemId: string;
  restaurantId: string;
  bucketStart: string;
  status: ReservationStatus;
};

export type SimRedemption = {
  restaurant_id: string;
  status: 'verified';
  verified_at: string;
  created_at: string;
  challengeItemId: string;
};

export type RolloverException = {
  chicagoMonth: string;
  reason: 'carry_cap_exceeded';
  linkedUncompletedCount: number;
  futureT2Count: number;
};

export type SupplyLedger = {
  credits: SimCredit[];
  items: SimItem[];
  reservations: SimReservation[];
  redemptions: SimRedemption[];
  swapMonths: string[];
  exceptions: RolloverException[];
};

export type RolloverApplyResult = {
  outcome: 'rolled' | 'rolled_with_exception' | 'unchanged';
  exceptionInserted: boolean;
  vLinked: number;
  vFuture: number;
};

export function createLedger(): SupplyLedger {
  return {
    credits: [],
    items: [],
    reservations: [],
    redemptions: [],
    swapMonths: [],
    exceptions: [],
  };
}

function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  let hour = pick('hour');
  const day = pick('day');
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(pick('year'), pick('month') - 1, day, hour, pick('minute'), pick('second'));
  return asUtc - instant.getTime();
}

/** Chicago wall-clock midnight as a UTC instant. Matches `timestamp at time zone`. */
export function chicagoMidnight(yyyyMmDd: string): Date {
  const [year, month, day] = yyyyMmDd.split('-').map(Number);
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const offset = timeZoneOffsetMs(new Date(guess), CHICAGO);
  let utc = guess - offset;
  const corrected = timeZoneOffsetMs(new Date(utc), CHICAGO);
  if (corrected !== offset) utc = guess - corrected;
  return new Date(utc);
}

/** Shift a YYYY-MM-01 date by whole calendar months. Noon UTC keeps the calendar day. */
export function shiftMonthStart(yyyyMmDd: string, delta: number): string {
  const [year, month] = yyyyMmDd.split('-').map(Number);
  const base = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
  const shifted = delta >= 0 ? addMonths(base, delta) : subMonths(base, -delta);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

export function simulatedMonthNow(anchorNow: Date, k: number): Date {
  const month = shiftMonthStart(chicagoMonthStart(anchorNow), -k);
  const [year, mon] = month.split('-').map(Number);
  return new Date(Date.UTC(year, mon - 1, 15, 18, 0, 0));
}

export function tierExpiresAt(issuePeriod: string, monthsAhead: 1 | 2): Date {
  return chicagoMidnight(shiftMonthStart(issuePeriod, monthsAhead));
}

export function plusAssignmentHours(at: Date): Date {
  return new Date(at.getTime() + ASSIGNMENT_HOURS * 60 * 60 * 1000);
}

export function carriedAssignDeadline(assignedAt: Date, expiresAt: Date): Date {
  const horizon = plusAssignmentHours(assignedAt);
  return horizon.getTime() < expiresAt.getTime() ? horizon : expiresAt;
}

/**
 * Chicago `bucket_start` values `reserve_version_buckets` would insert.
 * An 840-hour window can cross two month boundaries and touch three buckets.
 */
export function bucketsIntersectingDeadline(assignedAt: Date, deadline: Date): string[] {
  let month = chicagoMonthStart(assignedAt);
  const buckets: string[] = [];
  for (let step = 0; step < 8; step += 1) {
    const monthStart = chicagoMidnight(month);
    if (monthStart.getTime() >= deadline.getTime()) break;
    const next = shiftMonthStart(month, 1);
    const nextStart = chicagoMidnight(next);
    if (nextStart.getTime() > assignedAt.getTime()) buckets.push(month);
    month = next;
  }
  return buckets;
}

export function capacityCounts(
  ledger: SupplyLedger,
  restaurantId: string,
  bucketStart: string,
): { reserved: number; consumed: number; released: number; used: number } {
  let reserved = 0;
  let consumed = 0;
  let released = 0;
  for (const row of ledger.reservations) {
    if (row.restaurantId !== restaurantId || row.bucketStart !== bucketStart) continue;
    if (row.status === 'reserved') reserved += 1;
    else if (row.status === 'consumed') consumed += 1;
    else released += 1;
  }
  return { reserved, consumed, released, used: reserved + consumed };
}

export function bucketsHaveCapacity(
  ledger: SupplyLedger,
  restaurantId: string,
  buckets: string[],
  capacityMax: number,
): boolean {
  return buckets.every(
    (bucket) => capacityCounts(ledger, restaurantId, bucket).used < capacityMax,
  );
}

export function reserveBuckets(
  ledger: SupplyLedger,
  itemId: string,
  restaurantId: string,
  buckets: string[],
): void {
  for (const bucketStart of buckets) {
    ledger.reservations.push({
      itemId,
      restaurantId,
      bucketStart,
      status: 'reserved',
    });
  }
}

export function releaseItemReservations(ledger: SupplyLedger, itemId: string): void {
  for (const row of ledger.reservations) {
    if (row.itemId === itemId && row.status === 'reserved') row.status = 'released';
  }
}

export function settleItem(ledger: SupplyLedger, itemId: string, verifiedAt: Date): void {
  const bucket = chicagoMonthStart(verifiedAt);
  for (const row of ledger.reservations) {
    if (row.itemId !== itemId || row.status !== 'reserved') continue;
    row.status = row.bucketStart === bucket ? 'consumed' : 'released';
  }
}

function isT1Pending(credit: SimCredit, monthNow: Date): boolean {
  const vMonth = chicagoMonthStart(monthNow);
  if (credit.issuePeriod >= vMonth) return false;
  if (credit.status !== 'pending' || credit.challengeItemId !== null) return false;
  const t1 = tierExpiresAt(credit.issuePeriod, 1).getTime();
  const t2 = tierExpiresAt(credit.issuePeriod, 2).getTime();
  const nowMs = monthNow.getTime();
  return credit.expiresAt.getTime() === t1 && nowMs >= t1 && nowMs < t2;
}

/** In-memory `rollover_credits` for one member. `monthNow` is the simulated clock. */
export function applyRollover(ledger: SupplyLedger, monthNow: Date): RolloverApplyResult {
  const vMonth = chicagoMonthStart(monthNow);
  const nowMs = monthNow.getTime();
  let changed = 0;

  for (const credit of ledger.credits) {
    if (credit.issuePeriod >= vMonth) continue;
    if (credit.status !== 'pending' || credit.challengeItemId !== null) continue;
    const t2 = tierExpiresAt(credit.issuePeriod, 2).getTime();
    if (nowMs >= t2) {
      credit.status = 'expired';
      changed += 1;
    }
  }

  const vFuture = ledger.credits.filter((credit) => {
    if (credit.issuePeriod >= vMonth) return false;
    if (credit.status !== 'pending' || credit.challengeItemId !== null) return false;
    const t2 = tierExpiresAt(credit.issuePeriod, 2).getTime();
    return credit.expiresAt.getTime() === t2 && nowMs < t2;
  }).length;

  const vLinked = ledger.credits.filter((credit) => {
    if (credit.issuePeriod >= vMonth) return false;
    if (credit.status !== 'linked') return false;
    return !ledger.redemptions.some(
      (row) => row.challengeItemId === credit.challengeItemId && row.status === 'verified',
    );
  }).length;

  if (vLinked + vFuture > 2) {
    ledger.exceptions.push({
      chicagoMonth: vMonth,
      reason: 'carry_cap_exceeded',
      linkedUncompletedCount: vLinked,
      futureT2Count: vFuture,
    });
    for (const credit of ledger.credits) {
      if (!isT1Pending(credit, monthNow)) continue;
      credit.status = 'expired';
      changed += 1;
    }
    return {
      outcome: 'rolled_with_exception',
      exceptionInserted: true,
      vLinked,
      vFuture,
    };
  }

  const additional = 2 - vLinked - vFuture;
  const waiting = ledger.credits
    .filter((credit) => isT1Pending(credit, monthNow))
    .sort((a, b) => {
      const byExpiry = a.expiresAt.getTime() - b.expiresAt.getTime();
      if (byExpiry !== 0) return byExpiry;
      const byIssued = a.issuedAt.getTime() - b.issuedAt.getTime();
      if (byIssued !== 0) return byIssued;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  waiting.forEach((credit, index) => {
    if (index < additional) credit.expiresAt = tierExpiresAt(credit.issuePeriod, 2);
    else credit.status = 'expired';
    changed += 1;
  });

  if (changed > 0) {
    return { outcome: 'rolled', exceptionInserted: false, vLinked, vFuture };
  }
  return { outcome: 'unchanged', exceptionInserted: false, vLinked, vFuture };
}

let idSequence = 0;

export function resetSupplyIds(start = 0): void {
  idSequence = start;
}

export function nextSupplyId(prefix: string): string {
  idSequence += 1;
  const tail = idSequence.toString(16).padStart(12, '0');
  return `${prefix}-0000-4000-8000-${tail}`;
}

export function issueTwoCredits(
  ledger: SupplyLedger,
  monthNow: Date,
  k: number,
): [SimCredit, SimCredit] {
  const issuePeriod = chicagoMonthStart(monthNow);
  const expiresAt = tierExpiresAt(issuePeriod, 1);
  const slots: Array<1 | 2> = [1, 2];
  const created = slots.map((slot) => {
    const credit: SimCredit = {
      id: nextSupplyId('e2ssc001'),
      issuePeriod,
      slot,
      status: 'pending',
      challengeItemId: null,
      issuedAt: monthNow,
      expiresAt,
      issueK: k,
    };
    ledger.credits.push(credit);
    return credit;
  });
  return [created[0], created[1]];
}

export function creditIsCarried(credit: SimCredit, monthNow: Date): boolean {
  const open = chicagoMonthStart(monthNow);
  return (
    credit.issuePeriod < open &&
    credit.status === 'pending' &&
    credit.challengeItemId === null &&
    credit.expiresAt.getTime() === tierExpiresAt(credit.issuePeriod, 2).getTime() &&
    monthNow.getTime() < credit.expiresAt.getTime()
  );
}

export type AssignFailure = 'capacity_full' | 'below_floor' | 'duplicate_restaurant';

export function assignLinkedRestaurant(args: {
  ledger: SupplyLedger;
  credit: SimCredit;
  restaurantId: string;
  assignedAt: Date;
  deadline: Date;
  capacityMax: number;
  discountCents: number;
  floor: 'checked' | 'carried';
}): AssignFailure | SimItem {
  if (args.floor === 'carried' && args.discountCents < 2000) return 'below_floor';
  const duplicate = args.ledger.items.some(
    (item) =>
      item.issuePeriod === args.credit.issuePeriod &&
      item.restaurantId === args.restaurantId &&
      item.status !== 'swapped_out',
  );
  if (duplicate) return 'duplicate_restaurant';
  const buckets = bucketsIntersectingDeadline(args.assignedAt, args.deadline);
  if (!bucketsHaveCapacity(args.ledger, args.restaurantId, buckets, args.capacityMax)) {
    return 'capacity_full';
  }
  const item: SimItem = {
    id: nextSupplyId('e2ssi001'),
    creditId: args.credit.id,
    restaurantId: args.restaurantId,
    slot: args.credit.slot,
    status: 'assigned',
    assignedAt: args.assignedAt,
    deadline: args.deadline,
    issuePeriod: args.credit.issuePeriod,
  };
  reserveBuckets(args.ledger, item.id, args.restaurantId, buckets);
  args.ledger.items.push(item);
  args.credit.status = 'linked';
  args.credit.challengeItemId = item.id;
  return item;
}

export function completeCredit(
  ledger: SupplyLedger,
  credit: SimCredit,
  verifiedAt: Date,
  policy: 'verify_on_assign' | 'leave_linked',
): void {
  if (policy === 'leave_linked') return;
  if (!credit.challengeItemId || credit.status !== 'linked') return;
  settleItem(ledger, credit.challengeItemId, verifiedAt);
  credit.status = 'spent';
  const item = ledger.items.find((row) => row.id === credit.challengeItemId);
  if (!item) return;
  ledger.redemptions.push({
    restaurant_id: item.restaurantId,
    status: 'verified',
    verified_at: verifiedAt.toISOString(),
    created_at: verifiedAt.toISOString(),
    challengeItemId: item.id,
  });
}

export type SwapFailure = 'swap_exhausted' | 'capacity_full' | 'pair_below_floor' | 'not_found';

export function swapLinkedCredit(args: {
  ledger: SupplyLedger;
  credit: SimCredit;
  replacementRestaurantId: string;
  replacementDiscountCents: number;
  siblingDiscountCents: number;
  capacityMax: number;
  monthNow: Date;
  carried: boolean;
}): SwapFailure | { outcome: 'created'; item: SimItem } {
  const month = chicagoMonthStart(args.monthNow);
  if (args.ledger.swapMonths.includes(month)) return 'swap_exhausted';
  if (!args.credit.challengeItemId || args.credit.status !== 'linked') return 'not_found';
  const source = args.ledger.items.find((item) => item.id === args.credit.challengeItemId);
  if (!source || source.status !== 'assigned') return 'not_found';
  if (!args.carried && args.siblingDiscountCents + args.replacementDiscountCents < 2000) {
    return 'pair_below_floor';
  }
  if (args.carried && args.replacementDiscountCents < 2000) return 'pair_below_floor';
  const deadline = args.carried
    ? carriedAssignDeadline(args.monthNow, args.credit.expiresAt)
    : plusAssignmentHours(args.monthNow);
  const buckets = bucketsIntersectingDeadline(args.monthNow, deadline);
  if (!bucketsHaveCapacity(args.ledger, args.replacementRestaurantId, buckets, args.capacityMax)) {
    return 'capacity_full';
  }
  source.status = 'swapped_out';
  source.creditId = null;
  releaseItemReservations(args.ledger, source.id);
  const successor: SimItem = {
    id: nextSupplyId('e2ssi001'),
    creditId: args.credit.id,
    restaurantId: args.replacementRestaurantId,
    slot: source.slot,
    status: 'assigned',
    assignedAt: args.monthNow,
    deadline,
    issuePeriod: args.credit.issuePeriod,
  };
  reserveBuckets(args.ledger, successor.id, args.replacementRestaurantId, buckets);
  args.ledger.items.push(successor);
  args.credit.challengeItemId = successor.id;
  args.ledger.swapMonths.push(month);
  return { outcome: 'created', item: successor };
}

export function snapshotLedger(ledger: SupplyLedger): string {
  return JSON.stringify({
    credits: ledger.credits.map((credit) => ({
      id: credit.id,
      status: credit.status,
      item: credit.challengeItemId,
      expires: credit.expiresAt.toISOString(),
    })),
    reservations: ledger.reservations.map((row) => ({
      item: row.itemId,
      restaurant: row.restaurantId,
      bucket: row.bucketStart,
      status: row.status,
    })),
    swaps: ledger.swapMonths,
  });
}
