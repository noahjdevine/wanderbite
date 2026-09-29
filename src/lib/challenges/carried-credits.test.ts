import { readFileSync } from 'node:fs';
import path from 'node:path';
import { format, startOfMonth } from 'date-fns';
import { describe, expect, it } from 'vitest';
import { chicagoMonthStart } from '@/lib/cron-period';
import {
  challengeCardExpired,
  compareCarriedCredits,
  cycleMonthForWorkflow,
  effectiveDeadlineAt,
} from '@/lib/challenges/challenge-deadline';
import {
  carriedItemVisibility,
  issuedRedemptionId,
  omitCreditsOnCurrentCycle,
} from '@/lib/challenges/carried-credits';

const ROOT = path.resolve(__dirname, '../../..');

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

describe('carried credit reader', () => {
  it('keeps a redeemed carried item when an issued redemption can show a code', () => {
    const now = new Date('2026-10-15T15:00:00Z');
    const redemptions = [
      {
        id: 'older-code',
        challenge_item_id: 'item-1',
        status: 'issued',
        created_at: '2026-10-01T00:00:00Z',
      },
      {
        id: 'latest-code',
        challenge_item_id: 'item-1',
        status: 'issued',
        created_at: '2026-10-02T00:00:00Z',
      },
      {
        id: 'verified',
        challenge_item_id: 'item-1',
        status: 'verified',
        created_at: '2026-10-03T00:00:00Z',
      },
    ];
    const redemptionId = issuedRedemptionId('item-1', redemptions);
    expect(redemptionId).toBe('latest-code');
    expect(
      carriedItemVisibility(
        { status: 'redeemed', redemption_deadline: '2026-09-01T00:00:00Z' },
        redemptionId,
        now,
      ),
    ).toBe(true);
    expect(
      carriedItemVisibility({ status: 'redeemed', redemption_deadline: null }, null, now),
    ).toBe(false);
    expect(
      carriedItemVisibility(
        { status: 'expired', redemption_deadline: '2026-12-01T00:00:00Z' },
        redemptionId,
        now,
      ),
    ).toBe(false);
    expect(
      carriedItemVisibility({ status: 'swapped_out', redemption_deadline: null }, null, now),
    ).toBe(false);
    expect(
      carriedItemVisibility(
        { status: 'assigned', redemption_deadline: '2026-12-01T00:00:00Z' },
        null,
        now,
      ),
    ).toBe(true);
    expect(
      carriedItemVisibility(
        { status: 'assigned', redemption_deadline: '2026-10-01T00:00:00Z' },
        null,
        now,
      ),
    ).toBe(false);

    const loader = source('src/lib/challenges/carried-credits.ts');
    expect(loader).toContain('issuedRedemptionId');
    expect(loader).toContain('carriedItemVisibility');
    expect(loader).toContain(".in('status', ['pending', 'linked'])");
    expect(loader).toContain(".lt('issue_period', chicagoMonthStart(now))");
    expect(loader).toContain("from('credit_swap_allowances')");
    expect(loader).toContain('omitCreditsOnCurrentCycle');
    expect(omitCreditsOnCurrentCycle(
      [{ creditId: 'on-cycle' }, { creditId: 'carried' }],
      new Set(['on-cycle']),
    )).toEqual([{ creditId: 'carried' }]);
  });

  it('uses the Chicago month for credits cycles and the current-month credit hold', () => {
    const earlyUtc = new Date('2026-10-01T00:05:00.000Z');
    expect(chicagoMonthStart(earlyUtc)).toBe('2026-09-01');
    expect(cycleMonthForWorkflow('credits', earlyUtc)).toBe('2026-09-01');
    expect(cycleMonthForWorkflow('legacy', earlyUtc)).toBe(
      format(startOfMonth(earlyUtc), 'yyyy-MM-dd'),
    );

    const current = between(
      source('src/lib/challenges/generate.ts'),
      'export async function getCurrentChallengeForUser',
      'function shuffle',
    );
    expect(current).toContain('readWorkflowVersion');
    expect(current).toContain('cycleMonthForWorkflow');
    expect(current).not.toContain('startOfMonth');

    const page = source('src/app/(site)/challenges/page.tsx');
    expect(page).toContain(".eq('issue_period', chicagoMonthStart())");
    expect(page).toContain(".eq('status', 'pending')");
    expect(page).toContain('loadCarriedCreditsForUser');
    expect(page).toContain('loadCreditsSwapRemaining');
    expect(page).not.toContain('startOfMonth');
    expect(source('src/app/(site)/dashboard/page.tsx')).toContain('loadCreditsSwapRemaining');
  });

  it('sorts and expires from a live redemption_deadline on an older origin cycle', () => {
    const older = {
      id: 'credit-old',
      issued_at: '2026-01-02T00:00:00.000Z',
      expires_at: '2026-03-01T00:00:00.000Z',
      item: { redemption_deadline: '2026-12-15T00:00:00.000Z' },
    };
    const sooner = {
      id: 'credit-new',
      issued_at: '2026-02-02T00:00:00.000Z',
      expires_at: '2026-04-01T00:00:00.000Z',
      item: { redemption_deadline: '2026-11-01T00:00:00.000Z' },
    };
    expect(effectiveDeadlineAt(older, older.item).toISOString()).toBe('2026-12-15T00:00:00.000Z');
    expect(compareCarriedCredits(sooner, older)).toBeLessThan(0);
    expect(compareCarriedCredits(older, sooner)).toBeGreaterThan(0);

    const now = new Date('2026-10-15T12:00:00.000Z');
    const cycleCreatedAt = '2026-08-01T00:00:00.000Z';
    expect(
      challengeCardExpired({
        now,
        cycleCreatedAt,
        useStoredDeadline: true,
        storedDeadline: older.item.redemption_deadline,
      }),
    ).toBe(false);
    expect(
      challengeCardExpired({
        now,
        cycleCreatedAt,
        useStoredDeadline: false,
      }),
    ).toBe(true);

    const card = source('src/components/dashboard/restaurant-card.tsx');
    expect(card).toContain('useStoredDeadline');
    expect(card).toContain('challengeCardExpired');
    expect(card).toContain('formatChicagoDeadline');
    expect(card).toContain('/challenges/show/');
    const dashboard = source('src/components/dashboard/dashboard-client.tsx');
    expect(dashboard).toContain('creditsSwapRemaining');
    expect(dashboard).toContain('redemption_deadline');
    expect(dashboard).toContain('useStoredDeadline');
    expect(dashboard).toContain('CarriedCreditsSection');
    expect(dashboard).not.toContain('THIRTY_DAYS_MS');
  });
});
