import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { getMemberProgress, presentMemberProgress } from './get-member-progress';
import {
  assembleBadges,
  formatEarnedOn,
  levelFromXp,
  memberHeaderLabel,
  NEUTRAL_MEMBER_HEADER,
} from './rules';

const ROOT = path.resolve(__dirname, '../../..');
const NOV_3 = new Date('2026-11-03T18:00:00.000Z');
const OCT_31_CHICAGO = '2026-11-01T04:30:00.000Z';
const STORED_FIRST_BITE = '2026-09-15T18:00:00.000Z';

type QueryResult = { data: unknown; error: { message: string } | null };

const mutations: string[] = [];
const selects: { table: string; columns: string }[] = [];
const ORIGINAL_ARRIVAL_FLAG = process.env.E07_ARRIVAL_SESSIONS_ENABLED;
const ORIGINAL_VISIT_FLAG = process.env.E07_VISIT_PROBLEMS_ENABLED;

function chain(table: string, resolveResult: (columns: string) => QueryResult) {
  let columns = '';
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  builder.select = vi.fn((cols: string) => {
    columns = String(cols);
    selects.push({ table, columns });
    return builder;
  });
  for (const method of ['eq', 'in', 'order', 'not', 'is']) {
    builder[method] = vi.fn(() => builder);
  }
  for (const method of ['insert', 'update', 'upsert', 'delete']) {
    builder[method] = vi.fn(() => {
      mutations.push(method);
      return builder;
    });
  }
  (builder as { then?: unknown }).then = (
    resolve: (value: QueryResult) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(resolveResult(columns)).then(resolve, reject);
  return builder;
}

function mockTables(
  tables: Record<string, QueryResult>,
  options?: { settlement?: QueryResult; corrections?: QueryResult },
) {
  mutations.length = 0;
  selects.length = 0;
  (getSupabaseAdmin as ReturnType<typeof vi.fn>).mockReturnValue({
    from: vi.fn((table: string) =>
      chain(table, (columns) => {
        if (table === 'redemptions' && columns.includes('settlement_kind')) {
          return options?.settlement ?? { data: [], error: null };
        }
        if (table === 'visit_problem_savings_adjustments') {
          return options?.corrections ?? tables[table] ?? { data: [], error: null };
        }
        return tables[table] ?? { data: [], error: null };
      }),
    ),
  });
}

function settlementSelected(): boolean {
  return selects.some(
    (entry) => entry.table === 'redemptions' && entry.columns.includes('settlement_kind'),
  );
}

function correctionsSelected(): boolean {
  return selects.some((entry) => entry.table === 'visit_problem_savings_adjustments');
}

const CATALOG = [
  {
    id: 'first_bite',
    name: 'First Bite',
    description: 'Verified your first restaurant visit.',
    icon: '🍴',
  },
  {
    id: 'hat_trick',
    name: 'Hat Trick',
    description: 'Verified three restaurant visits.',
    icon: '✨',
  },
  {
    id: 'high_five',
    name: 'High Five',
    description: 'Verified five restaurant visits.',
    icon: '✋',
  },
  {
    id: 'wanderer',
    name: 'The Wanderer',
    description: 'Verified three restaurant visits.',
    icon: '🧭',
  },
];

function tablesFor(args: {
  redemptions: Record<string, unknown>[];
  restaurants?: Record<string, unknown>[];
  userBadges?: Record<string, unknown>[];
  items?: Record<string, unknown>[];
  versions?: Record<string, unknown>[];
  fail?: string;
}): Record<string, QueryResult> {
  const ok = (data: unknown): QueryResult => ({ data, error: null });
  const failed: QueryResult = { data: null, error: { message: 'boom' } };
  return {
    redemptions: args.fail === 'redemptions' ? failed : ok(args.redemptions),
    restaurants: args.fail === 'restaurants' ? failed : ok(args.restaurants ?? []),
    badges: args.fail === 'badges' ? failed : ok(CATALOG),
    user_badges: args.fail === 'user_badges' ? failed : ok(args.userBadges ?? []),
    challenge_items: args.fail === 'challenge_items' ? failed : ok(args.items ?? []),
    offer_versions: args.fail === 'offer_versions' ? failed : ok(args.versions ?? []),
  };
}

describe('progress rules', () => {
  it('uses a first name and never an email', () => {
    expect(memberHeaderLabel('Noah Devine')).toBe('Noah');
    expect(memberHeaderLabel('Ada')).toBe('Ada');
    expect(memberHeaderLabel(null)).toBe(NEUTRAL_MEMBER_HEADER);
    expect(memberHeaderLabel('   ')).toBe(NEUTRAL_MEMBER_HEADER);
    expect(memberHeaderLabel('noah@example.com')).toBe(NEUTRAL_MEMBER_HEADER);
  });

  it('formats the earned date in America/Chicago', () => {
    expect(formatEarnedOn(OCT_31_CHICAGO)).toBe('Earned on Oct 31, 2026');
    expect(formatEarnedOn('2027-01-01T05:30:00.000Z')).toBe('Earned on Dec 31, 2026');
  });

  it('keeps the existing XP thresholds', () => {
    expect(levelFromXp(0)).toMatchObject({
      level: 0,
      name: 'Getting started',
      nextLevel: { level: 1, name: 'The Explorer', xp: 300 },
    });
    expect(levelFromXp(300)).toMatchObject({
      level: 1,
      name: 'The Explorer',
      nextLevel: { level: 2, name: 'The Tastemaker', xp: 1000 },
    });
    expect(levelFromXp(2500).nextLevel).toBeNull();
    expect(levelFromXp(2500).level).toBe(4);
  });

  it('prefers a stored First Bite date and leaves a missing row unread as a write', () => {
    const catalog = CATALOG.filter((badge) => badge.id === 'first_bite' || badge.id === 'hat_trick');
    const stored = assembleBadges({
      catalog,
      awardedAtById: new Map([['first_bite', STORED_FIRST_BITE]]),
      verifiedVisits: 1,
      verifiedAtAsc: [OCT_31_CHICAGO],
    });
    expect(stored.find((badge) => badge.id === 'first_bite')?.earnedAt).toBe(STORED_FIRST_BITE);

    const derived = assembleBadges({
      catalog,
      awardedAtById: new Map(),
      verifiedVisits: 1,
      verifiedAtAsc: [OCT_31_CHICAGO],
    });
    expect(derived.find((badge) => badge.id === 'first_bite')?.earnedAt).toBe(OCT_31_CHICAGO);
    expect(derived.find((badge) => badge.id === 'hat_trick')).toMatchObject({
      earnedAt: null,
      progress: { current: 1, target: 3 },
    });
  });
});

describe('getMemberProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutations.length = 0;
    selects.length = 0;
    delete process.env.E07_ARRIVAL_SESSIONS_ENABLED;
    delete process.env.E07_VISIT_PROBLEMS_ENABLED;
  });

  afterAll(() => {
    if (ORIGINAL_ARRIVAL_FLAG === undefined) delete process.env.E07_ARRIVAL_SESSIONS_ENABLED;
    else process.env.E07_ARRIVAL_SESSIONS_ENABLED = ORIGINAL_ARRIVAL_FLAG;
    if (ORIGINAL_VISIT_FLAG === undefined) delete process.env.E07_VISIT_PROBLEMS_ENABLED;
    else process.env.E07_VISIT_PROBLEMS_ENABLED = ORIGINAL_VISIT_FLAG;
  });

  it('counts a Chicago Sept–Oct streak on Nov 3 and the same longest streak', async () => {
    mockTables(
      tablesFor({
        redemptions: [
          verified('2026-09-15T18:00:00.000Z', 'rest-a'),
          verified(OCT_31_CHICAGO, 'rest-b'),
        ],
        restaurants: [
          { id: 'rest-a', neighborhood: 'Adriatica' },
          { id: 'rest-b', neighborhood: 'Craig Ranch' },
        ],
        userBadges: [{ badge_id: 'first_bite', awarded_at: STORED_FIRST_BITE }],
      }),
    );
    const progress = await getMemberProgress('user-1', NOV_3);
    expect(progress).toMatchObject({
      verifiedVisits: 2,
      pendingVisits: 0,
      uniqueRestaurants: 2,
      neighborhoods: 2,
      currentMonthlyStreak: 2,
      longestStreak: 2,
      xp: 200,
      level: 0,
    });
    if ('error' in progress) throw new Error('expected progress');
    const firstBite = progress.badges.find((badge) => badge.id === 'first_bite');
    expect(firstBite?.earnedAt).toBe(STORED_FIRST_BITE);
    const presented = presentMemberProgress(progress);
    expect(presented.streak.currentStreak).toBe(2);
    expect(presented.streak.longestStreak).toBe(2);
    expect(presented.earnedBadges.find((badge) => badge.id === 'first_bite')?.earnedOn).toBe(
      'Earned on Sep 15, 2026',
    );
    expect(mutations).toEqual([]);
  });

  it('counts an Oct 31 23:30 America/Chicago visit toward October', async () => {
    mockTables(tablesFor({ redemptions: [verified(OCT_31_CHICAGO, 'rest-a')] }));
    const progress = await getMemberProgress('user-1', NOV_3);
    expect(progress).toMatchObject({
      currentMonthlyStreak: 1,
      longestStreak: 1,
      verifiedVisits: 1,
    });
  });

  it('chains December into January', async () => {
    mockTables(
      tablesFor({
        redemptions: [
          verified('2027-01-01T05:30:00.000Z', 'rest-a'),
          verified('2027-01-01T06:30:00.000Z', 'rest-b'),
        ],
      }),
    );
    const progress = await getMemberProgress('user-1', new Date('2027-01-15T18:00:00.000Z'));
    expect(progress).toMatchObject({ currentMonthlyStreak: 2, longestStreak: 2 });
  });

  it('keeps an issued code out of visits and visit badges', async () => {
    mockTables(
      tablesFor({
        redemptions: [
          {
            id: 'issued-1',
            status: 'issued',
            verified_at: null,
            expires_at: '2026-11-10T18:00:00.000Z',
            restaurant_id: 'rest-a',
            challenge_item_id: null,
          },
          {
            id: 'expired-issued',
            status: 'issued',
            verified_at: null,
            expires_at: '2026-11-01T18:00:00.000Z',
            restaurant_id: 'rest-b',
            challenge_item_id: null,
          },
          {
            id: 'expired-row',
            status: 'expired',
            verified_at: null,
            expires_at: '2026-10-01T18:00:00.000Z',
            restaurant_id: 'rest-c',
            challenge_item_id: null,
          },
        ],
      }),
    );
    const progress = await getMemberProgress('user-1', NOV_3);
    expect(progress).toMatchObject({
      verifiedVisits: 0,
      pendingVisits: 1,
      uniqueRestaurants: 0,
      neighborhoods: 0,
      currentMonthlyStreak: 0,
      xp: 0,
      savings: { amount: 0, isEstimate: true },
    });
    if ('error' in progress) throw new Error('expected progress');
    expect(progress.badges.find((badge) => badge.id === 'first_bite')).toMatchObject({
      earnedAt: null,
      progress: { current: 0, target: 1 },
    });
    expect(presentMemberProgress(progress).showFirstBiteLocked).toBe(true);
    expect(settlementSelected()).toBe(false);
  });

  it('does not count a code at expires_at, an expired code, or a swapped issued code', async () => {
    mockTables(
      tablesFor({
        redemptions: [
          {
            id: 'at-now',
            status: 'issued',
            verified_at: null,
            expires_at: NOV_3.toISOString(),
            restaurant_id: 'rest-a',
            challenge_item_id: null,
          },
          {
            id: 'expired-row',
            status: 'expired',
            verified_at: null,
            expires_at: '2026-10-01T18:00:00.000Z',
            restaurant_id: 'rest-b',
            challenge_item_id: null,
          },
          {
            id: 'swapped-code',
            status: 'issued',
            verified_at: null,
            expires_at: '2026-12-01T18:00:00.000Z',
            restaurant_id: 'rest-c',
            challenge_item_id: 'item-swapped',
          },
        ],
        items: [
          {
            id: 'item-swapped',
            offer_version_id: null,
            status: 'swapped_out',
            redemption_deadline: '2026-12-01T18:00:00.000Z',
          },
        ],
      }),
    );
    const progress = await getMemberProgress('user-1', NOV_3);
    expect(progress).toMatchObject({
      verifiedVisits: 0,
      pendingVisits: 0,
      uniqueRestaurants: 0,
      xp: 0,
      currentMonthlyStreak: 0,
      savings: { amount: 0, isEstimate: true },
    });
    if ('error' in progress) throw new Error('expected progress');
    expect(progress.badges.find((badge) => badge.id === 'first_bite')?.earnedAt).toBeNull();
  });

  it('keeps a verified visit after the code clock and the visit window close', async () => {
    mockTables(
      tablesFor({
        redemptions: [
          {
            id: 'verified-late',
            status: 'verified',
            verified_at: '2026-10-02T15:00:00.000Z',
            expires_at: '2026-10-02T16:00:00.000Z',
            restaurant_id: 'rest-a',
            challenge_item_id: 'item-1',
          },
        ],
        restaurants: [{ id: 'rest-a', neighborhood: 'Adriatica' }],
        items: [
          {
            id: 'item-1',
            offer_version_id: null,
            status: 'expired',
            redemption_deadline: '2026-10-03T00:00:00.000Z',
          },
        ],
      }),
    );
    const progress = await getMemberProgress('user-1', NOV_3);
    expect(progress).toMatchObject({
      verifiedVisits: 1,
      pendingVisits: 0,
      xp: 100,
      uniqueRestaurants: 1,
      savings: { amount: 10, isEstimate: true },
    });
  });

  it('counts two verified visits at one restaurant as two visits and one place', async () => {
    mockTables(
      tablesFor({
        redemptions: [
          verified('2026-10-02T15:00:00.000Z', 'rest-a', 'item-1'),
          verified('2026-10-20T15:00:00.000Z', 'rest-a', 'item-2'),
        ],
        restaurants: [{ id: 'rest-a', neighborhood: 'Adriatica' }],
        items: [
          { id: 'item-1', offer_version_id: 'ver-1' },
          { id: 'item-2', offer_version_id: null },
        ],
        versions: [
          {
            id: 'ver-1',
            tiers: [{ threshold_cents: 4000, discount_cents: 1500 }],
          },
        ],
      }),
    );
    const progress = await getMemberProgress('user-1', NOV_3);
    expect(progress).toMatchObject({
      verifiedVisits: 2,
      uniqueRestaurants: 1,
      neighborhoods: 1,
      xp: 200,
      savings: { amount: 25, isEstimate: true },
    });
  });

  it('shows the stored First Bite date when the row exists', async () => {
    mockTables(
      tablesFor({
        redemptions: [verified(OCT_31_CHICAGO, 'rest-a')],
        userBadges: [{ badge_id: 'first_bite', awarded_at: STORED_FIRST_BITE }],
      }),
    );
    const progress = await getMemberProgress('user-1', NOV_3);
    if ('error' in progress) throw new Error('expected progress');
    expect(progress.badges.find((badge) => badge.id === 'first_bite')?.earnedAt).toBe(
      STORED_FIRST_BITE,
    );
    expect(presentMemberProgress(progress).earnedBadges).toEqual([
      expect.objectContaining({
        id: 'first_bite',
        name: 'First Bite',
        earnedOn: 'Earned on Sep 15, 2026',
      }),
    ]);
  });

  it('derives First Bite from the first verified visit when no row is stored', async () => {
    mockTables(tablesFor({ redemptions: [verified(OCT_31_CHICAGO, 'rest-a')] }));
    const progress = await getMemberProgress('user-1', NOV_3);
    if ('error' in progress) throw new Error('expected progress');
    expect(progress.badges.find((badge) => badge.id === 'first_bite')?.earnedAt).toBe(
      OCT_31_CHICAGO,
    );
    expect(mutations).toEqual([]);
  });

  it('returns the error state instead of zeros when a query fails', async () => {
    for (const table of ['redemptions', 'restaurants', 'badges', 'user_badges'] as const) {
      mockTables(
        tablesFor({
          fail: table,
          redemptions: [verified(OCT_31_CHICAGO, 'rest-a')],
          restaurants: [{ id: 'rest-a', neighborhood: 'Adriatica' }],
        }),
      );
      const progress = await getMemberProgress('user-1', NOV_3);
      expect(progress).toEqual({ error: 'progress_unavailable' });
      expect(presentMemberProgress(progress).progressUnavailable).toBe(true);
    }
  });

  it('counts trimmed neighborhood names once and skips blanks', async () => {
    mockTables(
      tablesFor({
        redemptions: [
          verified('2026-09-15T18:00:00.000Z', 'rest-a'),
          verified('2026-10-02T15:00:00.000Z', 'rest-b'),
          verified('2026-10-20T15:00:00.000Z', 'rest-c'),
        ],
        restaurants: [
          { id: 'rest-a', neighborhood: ' Adriatica ' },
          { id: 'rest-b', neighborhood: 'Adriatica' },
          { id: 'rest-c', neighborhood: '   ' },
        ],
      }),
    );
    const progress = await getMemberProgress('user-1', NOV_3);
    expect(progress).toMatchObject({ neighborhoods: 1, uniqueRestaurants: 3, verifiedVisits: 3 });
  });

  it('returns an empty success, not an error, when the member has no rows', async () => {
    mockTables(tablesFor({ redemptions: [] }));
    const progress = await getMemberProgress('user-1', NOV_3);
    expect(progress).toMatchObject({
      verifiedVisits: 0,
      pendingVisits: 0,
      uniqueRestaurants: 0,
      neighborhoods: 0,
      currentMonthlyStreak: 0,
      longestStreak: 0,
      xp: 0,
      savings: { amount: 0, isEstimate: true },
    });
    expect(settlementSelected()).toBe(false);
  });

  it('does not select settlement columns unless the arrival flag is exactly true', async () => {
    const row = verified('2026-10-02T15:00:00.000Z', 'rest-a', 'item-1');
    const tables = tablesFor({
      redemptions: [row],
      restaurants: [{ id: 'rest-a', neighborhood: 'Adriatica' }],
      items: [{ id: 'item-1', offer_version_id: 'ver-1' }],
      versions: [{ id: 'ver-1', tiers: [{ threshold_cents: 4000, discount_cents: 1500 }] }],
    });
    for (const flag of [undefined, '', 'false', 'TRUE'] as const) {
      if (flag === undefined) delete process.env.E07_ARRIVAL_SESSIONS_ENABLED;
      else process.env.E07_ARRIVAL_SESSIONS_ENABLED = flag;
      mockTables(tables, { settlement: { data: [consumeQuoteRow(row.id, 1850)], error: null } });
      const progress = await getMemberProgress('user-1', NOV_3);
      expect(progress).toMatchObject({
        verifiedVisits: 1,
        xp: 100,
        uniqueRestaurants: 1,
        currentMonthlyStreak: 1,
        savings: { amount: 15, isEstimate: true },
      });
      expect(settlementSelected()).toBe(false);
      expect(correctionsSelected()).toBe(false);
    }
  });

  it('counts a stored consume_quote total when the arrival flag is exactly true', async () => {
    process.env.E07_ARRIVAL_SESSIONS_ENABLED = 'true';
    const row = verified('2026-10-02T15:00:00.000Z', 'rest-a', 'item-1');
    mockTables(
      tablesFor({
        redemptions: [row],
        restaurants: [{ id: 'rest-a', neighborhood: 'Adriatica' }],
        items: [{ id: 'item-1', offer_version_id: 'ver-1' }],
        versions: [{ id: 'ver-1', tiers: [{ threshold_cents: 4000, discount_cents: 1500 }] }],
      }),
      { settlement: { data: [consumeQuoteRow(row.id, 1850)], error: null } },
    );
    const progress = await getMemberProgress('user-1', NOV_3);
    expect(progress).toMatchObject({
      verifiedVisits: 1,
      pendingVisits: 0,
      xp: 100,
      level: 0,
      uniqueRestaurants: 1,
      neighborhoods: 1,
      savings: { amount: 18.5, isEstimate: false },
    });
    expect(settlementSelected()).toBe(true);
    expect(mutations).toEqual([]);
  });

  it('counts a stored sealed amount and ignores an issued code', async () => {
    process.env.E07_ARRIVAL_SESSIONS_ENABLED = 'true';
    const visit = verified('2026-10-02T15:00:00.000Z', 'rest-a', 'item-1');
    mockTables(
      tablesFor({
        redemptions: [
          visit,
          {
            id: 'issued-code',
            status: 'issued',
            verified_at: null,
            expires_at: '2026-12-01T18:00:00.000Z',
            restaurant_id: 'rest-b',
            challenge_item_id: null,
          },
        ],
        restaurants: [{ id: 'rest-a', neighborhood: 'Adriatica' }],
        items: [{ id: 'item-1', offer_version_id: 'ver-1' }],
        versions: [{ id: 'ver-1', tiers: [{ threshold_cents: 4000, discount_cents: 1500 }] }],
      }),
      { settlement: { data: [sealedStoredRow(visit.id, 1200)], error: null } },
    );
    const progress = await getMemberProgress('user-1', NOV_3);
    expect(progress).toMatchObject({
      verifiedVisits: 1,
      pendingVisits: 1,
      xp: 100,
      uniqueRestaurants: 1,
      savings: { amount: 12, isEstimate: false },
    });
  });

  it('keeps the estimate when a sealed miss or a missing snapshot uses read-time cents', async () => {
    process.env.E07_ARRIVAL_SESSIONS_ENABLED = 'true';
    const miss = verified('2026-10-02T15:00:00.000Z', 'rest-a', 'item-1');
    const bare = verified('2026-10-20T15:00:00.000Z', 'rest-b', 'item-2');
    mockTables(
      tablesFor({
        redemptions: [miss, bare],
        restaurants: [
          { id: 'rest-a', neighborhood: 'Adriatica' },
          { id: 'rest-b', neighborhood: 'Craig Ranch' },
        ],
        items: [
          { id: 'item-1', offer_version_id: 'ver-1' },
          { id: 'item-2', offer_version_id: null },
        ],
        versions: [{ id: 'ver-1', tiers: [{ threshold_cents: 4000, discount_cents: 1500 }] }],
      }),
      { settlement: { data: [sealedStoredRow(miss.id, null)], error: null } },
    );
    const progress = await getMemberProgress('user-1', NOV_3);
    expect(progress).toMatchObject({
      verifiedVisits: 2,
      uniqueRestaurants: 2,
      xp: 200,
      savings: { amount: 25, isEstimate: true },
    });
  });

  it('drops the estimate only when every verified visit has stored cents', async () => {
    process.env.E07_ARRIVAL_SESSIONS_ENABLED = 'true';
    const quote = verified('2026-10-02T15:00:00.000Z', 'rest-a', 'item-1');
    const sealed = verified('2026-10-20T15:00:00.000Z', 'rest-b', 'item-2');
    mockTables(
      tablesFor({
        redemptions: [quote, sealed],
        restaurants: [
          { id: 'rest-a', neighborhood: 'Adriatica' },
          { id: 'rest-b', neighborhood: 'Craig Ranch' },
        ],
        items: [
          { id: 'item-1', offer_version_id: 'ver-1' },
          { id: 'item-2', offer_version_id: 'ver-1' },
        ],
        versions: [{ id: 'ver-1', tiers: [{ threshold_cents: 4000, discount_cents: 1500 }] }],
      }),
      {
        settlement: {
          data: [consumeQuoteRow(quote.id, 1850), sealedStoredRow(sealed.id, 1200)],
          error: null,
        },
      },
    );
    const progress = await getMemberProgress('user-1', NOV_3);
    expect(progress).toMatchObject({
      verifiedVisits: 2,
      xp: 200,
      uniqueRestaurants: 2,
      currentMonthlyStreak: 1,
      savings: { amount: 30.5, isEstimate: false },
    });
  });

  it('uses the sealed tier when a stored consume_quote row cannot be read', async () => {
    process.env.E07_ARRIVAL_SESSIONS_ENABLED = 'true';
    const row = verified('2026-10-02T15:00:00.000Z', 'rest-a', 'item-1');
    const broken = { ...consumeQuoteRow(row.id, 1850), quote_id: null };
    mockTables(
      tablesFor({
        redemptions: [row],
        restaurants: [{ id: 'rest-a', neighborhood: 'Adriatica' }],
        items: [{ id: 'item-1', offer_version_id: 'ver-1' }],
        versions: [{ id: 'ver-1', tiers: [{ threshold_cents: 4000, discount_cents: 1500 }] }],
      }),
      { settlement: { data: [broken], error: null } },
    );
    const progress = await getMemberProgress('user-1', NOV_3);
    expect(progress).toMatchObject({
      verifiedVisits: 1,
      xp: 100,
      savings: { amount: 15, isEstimate: true },
    });
  });

  it('falls back to today\'s total when the settlement select errors', async () => {
    process.env.E07_ARRIVAL_SESSIONS_ENABLED = 'true';
    const row = verified('2026-10-02T15:00:00.000Z', 'rest-a', 'item-1');
    mockTables(
      tablesFor({
        redemptions: [row],
        restaurants: [{ id: 'rest-a', neighborhood: 'Adriatica' }],
        items: [{ id: 'item-1', offer_version_id: 'ver-1' }],
        versions: [{ id: 'ver-1', tiers: [{ threshold_cents: 4000, discount_cents: 1500 }] }],
      }),
      { settlement: { data: null, error: { message: 'column settlement_kind does not exist' } } },
    );
    const progress = await getMemberProgress('user-1', NOV_3);
    expect(progress).toMatchObject({
      verifiedVisits: 1,
      xp: 100,
      uniqueRestaurants: 1,
      savings: { amount: 15, isEstimate: true },
    });
    expect(settlementSelected()).toBe(true);
  });

  it('keeps the estimate at zero visits when the arrival flag is on', async () => {
    process.env.E07_ARRIVAL_SESSIONS_ENABLED = 'true';
    mockTables(tablesFor({ redemptions: [] }));
    const progress = await getMemberProgress('user-1', NOV_3);
    expect(progress).toMatchObject({
      verifiedVisits: 0,
      xp: 0,
      savings: { amount: 0, isEstimate: true },
    });
    expect(settlementSelected()).toBe(false);
    expect(correctionsSelected()).toBe(false);
  });

  it('does not read savings corrections unless the visit-problem flag is exactly true', async () => {
    const row = verified('2026-10-02T15:00:00.000Z', 'rest-a', 'item-1');
    const tables = tablesFor({
      redemptions: [row],
      restaurants: [{ id: 'rest-a', neighborhood: 'Adriatica' }],
      items: [{ id: 'item-1', offer_version_id: 'ver-1' }],
      versions: [{ id: 'ver-1', tiers: [{ threshold_cents: 4000, discount_cents: 1500 }] }],
    });
    for (const flag of [undefined, '', 'TRUE', '1'] as const) {
      if (flag === undefined) delete process.env.E07_VISIT_PROBLEMS_ENABLED;
      else process.env.E07_VISIT_PROBLEMS_ENABLED = flag;
      mockTables(tables);
      const progress = await getMemberProgress('user-1', NOV_3);
      expect(progress).toMatchObject({
        savings: { amount: 15, isEstimate: true, corrected: false },
      });
      expect(correctionsSelected()).toBe(false);
      expect(mutations).toEqual([]);
    }
  });

  it('shows the corrected cents and marks the savings corrected', async () => {
    process.env.E07_VISIT_PROBLEMS_ENABLED = 'true';
    const row = verified('2026-10-02T15:00:00.000Z', 'rest-a', 'item-1');
    mockTables(
      tablesFor({
        redemptions: [row],
        restaurants: [{ id: 'rest-a', neighborhood: 'Adriatica' }],
        items: [{ id: 'item-1', offer_version_id: 'ver-1' }],
        versions: [{ id: 'ver-1', tiers: [{ threshold_cents: 4000, discount_cents: 1500 }] }],
      }),
      { corrections: { data: [{ redemption_id: row.id, corrected_cents: 2500 }], error: null } },
    );
    const progress = await getMemberProgress('user-1', NOV_3);
    expect(progress).toMatchObject({
      verifiedVisits: 1,
      xp: 100,
      savings: { amount: 25, isEstimate: false, corrected: true },
    });
    expect(correctionsSelected()).toBe(true);
    expect(settlementSelected()).toBe(false);
    expect(mutations).toEqual([]);
  });

  it('prefers the correction over a stored settlement and leaves an uncorrected visit estimated', async () => {
    process.env.E07_ARRIVAL_SESSIONS_ENABLED = 'true';
    process.env.E07_VISIT_PROBLEMS_ENABLED = 'true';
    const corrected = verified('2026-10-02T15:00:00.000Z', 'rest-a', 'item-1');
    const plain = verified('2026-09-02T15:00:00.000Z', 'rest-b', 'item-2');
    mockTables(
      tablesFor({
        redemptions: [corrected, plain],
        restaurants: [
          { id: 'rest-a', neighborhood: 'Adriatica' },
          { id: 'rest-b', neighborhood: 'Craig Ranch' },
        ],
        items: [
          { id: 'item-1', offer_version_id: 'ver-1' },
          { id: 'item-2', offer_version_id: 'ver-2' },
        ],
        versions: [
          { id: 'ver-1', tiers: [{ threshold_cents: 4000, discount_cents: 1500 }] },
          { id: 'ver-2', tiers: [{ threshold_cents: 4000, discount_cents: 1200 }] },
        ],
      }),
      {
        settlement: {
          data: [consumeQuoteRow(corrected.id, 1850), sealedStoredRow(plain.id, 1200)],
          error: null,
        },
        corrections: { data: [{ redemption_id: corrected.id, corrected_cents: 2500 }], error: null },
      },
    );
    const progress = await getMemberProgress('user-1', NOV_3);
    expect(progress).toMatchObject({
      verifiedVisits: 2,
      savings: { amount: 37, isEstimate: false, corrected: true },
    });
  });

  it('keeps the uncorrected total when the correction read fails', async () => {
    process.env.E07_VISIT_PROBLEMS_ENABLED = 'true';
    const row = verified('2026-10-02T15:00:00.000Z', 'rest-a', 'item-1');
    mockTables(
      tablesFor({
        redemptions: [row],
        restaurants: [{ id: 'rest-a', neighborhood: 'Adriatica' }],
        items: [{ id: 'item-1', offer_version_id: 'ver-1' }],
        versions: [{ id: 'ver-1', tiers: [{ threshold_cents: 4000, discount_cents: 1500 }] }],
      }),
      { corrections: { data: null, error: { message: 'relation does not exist' } } },
    );
    const progress = await getMemberProgress('user-1', NOV_3);
    expect(progress).toMatchObject({
      verifiedVisits: 1,
      savings: { amount: 15, isEstimate: true, corrected: false },
    });
    expect(correctionsSelected()).toBe(true);
  });
});

describe('progress page wiring', () => {
  it('reads Journey, Passport, and Challenges from getMemberProgress', () => {
    const journey = source('src/components/journey/journey-content.tsx');
    const progressView = source('src/components/journey/progress-view.tsx');
    const passport = source('src/components/passport/passport-content.tsx');
    const challenges = source('src/app/(site)/challenges/page.tsx');
    const dashboard = source('src/app/(site)/dashboard/page.tsx');
    expect(journey).toContain('getMemberProgress');
    expect(progressView).toContain('PROGRESS_UNAVAILABLE_MESSAGE');
    expect(journey).not.toContain('CURRENT_STREAK_MOCK');
    expect(progressView).not.toContain('CURRENT_STREAK_MOCK');
    expect(journey).not.toContain("select('id, email')");
    expect(passport).toContain('getMemberProgress');
    expect(passport).not.toContain('getStreakBadgeForLongest');
    expect(passport).not.toContain('calculateStreak');
    expect(challenges).toContain('getMemberProgress');
    expect(challenges).not.toContain('calculateStreak');
    expect(dashboard).toContain('getMemberProgress');
    expect(dashboard).not.toContain('calculateStreak');
  });
});

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function verified(verifiedAt: string, restaurantId: string, challengeItemId: string | null = null) {
  return {
    id: `${restaurantId}-${verifiedAt}`,
    status: 'verified',
    verified_at: verifiedAt,
    expires_at: '2026-12-01T00:00:00.000Z',
    restaurant_id: restaurantId,
    challenge_item_id: challengeItemId,
  };
}

function consumeQuoteRow(id: string, totalCents: number) {
  return {
    id,
    settlement_kind: 'consume_quote',
    settled_at: '2026-11-08T18:05:00.000Z',
    quote_id: '22222222-2222-4222-8222-222222222222',
    quote_version: 1,
    base_discount_cents: 1000,
    boost_discount_cents: totalCents - 1000,
    total_discount_cents: totalCents,
    eligible_subtotal_cents: 8000,
    below_minimum: false,
    tier_id: 'threshold:4000',
    boost_id: 'boost-1',
    locked_boost_id: 'boost-1',
    quote_expires_at: '2026-11-08T22:00:00.000Z',
    sealed_discount_amount_cents: null,
    sealed_min_spend_cents: null,
  };
}

function sealedStoredRow(id: string, cents: number | null) {
  return {
    id,
    settlement_kind: 'use_sealed_base',
    settled_at: '2026-11-08T18:05:00.000Z',
    quote_id: null,
    quote_version: null,
    base_discount_cents: null,
    boost_discount_cents: null,
    total_discount_cents: null,
    eligible_subtotal_cents: null,
    below_minimum: null,
    tier_id: null,
    boost_id: null,
    locked_boost_id: null,
    quote_expires_at: null,
    sealed_discount_amount_cents: cents,
    sealed_min_spend_cents: cents == null ? null : 4000,
  };
}
