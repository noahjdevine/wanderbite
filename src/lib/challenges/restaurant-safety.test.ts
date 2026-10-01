import { readFileSync } from 'node:fs';
import path from 'node:path';
import { format, startOfMonth, subMonths } from 'date-fns';
import { describe, expect, it } from 'vitest';
import { chicagoMonthStart } from '@/lib/cron-period';
import {
  passesRestaurantHardFilters,
  redemptionCooldownOk,
  rollingTwelveMonthStart,
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
    expect(format(startOfMonth(early), 'yyyy-MM-dd')).toBe('2026-10-01');
    expect(format(startOfMonth(later), 'yyyy-MM-dd')).toBe('2026-10-01');

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

    for (const iso of ['2026-03-08T09:30:00.000Z', '2026-11-01T08:30:00.000Z']) {
      const dstNow = new Date(iso);
      const cutoff = subMonths(dstNow, 12);
      const before = new Date(cutoff.getTime() - 1);
      expect(rollingTwelveMonthStart(dstNow).toISOString()).toBe(cutoff.toISOString());
      expect(
        redemptionCooldownOk(RESTAURANT, [visit(cutoff), visit(subMonths(dstNow, 8))], dstNow),
      ).toBe(false);
      expect(
        redemptionCooldownOk(RESTAURANT, [visit(before), visit(subMonths(dstNow, 8))], dstNow),
      ).toBe(true);
    }
  });
});

describe('variety cycle_month window', () => {
  function counted(cycleMonth: string, now: Date): boolean {
    return cycleMonth >= varietyCycleMonthLowerBound(now);
  }

  it('uses the same Chicago window on the 1st and mid-month', () => {
    const first = new Date('2026-10-01T05:00:00.000Z');
    const mid = new Date('2026-10-15T15:00:00.000Z');
    expect(chicagoMonthStart(first)).toBe('2026-10-01');
    expect(chicagoMonthStart(mid)).toBe('2026-10-01');
    expect(varietyCycleMonthLowerBound(first)).toBe('2025-11-01');
    expect(varietyCycleMonthLowerBound(mid)).toBe(varietyCycleMonthLowerBound(first));
    expect(counted('2025-10-01', mid)).toBe(false);
    expect(counted('2025-11-01', mid)).toBe(true);
    expect(counted('2025-10-01', first)).toBe(false);
    expect(counted('2025-11-01', first)).toBe(true);

    const january = new Date('2026-01-15T18:00:00.000Z');
    expect(chicagoMonthStart(january)).toBe('2026-01-01');
    expect(varietyCycleMonthLowerBound(january)).toBe('2025-02-01');
    expect(counted('2025-01-01', january)).toBe(false);
    expect(counted('2025-02-01', january)).toBe(true);
  });

  it('stays on the Chicago month when UTC has already entered the next month', () => {
    const lateSeptember = new Date('2026-10-01T00:30:00.000Z');
    expect(chicagoMonthStart(lateSeptember)).toBe('2026-09-01');
    expect(format(startOfMonth(lateSeptember), 'yyyy-MM-dd')).toBe('2026-10-01');
    expect(varietyCycleMonthLowerBound(lateSeptember)).toBe('2025-10-01');
    expect(counted('2025-09-01', lateSeptember)).toBe(false);
    expect(counted('2025-10-01', lateSeptember)).toBe(true);

    const lateOctober = new Date('2026-11-01T04:30:00.000Z');
    expect(chicagoMonthStart(lateOctober)).toBe('2026-10-01');
    expect(format(startOfMonth(lateOctober), 'yyyy-MM-dd')).toBe('2026-11-01');
    expect(varietyCycleMonthLowerBound(lateOctober)).toBe('2025-11-01');
    expect(counted('2025-10-01', lateOctober)).toBe(false);
    expect(counted('2025-11-01', lateOctober)).toBe(true);
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

  it('takes the cyclesLast12 lower bound from the helper', () => {
    expect(generate).not.toContain('subYears');
    expect(generate).toContain('const twelveMonthsAgoStr = varietyCycleMonthLowerBound(now)');
    const cycles = between(generate, 'const { data: cyclesLast12 }', 'const cycles12Ids');
    expect(cycles).toContain(".gte('cycle_month', twelveMonthsAgoStr)");
    expect(cycles).not.toMatch(/\.lt\('cycle_month'/);
    expect(cycles).not.toContain('subYears');
    expect(cycles).not.toContain('subMonths');
    expect(generate).toContain('chicagoMonthStart(now)');
    expect(generate).toContain('format(startOfMonth(now),');
  });
});
