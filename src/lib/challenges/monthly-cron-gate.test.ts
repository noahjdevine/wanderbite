import { readFileSync } from 'node:fs';
import path from 'node:path';
import { format, startOfMonth } from 'date-fns';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cycleMonthForWorkflow } from '@/lib/challenges/challenge-deadline';
import { chicagoMonthStart } from '@/lib/cron-period';
import {
  cronRevealGate,
  decideMonthlyIssue,
  memberShowsMonthlyCuration,
  monthlyCronSkip,
  showsMonthlyCuration,
} from '@/lib/challenges/monthly-cron-gate';

const ROOT = path.resolve(__dirname, '../../..');

const months: string[] = [];
const state = {
  profile: {
    data: null as Record<string, unknown> | null,
    error: null as { message: string } | null,
  },
  cycle: {
    data: null as { id: string } | null,
    error: null as { message: string } | null,
  },
};

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      const api = {
        select() {
          return api;
        },
        eq(column: string, value: string) {
          if (table === 'challenge_cycles' && column === 'cycle_month') months.push(value);
          return api;
        },
        maybeSingle() {
          if (table === 'user_profiles') return Promise.resolve(state.profile);
          return Promise.resolve(state.cycle);
        },
      };
      return api;
    },
  }),
}));

const ELIGIBLE = {
  workflow_version: 'legacy',
  address: null,
  address_street: '100 E Louisiana St',
  address_city: 'McKinney',
  address_state: 'TX',
  address_zip: '75071',
};

describe('monthly cron gate', () => {
  beforeEach(() => {
    months.length = 0;
    state.profile = { data: ELIGIBLE, error: null };
    state.cycle = { data: null, error: null };
  });

  it('uses the challenges-page rule for who can curate', () => {
    expect(
      showsMonthlyCuration({ launchEligible: true, creditsWorkflow: false, hasCurrentPair: false }),
    ).toBe(true);
    expect(
      showsMonthlyCuration({ launchEligible: true, creditsWorkflow: true, hasCurrentPair: false }),
    ).toBe(false);
    expect(
      showsMonthlyCuration({ launchEligible: false, creditsWorkflow: false, hasCurrentPair: false }),
    ).toBe(false);
    expect(
      showsMonthlyCuration({ launchEligible: true, creditsWorkflow: false, hasCurrentPair: true }),
    ).toBe(false);
  });

  it('issues exactly as main when the flag is off', () => {
    expect(cronRevealGate('off')).toBe('off');
    expect(cronRevealGate('missing')).toBe('off');
    expect(decideMonthlyIssue({ gate: 'off', showsCuration: true })).toEqual({ action: 'generate' });
    expect(decideMonthlyIssue({ gate: 'skip', showsCuration: false })).toEqual({ action: 'generate' });
  });

  it('skips a curation-eligible member when the schema is available', () => {
    expect(cronRevealGate('available')).toBe('skip');
    expect(decideMonthlyIssue({ gate: 'skip', showsCuration: true })).toEqual({
      action: 'skip',
      bucket: 'curation',
    });
  });

  it('counts a non-schema failure as skipped_unknown and does not generate', () => {
    expect(cronRevealGate('unknown')).toBe('unknown');
    expect(decideMonthlyIssue({ gate: 'unknown', showsCuration: true })).toEqual({
      action: 'skip',
      bucket: 'unknown',
    });
    expect(decideMonthlyIssue({ gate: 'unknown', showsCuration: false })).toEqual({ action: 'generate' });
  });

  it('keeps November at 23:30 Chicago and opens December at 00:01 Chicago', async () => {
    const stillNovember = new Date('2026-12-01T05:30:00.000Z');
    const decemberOpen = new Date('2026-12-01T06:01:00.000Z');
    expect(chicagoMonthStart(stillNovember)).toBe('2026-11-01');
    expect(chicagoMonthStart(decemberOpen)).toBe('2026-12-01');
    const earlyLegacy = format(startOfMonth(stillNovember), 'yyyy-MM-dd');
    const openLegacy = format(startOfMonth(decemberOpen), 'yyyy-MM-dd');
    expect(cycleMonthForWorkflow('legacy', stillNovember)).toBe(earlyLegacy);
    expect(cycleMonthForWorkflow('legacy', decemberOpen)).toBe(openLegacy);
    expect(cycleMonthForWorkflow('credits', stillNovember)).toBe('2026-11-01');
    expect(cycleMonthForWorkflow('credits', decemberOpen)).toBe('2026-12-01');

    const early = await memberShowsMonthlyCuration('user-1', stillNovember);
    const open = await memberShowsMonthlyCuration('user-1', decemberOpen);
    expect(early).toBe(true);
    expect(open).toBe(true);
    expect(months).toEqual([earlyLegacy, openLegacy]);
    expect(await monthlyCronSkip('user-1', 'skip', stillNovember)).toEqual({
      action: 'skip',
      bucket: 'curation',
    });
    expect(await monthlyCronSkip('user-1', 'unknown', decemberOpen)).toEqual({
      action: 'skip',
      bucket: 'unknown',
    });
  });

  it('still generates for a credits member and for someone outside the launch area', async () => {
    state.profile = {
      data: { ...ELIGIBLE, workflow_version: 'credits' },
      error: null,
    };
    expect(await monthlyCronSkip('user-1', 'skip', new Date('2026-12-01T06:01:00.000Z'))).toEqual({
      action: 'generate',
    });
    state.profile = {
      data: { ...ELIGIBLE, address_state: 'CA', address_zip: '94107' },
      error: null,
    };
    expect(await monthlyCronSkip('user-1', 'skip')).toEqual({ action: 'generate' });
  });

  it('does not read the database when the gate is off', async () => {
    state.profile = { data: null, error: { message: 'should not be read' } };
    expect(await monthlyCronSkip('user-1', 'off')).toEqual({ action: 'generate' });
    expect(months).toEqual([]);
  });

  it('skips as unknown when the profile read fails', async () => {
    state.profile = { data: null, error: { message: 'network timeout' } };
    expect(await monthlyCronSkip('user-1', 'skip')).toEqual({ action: 'skip', bucket: 'unknown' });
  });

  it('wires both monthly crons through the shared skip and keeps the summary numeric', () => {
    const monthly = readFileSync(path.join(ROOT, 'src/app/api/cron/issue-monthly-challenges/route.ts'), 'utf8');
    const versioned = readFileSync(
      path.join(ROOT, 'src/app/api/cron/issue-version-bound-challenges/route.ts'),
      'utf8',
    );
    for (const source of [monthly, versioned]) {
      expect(source).toContain('monthlyCronSkip');
      expect(source).toContain('issueItemStatus(result)');
      expect(source).toContain('generateMonthlyChallengeForUser');
      expect(source).toContain('skipped_curation:');
      expect(source).toContain('skipped_unknown:');
      expect(source).not.toContain('skippedUserIds');
    }
    expect(monthly).toContain('excludeVersionBound: true');
    expect(versioned).toContain('issue_period_credits');
  });
});
