export type OfferTier = {
  thresholdCents: number;
  discountCents: number;
};

export type DatedBoost = {
  id: string;
  kind: 'dated';
  start: string;
  end: string;
  bonusCents: number;
};

export type WeeklyBoost = {
  id: string;
  kind: 'weekly';
  startIsodow: number;
  startMinute: number;
  endMinute: number;
  bonusCents: number;
};

export type OfferBoost = DatedBoost | WeeklyBoost;

export type ExclusionPolicy = {
  excludeTax: boolean;
  excludeTip: boolean;
  categories: string[];
};

export type BillParts = {
  grossCents: number;
  taxCents: number;
  tipCents: number;
  categoryCents: { name: string; cents: number }[];
};

export type QuoteReason =
  | 'ok'
  | 'ineligible'
  | 'below_minimum'
  | 'past_deadline';

export type OfferQuote = {
  discountCents: number;
  applied: boolean;
  reason: QuoteReason;
  tierCents: number;
  boostCents: number;
};

const ISO_DOW: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export function localParts(instant: Date, timeZone: string): {
  isodow: number;
  minuteOfDay: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Mon';
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  return { isodow: ISO_DOW[weekday] ?? 1, minuteOfDay: hour * 60 + minute };
}

export function applyExclusions(bill: BillParts, policy: ExclusionPolicy): number {
  let cents = bill.grossCents;
  if (policy.excludeTax) cents -= bill.taxCents;
  if (policy.excludeTip) cents -= bill.tipCents;
  for (const category of bill.categoryCents) {
    if (policy.categories.includes(category.name)) cents -= category.cents;
  }
  return Math.max(0, cents);
}

function qualifyingTier(tiers: OfferTier[], eligibleSubtotalCents: number): OfferTier | null {
  const ordered = [...tiers].sort((a, b) => a.thresholdCents - b.thresholdCents);
  let match: OfferTier | null = null;
  for (const tier of ordered) {
    if (eligibleSubtotalCents >= tier.thresholdCents) match = tier;
  }
  return match;
}

export function weeklyContains(
  boost: WeeklyBoost,
  instant: Date,
  timeZone: string,
): boolean {
  const local = localParts(instant, timeZone);
  const overnight = boost.endMinute <= boost.startMinute;
  if (!overnight) {
    return (
      local.isodow === boost.startIsodow &&
      local.minuteOfDay >= boost.startMinute &&
      local.minuteOfDay < boost.endMinute
    );
  }
  if (local.isodow === boost.startIsodow && local.minuteOfDay >= boost.startMinute) {
    return true;
  }
  const next = boost.startIsodow === 7 ? 1 : boost.startIsodow + 1;
  return local.isodow === next && local.minuteOfDay < boost.endMinute;
}

function boostContains(boost: OfferBoost, checkInAt: Date, timeZone: string): boolean {
  if (boost.kind === 'dated') {
    const start = new Date(boost.start).getTime();
    const end = new Date(boost.end).getTime();
    const at = checkInAt.getTime();
    return at >= start && at < end;
  }
  return weeklyContains(boost, checkInAt, timeZone);
}

function bestBoost(
  boosts: OfferBoost[],
  checkInAt: Date | null,
  timeZone: string,
  validUntil: Date,
): number {
  if (!checkInAt || checkInAt.getTime() >= validUntil.getTime()) return 0;
  const matches = boosts.filter((boost) => boostContains(boost, checkInAt, timeZone));
  if (matches.length === 0) return 0;
  matches.sort((a, b) => b.bonusCents - a.bonusCents || a.id.localeCompare(b.id));
  return matches[0]?.bonusCents ?? 0;
}

export function quoteOffer(input: {
  mode: 'selection' | 'bound';
  tiers: OfferTier[];
  boosts: OfferBoost[];
  timeZone: string;
  validFrom: Date;
  validUntil: Date;
  current: boolean;
  withdrawn: boolean;
  eligibleSubtotalCents: number;
  at: Date;
  checkInAt: Date | null;
  redemptionDeadline: Date | null;
}): OfferQuote {
  const none = (reason: QuoteReason): OfferQuote => ({
    discountCents: 0,
    applied: false,
    reason,
    tierCents: 0,
    boostCents: 0,
  });

  if (
    input.mode === 'bound' &&
    input.redemptionDeadline &&
    input.at.getTime() >= input.redemptionDeadline.getTime()
  ) {
    return none('past_deadline');
  }

  if (input.mode === 'selection') {
    const at = input.at.getTime();
    const open =
      input.current &&
      !input.withdrawn &&
      at >= input.validFrom.getTime() &&
      at < input.validUntil.getTime();
    if (!open) return none('ineligible');
  }

  const tier = qualifyingTier(input.tiers, input.eligibleSubtotalCents);
  if (!tier) return none('below_minimum');
  const boostCents = bestBoost(input.boosts, input.checkInAt, input.timeZone, input.validUntil);
  const raw = tier.discountCents + boostCents;
  const discountCents = Math.max(0, Math.min(raw, input.eligibleSubtotalCents));
  return {
    discountCents,
    applied: discountCents > 0,
    reason: 'ok',
    tierCents: tier.discountCents,
    boostCents,
  };
}

export function pairSavingsModel(left: OfferTier[], right: OfferTier[]): {
  label: 'model input';
  ok: boolean;
  baseCents: number;
  qualifyingSpendCents: number;
  reason: string | null;
} {
  const base = (tiers: OfferTier[]) =>
    [...tiers].sort((a, b) => a.thresholdCents - b.thresholdCents)[0];
  const a = base(left);
  const b = base(right);
  if (!a || !b) {
    return {
      label: 'model input',
      ok: false,
      baseCents: 0,
      qualifyingSpendCents: 0,
      reason: 'missing_base_tier',
    };
  }
  const baseCents = a.discountCents + b.discountCents;
  const qualifyingSpendCents = a.thresholdCents + b.thresholdCents;
  return {
    label: 'model input',
    ok: baseCents >= 2000,
    baseCents,
    qualifyingSpendCents,
    reason: baseCents >= 2000 ? null : 'below_pair_floor',
  };
}

export type FlatOfferRow = {
  restaurantId: string;
  active: boolean | null;
  discountAmountCents: number | null;
  minSpendCents: number | null;
};

export function classifyFlatOffers(rows: FlatOfferRow[]): {
  mapped: { restaurantId: string; thresholdCents: number; discountCents: number }[];
  ambiguous: { restaurantId: string; reason: string }[];
} {
  const byRestaurant = new Map<string, FlatOfferRow[]>();
  for (const row of rows) {
    const list = byRestaurant.get(row.restaurantId) ?? [];
    list.push(row);
    byRestaurant.set(row.restaurantId, list);
  }
  const mapped: { restaurantId: string; thresholdCents: number; discountCents: number }[] = [];
  const ambiguous: { restaurantId: string; reason: string }[] = [];
  for (const [restaurantId, group] of byRestaurant) {
    const active = group.filter((row) => row.active);
    if (active.length !== 1) {
      ambiguous.push({ restaurantId, reason: 'active_row_count' });
      continue;
    }
    const row = active[0];
    if (
      row.discountAmountCents == null ||
      row.minSpendCents == null ||
      row.discountAmountCents <= 0 ||
      row.minSpendCents <= 0 ||
      row.discountAmountCents > row.minSpendCents
    ) {
      ambiguous.push({ restaurantId, reason: 'amounts' });
      continue;
    }
    mapped.push({
      restaurantId,
      thresholdCents: row.minSpendCents,
      discountCents: row.discountAmountCents,
    });
  }
  return { mapped, ambiguous };
}
