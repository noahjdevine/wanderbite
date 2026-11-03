import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMonthlyRevealForChallenges, memberGenerateBlocked } from '@/lib/challenges/load-monthly-reveal';
import { resetMonthlyRevealUnavailableLog } from '@/lib/challenges/monthly-reveal-flag';

const tables: string[] = [];

const responses: Record<
  string,
  {
    probe: { data: unknown; error: { code?: string; message?: string } | null };
    row: { data: unknown; error: { code?: string; message?: string } | null };
  }
> = {};

function chain(table: string) {
  const api = {
    select() {
      return api;
    },
    eq() {
      return api;
    },
    limit() {
      return Promise.resolve(responses[table]?.probe ?? { data: [], error: null });
    },
    maybeSingle() {
      return Promise.resolve(responses[table]?.row ?? { data: null, error: null });
    },
  };
  return api;
}

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      tables.push(table);
      return chain(table);
    },
  }),
}));

const THIN_RELATION = {
  data: null,
  error: { code: '42P01', message: 'relation "public.challenge_reveals" does not exist' },
};

const MISSING_FUNCTION = {
  data: null,
  error: {
    code: 'PGRST202',
    message: 'Could not find the function public.reveal_monthly_challenge in the schema cache',
  },
};

describe('loadMonthlyRevealForChallenges', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    tables.length = 0;
    delete process.env.E04_MONTHLY_REVEAL_ENABLED;
    resetMonthlyRevealUnavailableLog();
    responses.challenge_reveals = {
      probe: { data: [], error: null },
      row: { data: null, error: null },
    };
    responses.user_profiles = {
      probe: { data: null, error: null },
      row: {
        data: { dietary_flags: ['vegan'], allergy_flags: [], distance_band: '15_mi' },
        error: null,
      },
    };
    responses.user_preferences = {
      probe: { data: null, error: null },
      row: { data: { excluded_cuisines: ['mexican'] }, error: null },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not read the reveal table when the flag is off', async () => {
    const panel = await loadMonthlyRevealForChallenges({
      userId: 'user-1',
      cycleMonth: null,
      showCuration: true,
    });
    expect(panel).toEqual({ mode: 'off' });
    expect(tables).toEqual([]);
  });

  it('falls back to today’s page when the relation is missing', async () => {
    process.env.E04_MONTHLY_REVEAL_ENABLED = 'true';
    responses.challenge_reveals = { probe: THIN_RELATION, row: THIN_RELATION };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = await loadMonthlyRevealForChallenges({
      userId: 'user-1',
      cycleMonth: null,
      showCuration: true,
    });
    const second = await loadMonthlyRevealForChallenges({
      userId: 'user-1',
      cycleMonth: null,
      showCuration: true,
    });
    expect(first).toEqual({ mode: 'off' });
    expect(second).toEqual({ mode: 'off' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('user-1');
    expect(tables).not.toContain('user_profiles');
  });

  it('falls back when the reveal function is missing', async () => {
    process.env.E04_MONTHLY_REVEAL_ENABLED = 'true';
    responses.challenge_reveals = { probe: MISSING_FUNCTION, row: MISSING_FUNCTION };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const panel = await loadMonthlyRevealForChallenges({
      userId: 'user-secret',
      cycleMonth: '2026-11-01',
      showCuration: false,
    });
    expect(panel).toEqual({ mode: 'off' });
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('user-secret');
  });

  it('does not create a cycle when a paid member has no pair', async () => {
    process.env.E04_MONTHLY_REVEAL_ENABLED = 'true';
    const panel = await loadMonthlyRevealForChallenges({
      userId: 'user-1',
      cycleMonth: null,
      showCuration: true,
    });
    expect(await memberGenerateBlocked()).toBe(true);
    expect(panel.mode).toBe('curation');
    if (panel.mode !== 'curation') return;
    expect(panel.constraintLines.join(' ')).toContain('15 miles');
    expect(panel.constraintLines.join(' ')).toContain('Vegan');
    expect(tables).not.toContain('challenge_cycles');
  });

  it('loads saved reasons for the November period without a new reveal', async () => {
    process.env.E04_MONTHLY_REVEAL_ENABLED = 'true';
    responses.challenge_reveals.row = {
      data: {
        item_reasons: [
          { restaurant_id: 'alpha', text: 'Saved Alpha' },
          { restaurant_id: 'beta', text: 'Saved Beta' },
        ],
      },
      error: null,
    };
    const panel = await loadMonthlyRevealForChallenges({
      userId: 'user-1',
      cycleMonth: '2026-11-01',
      showCuration: false,
    });
    expect(panel).toEqual({
      mode: 'revealed',
      reasons: [
        { restaurantId: 'alpha', text: 'Saved Alpha' },
        { restaurantId: 'beta', text: 'Saved Beta' },
      ],
    });
    expect(tables).not.toContain('user_profiles');
  });

  it('asks the member to try again on a non-schema read error and keeps generate blocked', async () => {
    process.env.E04_MONTHLY_REVEAL_ENABLED = 'true';
    responses.challenge_reveals = {
      probe: { data: null, error: { code: '500', message: 'upstream connect error' } },
      row: { data: null, error: { code: '500', message: 'upstream connect error' } },
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const panel = await loadMonthlyRevealForChallenges({
      userId: 'user-secret',
      cycleMonth: null,
      showCuration: true,
    });
    expect(panel).toEqual({ mode: 'retry' });
    expect(await memberGenerateBlocked()).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('try again');
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('user-secret');
    expect(tables).not.toContain('user_profiles');
  });

  it('does not block generate when the reveal relation is missing', async () => {
    process.env.E04_MONTHLY_REVEAL_ENABLED = 'true';
    responses.challenge_reveals = { probe: THIN_RELATION, row: THIN_RELATION };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await memberGenerateBlocked()).toBe(false);
  });
});
