import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

function chain(result: QueryResult) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  const passthrough = () => builder;
  for (const method of ['select', 'eq', 'in', 'order', 'not', 'is']) {
    builder[method] = vi.fn(passthrough);
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
  ) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

function mockTables(tables: Record<string, QueryResult>) {
  mutations.length = 0;
  (getSupabaseAdmin as ReturnType<typeof vi.fn>).mockReturnValue({
    from: vi.fn((table: string) => {
      const result = tables[table] ?? { data: [], error: null };
      return chain(result);
    }),
  });
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
