import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROGRESS_UNAVAILABLE_MESSAGE } from '@/lib/progress/rules';
import { summarizeMemberProgression } from '@/lib/progression/read-model';

const serverClient = { kind: 'request-scoped' };

const state = vi.hoisted(() => ({
  xp: 3600,
  fail: false,
}));

const { loadMemberProgression, createClient } = vi.hoisted(() => ({
  loadMemberProgression: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return {
                    data: {
                      id: 'user-1',
                      full_name: 'Ada',
                      workflow_version: 'legacy',
                      address: null,
                      address_street: null,
                      address_city: null,
                      address_state: null,
                      address_zip: null,
                    },
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
  }),
}));

vi.mock('@/lib/progress/get-member-progress', () => ({
  getMemberProgress: async () => {
    if (state.fail) return { error: 'progress_unavailable' as const };
    return {
      verifiedVisits: state.xp / 100,
      pendingVisits: 0,
      uniqueRestaurants: 1,
      neighborhoods: 1,
      currentMonthlyStreak: 0,
      longestStreak: 0,
      totalMonthsActive: 0,
      xp: state.xp,
      level: 4,
      nextLevel: null,
      badges: [],
      savings: { amount: 0, isEstimate: true, corrected: false },
    };
  },
}));

vi.mock('@/lib/progress/load-progress-activity', () => ({
  loadProgressActivity: async () => ({ ok: true, hasPair: false, adventures: [] }),
}));

vi.mock('@/lib/recipes/load', () => ({
  loadSavedRecipes: async () => ({ enabled: false }),
}));

vi.mock('@/lib/challenges/load-monthly-reveal', () => ({
  memberGenerateBlocked: async () => false,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClient(),
}));

vi.mock('@/lib/progression/member-progression', () => ({
  loadMemberProgression: (...args: unknown[]) => loadMemberProgression(...args),
}));

import { JourneyContent } from '@/components/journey/journey-content';

function events(count: number): Record<string, string>[] {
  return Array.from({ length: count }, () => ({
    schedule_version: 'v1',
    source_kind: 'verified_visit',
  }));
}

const legend = summarizeMemberProgression({
  events: events(36),
  milestones: [1, 2, 3, 4, 5].map((level) => ({
    id: `m${level}`,
    milestone_key: `v1:level:${level}`,
    schedule_version: 'v1',
    level,
    reached_at: level === 4 ? '2027-01-01T05:30:00.000Z' : '2027-01-15T18:00:00.000Z',
    quarter_key: level === 4 ? '2026-Q4' : '2027-Q1',
  })),
  entries: [{ milestone_id: 'm5', quarter_key: '2027-Q1', entry_source: 'level_milestone' }],
});

async function page() {
  return JourneyContent({ userId: 'user-1' });
}

describe('JourneyContent member progression panel', () => {
  beforeEach(() => {
    state.xp = 3600;
    state.fail = false;
    delete process.env.E09_MEMBER_PROGRESSION_UI_ENABLED;
    loadMemberProgression.mockReset();
    createClient.mockReset();
    createClient.mockResolvedValue(serverClient);
    loadMemberProgression.mockResolvedValue({
      ok: true,
      summary: { ...legend, consistent: false, ignored: { events: 97, milestones: 98, entries: 99 } },
    });
  });

  afterEach(() => {
    cleanup();
    delete process.env.E09_MEMBER_PROGRESSION_UI_ENABLED;
  });

  it('leaves Progress unchanged and does not read the ledger when the flag is not exactly true', async () => {
    for (const value of [undefined, '', 'True', 'TRUE', '1'] as const) {
      loadMemberProgression.mockClear();
      createClient.mockClear();
      if (value === undefined) delete process.env.E09_MEMBER_PROGRESSION_UI_ENABLED;
      else process.env.E09_MEMBER_PROGRESSION_UI_ENABLED = value;

      const view = render(await page());
      expect(screen.getByRole('button', { name: /Road to Local Legend/ })).toBeTruthy();
      expect(screen.getByText('Level 4 · The Local Legend')).toBeTruthy();
      expect(screen.getAllByText('Max level').length).toBeGreaterThan(0);
      expect(screen.queryByRole('heading', { name: 'Levels and drawing entries' })).toBeNull();
      expect(screen.queryByText('The Local Legend II')).toBeNull();
      expect(loadMemberProgression).not.toHaveBeenCalled();
      expect(createClient).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it('does not read the ledger when the flag is off and Progress itself fails', async () => {
    state.fail = true;
    render(await page());
    expect(screen.getByText(PROGRESS_UNAVAILABLE_MESSAGE)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Levels and drawing entries' })).toBeNull();
    expect(loadMemberProgression).not.toHaveBeenCalled();
  });

  it('shows the stored continuing level beside the unchanged main card', async () => {
    process.env.E09_MEMBER_PROGRESSION_UI_ENABLED = 'true';
    render(await page());
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(loadMemberProgression).toHaveBeenCalledTimes(1);
    expect(loadMemberProgression).toHaveBeenCalledWith(serverClient);
    expect(screen.getAllByText('Level 4 · The Local Legend').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Max level').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Levels and drawing entries' })).toBeTruthy();
    expect(screen.getByText('The Local Legend II')).toBeTruthy();
    expect(screen.getAllByText('3600 XP').length).toBeGreaterThan(0);
    expect(screen.getByText('Next level: The Local Legend III at 4500 XP')).toBeTruthy();
    expect(screen.getByText('Reached Dec 31, 2026')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/consistent|ignored/i);
    expect(document.body.textContent).not.toContain('97');
  });

  it('shows the load message and the rest of Progress when the ledger cannot be read', async () => {
    process.env.E09_MEMBER_PROGRESSION_UI_ENABLED = 'true';
    loadMemberProgression.mockResolvedValue({ ok: false, error: 'unavailable' });
    render(await page());
    expect(screen.getByRole('status').textContent).toBe("Couldn't load your levels right now");
    expect(screen.getByRole('heading', { name: 'Badges' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Monthly streak' })).toBeTruthy();
    expect(screen.getByText('Level 4 · The Local Legend')).toBeTruthy();
    expect(screen.queryByRole('progressbar', { name: /toward The Local Legend III/ })).toBeNull();
  });

  it('adds nothing when the loader reports signed out', async () => {
    process.env.E09_MEMBER_PROGRESSION_UI_ENABLED = 'true';
    loadMemberProgression.mockResolvedValue({ ok: false, error: 'signed_out' });
    render(await page());
    expect(screen.queryByRole('heading', { name: 'Levels and drawing entries' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Badges' })).toBeTruthy();
    expect(screen.queryByText("Couldn't load your levels right now")).toBeNull();
  });

  it('does not show or log a thrown member id, email, or token', async () => {
    process.env.E09_MEMBER_PROGRESSION_UI_ENABLED = 'true';
    const secret = 'member-a@example.com bearer-token-secret';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    loadMemberProgression.mockRejectedValue(new Error(secret));
    render(await page());
    expect(screen.getByRole('status').textContent).toBe("Couldn't load your levels right now");
    expect(document.body.textContent).not.toContain(secret);
    expect(document.body.textContent).not.toContain('member-a@example.com');
    const logged = errorSpy.mock.calls.flat().map((part) => String(part)).join('\n');
    expect(logged).not.toContain(secret);
    expect(logged).not.toContain('member-a@example.com');
    errorSpy.mockRestore();
  });
});
