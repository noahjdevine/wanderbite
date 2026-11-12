import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DrawingsAdmin } from '@/app/(site)/admin/drawings/drawings-admin';
import {
  DELETED_MEMBER_LABEL,
  DRAWINGS_NOT_SET_UP,
  OVER_ALLOWANCE_NOTE,
  summarizeDrawingsAdmin,
  type DrawingsAdminSource,
} from '@/lib/drawings/admin-read-model';

const ROOT = path.resolve(__dirname, '../../../../..');
const SEED = 'cd'.repeat(32);
const USER_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_DELETED = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function source(): DrawingsAdminSource {
  return {
    campaign: {
      id: 'c1111111-1111-4111-8111-111111111111',
      quarterKey: '2027-Q1',
      mode: 'sample',
      status: 'closed',
      totalBudgetCents: 20_000,
      fulfillmentAllowanceCents: 3_000,
      activatedAt: '2026-12-15T18:00:00.000Z',
      closedAt: '2027-01-01T05:30:00.000Z',
      prizes: [
        { id: 'p1', label: 'Sample prize: First', quantity: 1, unitValueCents: 5_000, position: 0 },
        { id: 'p2', label: 'Dinner', quantity: 2, unitValueCents: 2_500, position: 1 },
      ],
    },
    selection: {
      seed: SEED,
      eligibleEntryCount: 4,
      unfilledUnitCount: 0,
      runBy: 'clerk',
      createdAt: '2027-01-02T18:00:00.000Z',
      winners: [
        { id: 'w1', rank: 1, prizeId: 'p1', userId: USER_1, unitIndex: 1 },
        { id: 'w2', rank: 2, prizeId: 'p2', userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', unitIndex: 1 },
        { id: 'w3', rank: 3, prizeId: 'p2', userId: USER_DELETED, unitIndex: 2 },
      ],
    },
    fulfillments: [
      { id: 'f1', winnerId: 'w1', prizeId: 'p1', status: 'fulfilled', actualCostCents: 2_500 },
      { id: 'f2', winnerId: 'w2', prizeId: 'p2', status: 'forfeited', actualCostCents: null },
      { id: 'f3', winnerId: 'w3', prizeId: 'p2', status: 'pending', actualCostCents: null },
    ],
    events: [],
    profileIds: new Set([USER_1, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']),
  };
}

describe('DrawingsAdmin', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows the sample campaign, winners, counts, and cost without a write control', () => {
    const view = summarizeDrawingsAdmin(source());
    expect(view).not.toBeNull();
    if (!view) return;
    render(<DrawingsAdmin view={{ ok: true, campaigns: [view] }} />);
    expect(screen.getByRole('heading', { name: '2027-Q1' })).toBeTruthy();
    expect(screen.getByText('Sample · Closed')).toBeTruthy();
    expect(screen.getAllByText('Sample prize: First').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sample prize: Dinner').length).toBeGreaterThan(0);
    expect(screen.getByText('Committed $130.00 of $200.00')).toBeTruthy();
    expect(screen.getByText('Dec 31, 2026')).toBeTruthy();
    expect(screen.getByText('Pending 1 · Ready 0 · Fulfilled 1 · Forfeited 1')).toBeTruthy();
    expect(screen.getByText('Recorded cost $25.00 · Allowance $30.00')).toBeTruthy();
    expect(screen.getByText(DELETED_MEMBER_LABEL)).toBeTruthy();
    expect(screen.getByText('Eligible entries 4')).toBeTruthy();
    expect(screen.getByText('Seed cdcdcdcd…')).toBeTruthy();
    const ranks = screen.getAllByRole('row').slice(1).map((row) => row.textContent);
    expect(ranks.map((text) => text?.trim().charAt(0))).toEqual(['1', '2', '3']);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
    const body = document.body.textContent ?? '';
    expect(body).not.toContain(SEED);
    expect(body).not.toContain(USER_1);
    expect(body).not.toContain(USER_DELETED);
    expect(body).not.toMatch(/@/);
    expect(body).not.toMatch(/promotion/i);
  });

  it('shows the allowance note without a blocking control', () => {
    const sample = source();
    sample.campaign.fulfillmentAllowanceCents = 2_000;
    const view = summarizeDrawingsAdmin(sample);
    expect(view).not.toBeNull();
    if (!view) return;
    render(<DrawingsAdmin view={{ ok: true, campaigns: [view] }} />);
    expect(screen.getByRole('note').textContent).toBe(OVER_ALLOWANCE_NOTE);
    expect(screen.getByText('Recorded cost $25.00 · Allowance $20.00')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the not-set-up message', () => {
    render(<DrawingsAdmin view={{ ok: false, reason: 'not_set_up' }} />);
    expect(screen.getByText(DRAWINGS_NOT_SET_UP)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('has no client hook, form, or write handler', () => {
    const component = readFileSync(path.join(ROOT, 'src/app/(site)/admin/drawings/drawings-admin.tsx'), 'utf8');
    const page = readFileSync(path.join(ROOT, 'src/app/(site)/admin/drawings/page.tsx'), 'utf8');
    expect(component).not.toMatch(/use client/);
    expect(component).not.toMatch(/<form|<button|onSubmit|onClick/);
    expect(page).not.toMatch(/<form|onSubmit/);
    expect(page).toMatch(/const actionsOn = drawingsAdminActionsEnabled\(\)/);
    expect(page).toMatch(/actionsEnabled=\{actionsOn\}/);
    expect(page.indexOf('if (!drawingsAdminEnabled()) notFound();')).toBeGreaterThan(-1);
    expect(page.indexOf('drawingsAdminEnabled()')).toBeLessThan(page.indexOf('assertAdmin()'));
  });
});
