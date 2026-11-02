import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { chicagoMonthStart } from '@/lib/cron-period';
import {
  bucketsIntersectingDeadline,
  chicagoMidnight,
  shiftMonthStart,
} from '@/lib/challenges/supply-simulation-lifecycle';
import {
  assignmentDeadline,
  passesVersionCapacityPrefilter,
  versionCapacityBuckets,
  versionHasCapacity,
  versionSelectable,
  type VersionCapacityFields,
} from '@/lib/offers/version-capacity';

const ROOT = path.resolve(__dirname, '../../..');
const HOURS_840 = 840 * 60 * 60 * 1000;
const NOW = new Date('2026-10-20T15:00:00.000Z');
const NOV_EVE = new Date('2026-11-01T03:00:00.000Z');
const CHICAGO = 'America/Chicago';

function plus840(at: Date): Date {
  return new Date(at.getTime() + HOURS_840);
}

function legacyChicagoBuckets(assignedAt: Date, deadline: Date): string[] {
  let month = chicagoMonthStart(assignedAt);
  const buckets: string[] = [];
  for (let step = 0; step < 8; step += 1) {
    const monthStart = chicagoMidnight(month);
    if (monthStart.getTime() >= deadline.getTime()) break;
    const next = shiftMonthStart(month, 1);
    if (chicagoMidnight(next).getTime() > assignedAt.getTime()) buckets.push(month);
    month = next;
  }
  return buckets;
}

function openVersion(overrides: Partial<VersionCapacityFields> = {}): VersionCapacityFields {
  return {
    id: 'v1',
    restaurant_id: 'r1',
    valid_from: '2026-01-01T00:00:00.000Z',
    valid_until: new Date(assignmentDeadline(NOW).getTime() + 1).toISOString(),
    withdrawn_from_selection_at: null,
    capacity_timezone: CHICAGO,
    capacity_max_redemptions: 2,
    ...overrides,
  };
}

describe('versionCapacityBuckets', () => {
  it('uses the version timezone, including the Chicago November fall-back', () => {
    expect(versionCapacityBuckets(NOW, plus840(NOW), CHICAGO)).toEqual(['2026-10-01', '2026-11-01']);

    const chicagoEve = versionCapacityBuckets(NOV_EVE, plus840(NOV_EVE), CHICAGO);
    expect(chicagoEve[0]).toBe('2026-10-01');
    expect(chicagoEve).toEqual(['2026-10-01', '2026-11-01', '2026-12-01']);

    expect(versionCapacityBuckets(NOW, new Date('2026-11-01T04:59:59.999Z'), CHICAGO)).toEqual([
      '2026-10-01',
    ]);
    expect(versionCapacityBuckets(NOW, new Date('2026-11-01T05:00:00.000Z'), CHICAGO)).toEqual([
      '2026-10-01',
    ]);
    expect(versionCapacityBuckets(NOW, new Date('2026-11-01T05:00:00.001Z'), CHICAGO)).toEqual([
      '2026-10-01',
      '2026-11-01',
    ]);
    expect(versionCapacityBuckets(NOW, new Date('2026-12-01T06:00:00.000Z'), CHICAGO)).toEqual([
      '2026-10-01',
      '2026-11-01',
    ]);
    expect(versionCapacityBuckets(NOW, new Date('2026-12-01T06:00:00.001Z'), CHICAGO)).toEqual([
      '2026-10-01',
      '2026-11-01',
      '2026-12-01',
    ]);

    expect(versionCapacityBuckets(NOV_EVE, plus840(NOV_EVE), 'UTC')).toEqual([
      '2026-11-01',
      '2026-12-01',
    ]);
  });

  it('matches the previous Chicago supply-gate bucket loop', () => {
    const windows = [
      [NOW, plus840(NOW)],
      [NOV_EVE, plus840(NOV_EVE)],
      [new Date('2026-01-31T18:00:00.000Z'), plus840(new Date('2026-01-31T18:00:00.000Z'))],
      [NOW, new Date('2026-11-01T05:00:00.000Z')],
      [NOW, new Date('2026-11-01T05:00:00.001Z')],
    ] as const;
    for (const [assignedAt, deadline] of windows) {
      expect(versionCapacityBuckets(assignedAt, deadline, CHICAGO)).toEqual(
        legacyChicagoBuckets(assignedAt, deadline),
      );
      expect(bucketsIntersectingDeadline(assignedAt, deadline)).toEqual(
        versionCapacityBuckets(assignedAt, deadline, CHICAGO),
      );
    }
  });

  it('is unchanged under TZ=UTC and TZ=America/Chicago', () => {
    const tsx = path.join(
      ROOT,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
    );
    const run = (tz: string) => {
      const result = spawnSync(tsx, ['src/lib/offers/version-capacity.tz-probe.ts'], {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, TZ: tz },
      });
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout) as {
        buckets: { name: string; buckets: string[] }[];
        selectable: Record<string, boolean>;
      };
    };
    const utc = run('UTC');
    const chicago = run('America/Chicago');
    expect(chicago.buckets).toEqual(utc.buckets);
    expect(chicago.selectable).toEqual(utc.selectable);
    expect(utc.buckets).toEqual([
      { name: 'oct-20-chicago', buckets: ['2026-10-01', '2026-11-01'] },
      { name: 'nov-1-03z-chicago', buckets: ['2026-10-01', '2026-11-01', '2026-12-01'] },
      { name: 'deadline-1ms-before-chicago-nov', buckets: ['2026-10-01'] },
      { name: 'deadline-at-chicago-nov', buckets: ['2026-10-01'] },
      { name: 'deadline-1ms-after-chicago-nov', buckets: ['2026-10-01', '2026-11-01'] },
      { name: 'deadline-at-chicago-dec', buckets: ['2026-10-01', '2026-11-01'] },
      { name: 'deadline-1ms-after-chicago-dec', buckets: ['2026-10-01', '2026-11-01', '2026-12-01'] },
      { name: 'nov-1-03z-utc', buckets: ['2026-11-01', '2026-12-01'] },
    ]);
    expect(utc.selectable).toEqual({
      open: true,
      untilEqualsHorizon: false,
      untilPlus1ms: true,
      withdrawn: false,
      futureFrom: false,
    });
  });
});

describe('versionSelectable', () => {
  const restaurant = { id: 'r1', current_offer_version_id: 'v1' };
  const horizon = assignmentDeadline(NOW);

  it('mirrors version_selection_ok boundaries', () => {
    const open = openVersion();
    expect(versionSelectable(open, NOW, restaurant)).toBe(true);
    expect(
      versionSelectable({ ...open, valid_until: new Date(horizon.getTime() + 1).toISOString() }, NOW, restaurant),
    ).toBe(true);
    expect(versionSelectable({ ...open, valid_until: horizon.toISOString() }, NOW, restaurant)).toBe(false);
    expect(versionSelectable({ ...open, valid_until: NOW.toISOString() }, NOW, restaurant)).toBe(false);
    expect(
      versionSelectable({ ...open, valid_from: new Date(NOW.getTime() + 1).toISOString() }, NOW, restaurant),
    ).toBe(false);
    expect(versionSelectable({ ...open, valid_from: NOW.toISOString() }, NOW, restaurant)).toBe(true);
    expect(
      versionSelectable({ ...open, withdrawn_from_selection_at: NOW.toISOString() }, NOW, restaurant),
    ).toBe(false);
    expect(versionSelectable(open, NOW, { id: 'r1', current_offer_version_id: 'other' })).toBe(false);
    expect(versionSelectable(open, NOW, { id: 'r1', current_offer_version_id: null })).toBe(false);
    expect(versionSelectable({ ...open, restaurant_id: 'other' }, NOW, restaurant)).toBe(false);
  });
});

describe('versionHasCapacity', () => {
  const buckets = ['2026-10-01', '2026-11-01'];

  it('requires every bucket to be strictly under the cap', () => {
    expect(versionHasCapacity(buckets, new Map([['2026-10-01', 1], ['2026-11-01', 1]]), 2)).toBe(true);
    expect(versionHasCapacity(buckets, new Map([['2026-10-01', 2], ['2026-11-01', 0]]), 2)).toBe(false);
    expect(versionHasCapacity(buckets, new Map([['2026-10-01', 0], ['2026-11-01', 2]]), 2)).toBe(false);
    expect(versionHasCapacity(buckets, new Map(), 2)).toBe(true);
    expect(versionHasCapacity([], new Map([['2026-10-01', 9]]), 1)).toBe(true);
  });
});

describe('passesVersionCapacityPrefilter', () => {
  const counts = (october: number, november: number) =>
    new Map<string, number>([
      ['2026-10-01', october],
      ['2026-11-01', november],
    ]);

  function keep(args: {
    id: string;
    currentOfferVersionId: string | null;
    version: VersionCapacityFields | null;
    countsByBucket: ReadonlyMap<string, number>;
  }): boolean {
    return passesVersionCapacityPrefilter({
      restaurantId: args.id,
      currentOfferVersionId: args.currentOfferVersionId,
      version: args.version,
      now: NOW,
      countsByBucket: args.countsByBucket,
    });
  }

  it('drops a full current month, a full later bucket, and unselectable versions before the pick', () => {
    const version = openVersion();
    expect(keep({ id: 'r1', currentOfferVersionId: 'v1', version, countsByBucket: counts(2, 0) })).toBe(
      false,
    );
    expect(keep({ id: 'r1', currentOfferVersionId: 'v1', version, countsByBucket: counts(0, 2) })).toBe(
      false,
    );
    expect(keep({ id: 'r1', currentOfferVersionId: 'v1', version, countsByBucket: counts(1, 1) })).toBe(
      true,
    );
    expect(
      keep({
        id: 'r1',
        currentOfferVersionId: 'v1',
        version: { ...version, withdrawn_from_selection_at: NOW.toISOString() },
        countsByBucket: counts(0, 0),
      }),
    ).toBe(false);
    expect(
      keep({
        id: 'r1',
        currentOfferVersionId: 'v1',
        version: { ...version, valid_from: new Date(NOW.getTime() + 1).toISOString() },
        countsByBucket: counts(0, 0),
      }),
    ).toBe(false);
    expect(
      keep({
        id: 'r1',
        currentOfferVersionId: 'v1',
        version: { ...version, valid_until: assignmentDeadline(NOW).toISOString() },
        countsByBucket: counts(0, 0),
      }),
    ).toBe(false);
    expect(
      keep({
        id: 'r1',
        currentOfferVersionId: 'v1',
        version: {
          ...version,
          valid_until: new Date(assignmentDeadline(NOW).getTime() + 1).toISOString(),
        },
        countsByBucket: counts(1, 1),
      }),
    ).toBe(true);
    expect(
      keep({ id: 'legacy', currentOfferVersionId: null, version: null, countsByBucket: counts(9, 9) }),
    ).toBe(true);

    const candidates = [
      { id: 'full-now', currentOfferVersionId: 'v1' },
      { id: 'full-next', currentOfferVersionId: 'v1' },
      { id: 'open', currentOfferVersionId: 'v1' },
      { id: 'legacy', currentOfferVersionId: null },
    ].filter((restaurant) =>
      keep({
        id: restaurant.id,
        currentOfferVersionId: restaurant.currentOfferVersionId,
        version: restaurant.currentOfferVersionId ? { ...version, restaurant_id: restaurant.id } : null,
        countsByBucket:
          restaurant.id === 'full-now'
            ? counts(2, 0)
            : restaurant.id === 'full-next'
              ? counts(0, 2)
              : counts(1, 1),
      }),
    );
    expect(candidates.map((restaurant) => restaurant.id)).toEqual(['open', 'legacy']);
  });
});

describe('generate.ts version capacity wiring', () => {
  const source = readFileSync(path.join(ROOT, 'src/lib/challenges/generate.ts'), 'utf8');

  it('pre-filters inside passesHard and leaves the capacity_full race path in place', () => {
    const hardAt = source.indexOf('function passesHard');
    const varietyAt = source.indexOf('function passesVariety');
    const poolAt = source.indexOf('selectDistancePool({');
    const hard = source.slice(hardAt, varietyAt);
    expect(hardAt).toBeGreaterThan(-1);
    expect(hardAt).toBeLessThan(poolAt);
    expect(hard).toContain('passesVersionCapacityPrefilter');
    expect(hard).toContain('if (!versionBound && offer)');
    expect(hard).toContain('offer.max_redemptions_per_month');
    expect(source).toContain(".from('capacity_reservations')");
    expect(source).toContain("in('status', ['reserved', 'consumed'])");
    expect(source).toContain('getSupabaseAdmin()');
    expect(source).toContain("generated.outcome === 'capacity_full'");
    expect(source).toContain("fail('capacity_full', 'A restaurant in this pair is at capacity.')");
    expect(source).toContain("fail('thin_pool', THIN_POOL_ERROR)");
  });
});
