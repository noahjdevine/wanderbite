import { readFileSync } from 'node:fs';
import path from 'node:path';
import { subMonths } from 'date-fns';
import { describe, expect, it } from 'vitest';
import { chicagoMonthStart } from '@/lib/cron-period';
import {
  passesRestaurantHardFilters,
  redemptionCooldownOk,
  redemptionCooldownReason,
  rollingTwelveMonthStart,
  subMonthsChicago,
  varietyCycleMonthLowerBound,
  type CooldownRedemption,
} from '@/lib/challenges/restaurant-safety';

const ROOT = path.resolve(__dirname, '../../..');
const RESTAURANT = 'rest-1';

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return text.slice(from, to);
}

function visit(at: Date, restaurantId = RESTAURANT): CooldownRedemption {
  const iso = at.toISOString();
  return {
    restaurant_id: restaurantId,
    status: 'verified',
    verified_at: iso,
    created_at: iso,
  };
}

describe('rolling twelve-month redemption window', () => {
  const now = new Date('2026-10-15T15:00:00.000Z');

  it('passes one verified redemption 13 months ago', () => {
    const redemptions = [visit(subMonths(now, 13))];
    expect(redemptionCooldownOk(RESTAURANT, redemptions, now)).toBe(true);
    expect(
      passesRestaurantHardFilters({
        cuisineTags: ['thai'],
        allergyFlags: [],
        dietaryFlags: [],
        excludedCuisineIds: [],
        restaurantId: RESTAURANT,
        redemptions,
        now,
      }),
    ).toBe(true);
  });

  it('passes two verified redemptions older than twelve months and newer than twelve years', () => {
    expect(
      redemptionCooldownOk(
        RESTAURANT,
        [visit(subMonths(now, 13)), visit(subMonths(now, 14))],
        now,
      ),
    ).toBe(true);
  });

  it('blocks two verified redemptions inside twelve months and outside six', () => {
    const redemptions = [visit(subMonths(now, 7)), visit(subMonths(now, 11))];
    expect(redemptionCooldownOk(RESTAURANT, redemptions, now)).toBe(false);
    expect(
      passesRestaurantHardFilters({
        cuisineTags: ['thai'],
        allergyFlags: [],
        dietaryFlags: [],
        excludedCuisineIds: [],
        restaurantId: RESTAURANT,
        redemptions,
        now,
      }),
    ).toBe(false);
  });

  it('allows one verified redemption inside twelve months and outside six', () => {
    expect(redemptionCooldownOk(RESTAURANT, [visit(subMonths(now, 8))], now)).toBe(true);
  });

  it('includes a redemption exactly at the twelve-month cutoff and ignores one millisecond earlier', () => {
    const cutoff = subMonths(now, 12);
    const justBefore = new Date(cutoff.getTime() - 1);
    const inside = subMonths(now, 8);
    expect(rollingTwelveMonthStart(now).toISOString()).toBe(cutoff.toISOString());
    expect(redemptionCooldownOk(RESTAURANT, [visit(cutoff), visit(inside)], now)).toBe(false);
    expect(redemptionCooldownOk(RESTAURANT, [visit(justBefore), visit(inside)], now)).toBe(true);
  });

  it('ignores another restaurant, an unverified row, and an invalid timestamp', () => {
    const broken: CooldownRedemption = {
      restaurant_id: RESTAURANT,
      status: 'verified',
      verified_at: 'not-a-date',
      created_at: 'also-not-a-date',
    };
    expect(
      redemptionCooldownOk(
        RESTAURANT,
        [
          visit(subMonths(now, 8), 'other-restaurant'),
          { ...visit(subMonths(now, 8)), status: 'issued' },
          broken,
          visit(subMonths(now, 8)),
        ],
        now,
      ),
    ).toBe(true);
  });

  it('uses the subMonths instant across the Chicago and UTC month split and on DST days', () => {
    const early = new Date('2026-10-01T00:30:00.000Z');
    const later = new Date('2026-10-01T06:00:00.000Z');
    expect(chicagoMonthStart(early)).toBe('2026-09-01');
    expect(chicagoMonthStart(later)).toBe('2026-10-01');
    expect(early.toISOString().slice(0, 10)).toBe('2026-10-01');
    expect(later.toISOString().slice(0, 10)).toBe('2026-10-01');

    const verifiedAt = new Date('2025-11-15T12:00:00.000Z');
    for (const instant of [early, later]) {
      expect(rollingTwelveMonthStart(instant).toISOString()).toBe(
        subMonths(instant, 12).toISOString(),
      );
      expect(redemptionCooldownOk(RESTAURANT, [visit(verifiedAt)], instant)).toBe(true);
      expect(
        redemptionCooldownOk(
          RESTAURANT,
          [visit(verifiedAt), visit(subMonths(instant, 8))],
          instant,
        ),
      ).toBe(false);
    }

    for (const [iso, chicagoCutoff, insideIso] of [
      ['2026-03-08T09:30:00.000Z', '2025-03-08T10:30:00.000Z', '2025-07-08T09:30:00.000Z'],
      ['2026-11-01T08:30:00.000Z', '2025-11-01T07:30:00.000Z', '2026-03-01T08:30:00.000Z'],
    ] as const) {
      const dstNow = new Date(iso);
      const processCutoff = subMonths(dstNow, 12);
      expect(rollingTwelveMonthStart(dstNow).toISOString()).toBe(processCutoff.toISOString());
      const cutoff = new Date(chicagoCutoff);
      const before = new Date(cutoff.getTime() - 1);
      const inside = new Date(insideIso);
      expect(redemptionCooldownOk(RESTAURANT, [visit(cutoff), visit(inside)], dstNow)).toBe(false);
      expect(redemptionCooldownOk(RESTAURANT, [visit(before), visit(inside)], dstNow)).toBe(true);
    }
  });

  it('keeps March 31 on March 31 and clamps Feb 29 to Feb 28', () => {
    const marchNow = new Date('2027-03-31T15:00:00.000Z');
    const marchCutoff = new Date('2026-03-31T15:00:00.000Z');
    const marchDayBefore = new Date('2026-03-30T15:00:00.000Z');
    const marchLater = new Date('2026-08-31T15:00:00.000Z');
    expect(rollingTwelveMonthStart(marchNow).toISOString()).toBe(marchCutoff.toISOString());
    expect(
      redemptionCooldownOk(RESTAURANT, [visit(marchCutoff), visit(marchLater)], marchNow),
    ).toBe(false);
    expect(
      redemptionCooldownOk(RESTAURANT, [visit(marchDayBefore), visit(marchLater)], marchNow),
    ).toBe(true);

    const leapNow = new Date('2028-02-29T15:00:00.000Z');
    const leapCutoff = new Date('2027-02-28T15:00:00.000Z');
    const leapJustBefore = new Date('2027-02-28T14:59:59.999Z');
    const leapLater = new Date('2027-07-29T15:00:00.000Z');
    expect(rollingTwelveMonthStart(leapNow).toISOString()).toBe(leapCutoff.toISOString());
    expect(redemptionCooldownOk(RESTAURANT, [visit(leapCutoff), visit(leapLater)], leapNow)).toBe(
      false,
    );
    expect(
      redemptionCooldownOk(RESTAURANT, [visit(leapJustBefore), visit(leapLater)], leapNow),
    ).toBe(true);
  });
});

describe('variety cycle_month window', () => {
  function monthIndex(monthStart: string): number {
    return Number(monthStart.slice(0, 4)) * 12 + Number(monthStart.slice(5, 7));
  }

  function excluded(cycleMonth: string, now: Date, months: number): boolean {
    return (
      cycleMonth >= varietyCycleMonthLowerBound(now, months) &&
      cycleMonth < chicagoMonthStart(now)
    );
  }

  function expectSharedBounds(now: Date): void {
    const current = chicagoMonthStart(now);
    const six = varietyCycleMonthLowerBound(now, 6);
    const twelve = varietyCycleMonthLowerBound(now, 12);
    expect(monthIndex(current) - monthIndex(six)).toBe(6);
    expect(monthIndex(current) - monthIndex(twelve)).toBe(12);
    expect(monthIndex(six) - monthIndex(twelve)).toBe(6);
  }

  it('shares one helper for six and twelve Chicago months', () => {
    const first = new Date('2026-10-01T05:00:00.000Z');
    const mid = new Date('2026-10-15T15:00:00.000Z');
    expect(chicagoMonthStart(first)).toBe('2026-10-01');
    expect(chicagoMonthStart(mid)).toBe('2026-10-01');
    expectSharedBounds(first);
    expectSharedBounds(mid);
    expect(varietyCycleMonthLowerBound(first, 6)).toBe('2026-04-01');
    expect(varietyCycleMonthLowerBound(first, 12)).toBe('2025-10-01');
    expect(varietyCycleMonthLowerBound(mid, 6)).toBe(varietyCycleMonthLowerBound(first, 6));
    expect(varietyCycleMonthLowerBound(mid, 12)).toBe(varietyCycleMonthLowerBound(first, 12));
    expect(excluded('2026-10-01', mid, 6)).toBe(false);
    expect(excluded('2026-10-01', mid, 12)).toBe(false);
    expect(excluded('2026-09-01', mid, 6)).toBe(true);
    expect(excluded('2026-09-01', mid, 12)).toBe(true);
  });

  it('blocks an October 2025 cycle through October 2026 and an April 2026 cycle on the six-month rule', () => {
    const october = new Date('2026-10-15T15:00:00.000Z');
    const november = new Date('2026-11-15T18:00:00.000Z');
    expect(chicagoMonthStart(october)).toBe('2026-10-01');
    expect(chicagoMonthStart(november)).toBe('2026-11-01');
    expect(excluded('2025-10-01', october, 12)).toBe(true);
    expect(excluded('2025-10-01', november, 12)).toBe(false);
    expect(excluded('2026-04-01', october, 6)).toBe(true);
    expect(excluded('2026-04-01', november, 6)).toBe(false);
  });

  it('treats 2026-11-01T03:00Z as Chicago October', () => {
    const now = new Date('2026-11-01T03:00:00.000Z');
    expect(chicagoMonthStart(now)).toBe('2026-10-01');
    expect(now.toISOString().slice(0, 10)).toBe('2026-11-01');
    expectSharedBounds(now);
    expect(varietyCycleMonthLowerBound(now, 12)).toBe('2025-10-01');
    expect(varietyCycleMonthLowerBound(now, 6)).toBe('2026-04-01');
    expect(excluded('2025-10-01', now, 12)).toBe(true);
    expect(excluded('2026-04-01', now, 6)).toBe(true);
    expect(excluded('2026-10-01', now, 12)).toBe(false);
  });

  it('keeps Chicago months across DST and a January year boundary', () => {
    for (const iso of ['2026-03-08T07:30:00.000Z', '2026-03-08T08:30:00.000Z']) {
      const now = new Date(iso);
      expect(chicagoMonthStart(now)).toBe('2026-03-01');
      expectSharedBounds(now);
      expect(varietyCycleMonthLowerBound(now, 12)).toBe('2025-03-01');
      expect(varietyCycleMonthLowerBound(now, 6)).toBe('2025-09-01');
      expect(excluded('2025-03-01', now, 12)).toBe(true);
      expect(excluded('2026-02-01', now, 6)).toBe(true);
      expect(excluded('2026-03-01', now, 12)).toBe(false);
    }

    const stillOctober = new Date('2026-11-01T03:00:00.000Z');
    for (const iso of ['2026-11-01T06:30:00.000Z', '2026-11-01T07:30:00.000Z']) {
      const now = new Date(iso);
      expect(chicagoMonthStart(now)).toBe('2026-11-01');
      expect(chicagoMonthStart(stillOctober)).toBe('2026-10-01');
      expectSharedBounds(now);
      expect(varietyCycleMonthLowerBound(now, 12)).toBe('2025-11-01');
      expect(varietyCycleMonthLowerBound(now, 6)).toBe('2026-05-01');
      expect(varietyCycleMonthLowerBound(now, 12)).not.toBe(
        varietyCycleMonthLowerBound(stillOctober, 12),
      );
      expect(excluded('2025-10-01', now, 12)).toBe(false);
      expect(excluded('2025-11-01', now, 12)).toBe(true);
      expect(excluded('2026-04-01', now, 6)).toBe(false);
      expect(excluded('2026-05-01', now, 6)).toBe(true);
    }

    const january = new Date('2027-01-15T18:00:00.000Z');
    expect(chicagoMonthStart(january)).toBe('2027-01-01');
    expectSharedBounds(january);
    expect(varietyCycleMonthLowerBound(january, 12)).toBe('2026-01-01');
    expect(varietyCycleMonthLowerBound(january, 6)).toBe('2026-07-01');
    expect(excluded('2026-01-01', january, 12)).toBe(true);
    expect(excluded('2026-01-01', january, 6)).toBe(false);
    expect(excluded('2026-12-01', january, 12)).toBe(true);
    expect(excluded('2026-12-01', january, 6)).toBe(true);
    expect(excluded('2027-01-01', january, 12)).toBe(false);
    expect(excluded('2026-06-01', january, 6)).toBe(false);
  });
});

describe('Chicago DST cooldown cutoff', () => {
  function expectSixMonthCutoff(nowIso: string, cutoffIso: string): void {
    const now = new Date(nowIso);
    const cutoff = new Date(cutoffIso);
    expect(subMonthsChicago(now, 6).toISOString()).toBe(cutoff.toISOString());
    expect(redemptionCooldownReason(RESTAURANT, [visit(cutoff)], now)).toBe('recent_visit_6m');
    expect(redemptionCooldownReason(RESTAURANT, [visit(new Date(cutoff.getTime() - 1))], now)).toBeNull();
  }

  function expectTwelveMonthCutoff(nowIso: string, cutoffIso: string, insideIso: string): void {
    const now = new Date(nowIso);
    const cutoff = new Date(cutoffIso);
    const inside = new Date(insideIso);
    expect(subMonthsChicago(now, 12).toISOString()).toBe(cutoff.toISOString());
    expect(redemptionCooldownReason(RESTAURANT, [visit(cutoff), visit(inside)], now)).toBe('two_in_12m');
    expect(
      redemptionCooldownReason(RESTAURANT, [visit(new Date(cutoff.getTime() - 1)), visit(inside)], now),
    ).toBeNull();
  }

  function expectMonotonic(startIso: string, minutes: number, months: number): void {
    let previous = Number.NEGATIVE_INFINITY;
    for (let step = 0; step <= minutes; step += 1) {
      const now = new Date(Date.parse(startIso) + step * 60_000);
      const cutoff = subMonthsChicago(now, months).getTime();
      expect(cutoff).toBeGreaterThanOrEqual(previous);
      previous = cutoff;
    }
  }

  it('resolves the spring gap to the transition and keeps the March visit eligible', () => {
    expectSixMonthCutoff('2026-09-08T06:59:00.000Z', '2026-03-08T07:59:00.000Z');
    expectSixMonthCutoff('2026-09-08T07:01:00.000Z', '2026-03-08T08:00:00.000Z');
    expectSixMonthCutoff('2026-09-08T08:01:00.000Z', '2026-03-08T08:01:00.000Z');

    const earlyVisit = visit(new Date('2026-03-08T07:30:00.000Z'));
    const laterVisit = visit(new Date('2026-03-08T08:00:30.000Z'));
    for (const nowIso of ['2026-09-08T06:59:00.000Z', '2026-09-08T07:01:00.000Z', '2026-09-08T08:01:00.000Z']) {
      const now = new Date(nowIso);
      expect(redemptionCooldownReason(RESTAURANT, [earlyVisit], now)).toBeNull();
    }
    expect(redemptionCooldownReason(RESTAURANT, [laterVisit], new Date('2026-09-08T06:59:00.000Z'))).toBe(
      'recent_visit_6m',
    );
    expect(redemptionCooldownReason(RESTAURANT, [laterVisit], new Date('2026-09-08T07:01:00.000Z'))).toBe(
      'recent_visit_6m',
    );
    expect(redemptionCooldownReason(RESTAURANT, [laterVisit], new Date('2026-09-08T08:01:00.000Z'))).toBeNull();
  });

  it('exercises two_in_12m across the spring gap with both visits outside six months', () => {
    const now = new Date('2027-03-08T08:01:00.000Z');
    expect(subMonthsChicago(now, 12).toISOString()).toBe('2026-03-08T08:00:00.000Z');
    expect(subMonthsChicago(now, 6).toISOString()).toBe('2026-09-08T07:01:00.000Z');
    const april = visit(new Date('2026-04-15T12:00:00.000Z'));
    const august = visit(new Date('2026-08-15T12:00:00.000Z'));
    const beforeGap = visit(new Date('2026-03-08T07:30:00.000Z'));
    expect(redemptionCooldownReason(RESTAURANT, [april, august], now)).toBe('two_in_12m');
    expect(redemptionCooldownReason(RESTAURANT, [beforeGap, august], now)).toBeNull();
    expectTwelveMonthCutoff('2027-03-08T07:59:00.000Z', '2026-03-08T07:59:00.000Z', '2026-08-15T12:00:00.000Z');
    expectTwelveMonthCutoff('2027-03-08T08:01:00.000Z', '2026-03-08T08:00:00.000Z', '2026-08-15T12:00:00.000Z');
    expectTwelveMonthCutoff('2027-03-08T09:01:00.000Z', '2026-03-08T08:01:00.000Z', '2026-08-15T12:00:00.000Z');
  });

  it('does not move the cutoff backward during the second fall-back hour', () => {
    const visitAt = visit(new Date('2026-05-01T06:30:00.000Z'));
    expect(redemptionCooldownReason(RESTAURANT, [visitAt], new Date('2026-11-01T06:29:00.000Z'))).toBe(
      'recent_visit_6m',
    );
    for (const nowIso of ['2026-11-01T06:31:00.000Z', '2026-11-01T07:29:00.000Z', '2026-11-01T07:31:00.000Z']) {
      expect(redemptionCooldownReason(RESTAURANT, [visitAt], new Date(nowIso))).toBeNull();
    }
    expectSixMonthCutoff('2026-11-01T07:29:00.000Z', '2026-05-01T06:59:59.999Z');
    expectSixMonthCutoff('2026-11-01T08:01:00.000Z', '2026-05-01T07:01:00.000Z');
    expect(subMonthsChicago(new Date('2026-11-01T07:29:00.000Z'), 12).toISOString()).toBe(
      '2025-11-01T06:59:59.999Z',
    );
  });

  it('uses the earlier occurrence when the cutoff itself falls in a repeated hour', () => {
    expect(subMonthsChicago(new Date('2027-05-01T06:30:00.000Z'), 6).toISOString()).toBe(
      '2026-11-01T06:30:00.000Z',
    );
    expect(subMonthsChicago(new Date('2026-11-02T07:30:00.000Z'), 12).toISOString()).toBe(
      '2025-11-02T06:30:00.000Z',
    );
    expectSixMonthCutoff('2027-05-01T06:30:00.000Z', '2026-11-01T06:30:00.000Z');
    expectTwelveMonthCutoff('2026-11-02T07:30:00.000Z', '2025-11-02T06:30:00.000Z', '2026-02-02T12:00:00.000Z');
  });

  it('keeps six- and twelve-month cutoffs monotonic around the spring and autumn transitions', () => {
    expectMonotonic('2026-09-08T05:30:00.000Z', 210, 6);
    expectMonotonic('2026-11-01T05:30:00.000Z', 210, 6);
    expectMonotonic('2027-03-08T06:30:00.000Z', 210, 12);
    expectMonotonic('2026-11-01T05:30:00.000Z', 210, 12);
    expectMonotonic('2027-05-01T05:30:00.000Z', 180, 6);
    expectMonotonic('2026-11-02T05:30:00.000Z', 180, 12);
  });

  it('still clamps month-end and leap day, including a backward month-end step', () => {
    expect(subMonthsChicago(new Date('2027-03-31T15:00:00.000Z'), 12).toISOString()).toBe(
      '2026-03-31T15:00:00.000Z',
    );
    expect(subMonthsChicago(new Date('2028-02-29T15:00:00.000Z'), 12).toISOString()).toBe(
      '2027-02-28T15:00:00.000Z',
    );
    const march30Late = subMonthsChicago(new Date('2026-03-31T04:00:00.000Z'), 1);
    const march31Early = subMonthsChicago(new Date('2026-03-31T05:00:00.000Z'), 1);
    expect(march30Late.toISOString()).toBe('2026-03-01T05:00:00.000Z');
    expect(march31Early.toISOString()).toBe('2026-02-28T06:00:00.000Z');
    expect(march31Early.getTime()).toBeLessThan(march30Late.getTime());
  });
});

describe('cooldown call sites', () => {
  const swap = source('src/app/actions/swap-challenge.ts');
  const credits = between(
    swap,
    'async function swapLinkedCreditItem',
    'Swap one challenge item for a new restaurant.',
  );
  const legacy = swap.slice(swap.indexOf('export async function swapChallengeItem'));
  const generate = source('src/lib/challenges/generate.ts');

  it('routes both swap passesHard filters through redemptionCooldownOk', () => {
    expect(swap).not.toContain('subYears');
    for (const body of [credits, legacy]) {
      const hard = between(body, 'passesHard:', 'passesVariety:');
      expect(hard).toContain('redemptionCooldownOk(restaurant.id, redemptions, now)');
      expect(hard).not.toContain('subYears');
      expect(hard).not.toContain('subMonths');
      expect(hard).not.toContain('twelveMonthsAgo');
    }
    expect(legacy).toContain('startOfMonth(now)');
    expect(legacy).not.toContain('chicagoMonthStart');
  });

  it('takes both variety bounds from varietyCycleMonthLowerBound', () => {
    const safety = source('src/lib/challenges/restaurant-safety.ts');
    expect(generate).not.toContain('subYears');
    expect(safety.match(/function varietyCycleMonthLowerBound/g)).toHaveLength(1);
    expect(generate.match(/varietyCycleMonthLowerBound\(now, 6\)/g)).toHaveLength(1);
    expect(generate.match(/varietyCycleMonthLowerBound\(now, 12\)/g)).toHaveLength(1);
    expect(generate).not.toMatch(/varietyCycleMonthLowerBound\(now\)/);
    expect(generate).not.toContain('year * 12');
    expect(generate).not.toContain('format(sixMonthsAgo');
    expect(generate).not.toContain('const sixMonthsAgo');

    const cycles6 = between(generate, 'const { data: cyclesLast6 }', 'const cycles6Ids');
    const cycles12 = between(generate, 'const { data: cyclesLast12 }', 'const cycles12Ids');
    expect(cycles6).toContain(".gte('cycle_month', sixMonthVarietyStart)");
    expect(cycles12).toContain(".gte('cycle_month', twelveMonthVarietyStart)");
    for (const cycles of [cycles6, cycles12]) {
      expect(cycles).toContain(".lt('cycle_month', chicagoMonthStart(now))");
      expect(cycles).not.toContain('subYears');
      expect(cycles).not.toContain('subMonths');
      expect(cycles).not.toContain('format(');
    }
    expect(generate).toContain('chicagoMonthStart(now)');
    expect(generate).toContain('format(startOfMonth(now),');
  });
});

describe('redemptionCooldownReason', () => {
  const now = new Date('2026-10-15T15:00:00.000Z');

  it('keeps every boolean from redemptionCooldownOk', () => {
    const rows: CooldownRedemption[][] = [
      [visit(subMonths(now, 13))],
      [visit(subMonths(now, 13)), visit(subMonths(now, 14))],
      [visit(subMonths(now, 7)), visit(subMonths(now, 11))],
      [visit(subMonths(now, 8))],
      [visit(subMonths(now, 12)), visit(subMonths(now, 8))],
      [visit(new Date(subMonths(now, 12).getTime() - 1)), visit(subMonths(now, 8))],
    ];
    for (const redemptions of rows) {
      expect(redemptionCooldownOk(RESTAURANT, redemptions, now)).toBe(
        redemptionCooldownReason(RESTAURANT, redemptions, now) === null,
      );
    }
    expect(source('src/lib/challenges/restaurant-safety.ts')).toContain(
      'return redemptionCooldownReason(restaurantId, redemptions, now) === null',
    );
  });

  it('returns recent_visit_6m and two_in_12m for matching rows', () => {
    expect(redemptionCooldownReason(RESTAURANT, [visit(subMonths(now, 3))], now)).toBe(
      'recent_visit_6m',
    );
    expect(
      redemptionCooldownReason(RESTAURANT, [visit(subMonths(now, 7)), visit(subMonths(now, 11))], now),
    ).toBe('two_in_12m');
    expect(redemptionCooldownReason(RESTAURANT, [visit(subMonths(now, 13))], now)).toBeNull();
    expect(
      redemptionCooldownReason(
        RESTAURANT,
        [visit(subMonths(now, 3)), visit(subMonths(now, 8))],
        now,
      ),
    ).toBe('recent_visit_6m');
  });

  it('keeps a May score stable across the November and February boundaries', () => {
    const now = new Date('2026-05-15T18:00:00.000Z');
    const november = new Date('2025-11-15T18:30:00.000Z');
    const august = new Date('2025-08-15T18:00:00.000Z');
    const february = new Date('2025-02-15T18:00:00.000Z');
    const onSixMonthCutoff = new Date('2025-11-15T19:00:00.000Z');
    const justBeforeSix = new Date(onSixMonthCutoff.getTime() - 1);

    expect(redemptionCooldownReason(RESTAURANT, [visit(november)], now)).toBeNull();
    expect(redemptionCooldownOk(RESTAURANT, [visit(november)], now)).toBe(
      redemptionCooldownReason(RESTAURANT, [visit(november)], now) === null,
    );
    expect(redemptionCooldownReason(RESTAURANT, [visit(november), visit(august)], now)).toBe(
      'two_in_12m',
    );
    expect(redemptionCooldownOk(RESTAURANT, [visit(november), visit(august)], now)).toBe(false);
    expect(redemptionCooldownReason(RESTAURANT, [visit(november), visit(february)], now)).toBeNull();
    expect(redemptionCooldownReason(RESTAURANT, [visit(onSixMonthCutoff)], now)).toBe(
      'recent_visit_6m',
    );
    expect(redemptionCooldownReason(RESTAURANT, [visit(justBeforeSix)], now)).toBeNull();
  });
});
