import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DrawingsAdmin } from '@/app/(site)/admin/drawings/drawings-admin';
import { FULFILLMENT_NOTE_MESSAGE } from '@/lib/drawings/fulfillment-admin-actions';
import { DRAWINGS_NOT_SET_UP, summarizeDrawingsAdmin, type DrawingsAdminSource } from '@/lib/drawings/admin-read-model';

const refresh = vi.hoisted(() => vi.fn());
const createDrawingFulfillmentsAction = vi.hoisted(() => vi.fn());
const transitionDrawingFulfillmentAction = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock('./actions', () => ({
  activateCampaignAction: vi.fn(),
  closeCampaignAction: vi.fn(),
  runSelectionAction: vi.fn(),
  createDrawingFulfillmentsAction,
  transitionDrawingFulfillmentAction,
}));

const CAMPAIGN_ID = 'c1111111-1111-4111-8111-111111111111';
const SELECTION_ID = '51111111-1111-4111-8111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DELETED_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SEED = 'cd'.repeat(32);

function source(overrides?: {
  fulfillments?: DrawingsAdminSource['fulfillments'];
  deleted?: boolean;
}): DrawingsAdminSource {
  const deleted = overrides?.deleted ?? false;
  return {
    campaign: {
      id: CAMPAIGN_ID,
      quarterKey: '2027-Q1',
      mode: 'sample',
      status: 'closed',
      totalBudgetCents: 20_000,
      fulfillmentAllowanceCents: 1_000,
      activatedAt: '2026-12-15T18:00:00.000Z',
      closedAt: '2027-01-01T05:30:00.000Z',
      prizes: [{ id: 'p1', label: 'Sample prize: First', quantity: 1, unitValueCents: 5_000, position: 0 }],
    },
    selection: {
      id: SELECTION_ID,
      seed: SEED,
      eligibleEntryCount: 2,
      unfilledUnitCount: 0,
      runBy: 'admin:aaaaaaaa',
      createdAt: '2027-01-02T18:00:00.000Z',
      winners: [
        { id: 'w1', rank: 1, prizeId: 'p1', userId: deleted ? DELETED_ID : USER_ID, unitIndex: 1 },
      ],
    },
    fulfillments: overrides?.fulfillments ?? [],
    events: [],
    profileIds: deleted ? new Set<string>() : new Set([USER_ID]),
  };
}

function view(overrides?: Parameters<typeof source>[0]) {
  const summarized = summarizeDrawingsAdmin(source(overrides));
  if (!summarized) throw new Error('expected a campaign view');
  return { ok: true as const, campaigns: [summarized] };
}

describe('drawing fulfillment actions', () => {
  beforeEach(() => {
    refresh.mockReset();
    createDrawingFulfillmentsAction.mockReset();
    transitionDrawingFulfillmentAction.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows no fulfillment buttons when the flag prop is off', () => {
    render(<DrawingsAdmin view={view()} actionsEnabled fulfillmentActionsEnabled={false} />);
    expect(screen.getByText('Dec 31, 2026')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create fulfillment records' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark ready' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Forfeit' })).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('hides fulfillment buttons when the drawing tables are not set up', () => {
    render(<DrawingsAdmin view={{ ok: false, reason: 'not_set_up' }} fulfillmentActionsEnabled />);
    expect(screen.getByText(DRAWINGS_NOT_SET_UP)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('creates records on the second click and does not call on the first', async () => {
    createDrawingFulfillmentsAction.mockResolvedValue({ ok: true });
    render(<DrawingsAdmin view={view()} fulfillmentActionsEnabled />);
    expect(screen.getByText('No fulfillment record')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create fulfillment records' }));
    expect(createDrawingFulfillmentsAction).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Yes, create records' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Yes, create records' }));
    await waitFor(() => expect(createDrawingFulfillmentsAction).toHaveBeenCalledTimes(1));
    expect(createDrawingFulfillmentsAction).toHaveBeenCalledWith(SELECTION_ID);
    expect(transitionDrawingFulfillmentAction).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Fulfillment records are stored.'));
    expect(refresh).toHaveBeenCalledTimes(1);
    const body = document.body.textContent ?? '';
    expect(body).not.toContain(SEED);
    expect(body).not.toContain(USER_ID);
  });

  it('offers Mark ready and Forfeit for pending, and nothing for a final status', () => {
    const pending = view({
      fulfillments: [{ id: 'f1', winnerId: 'w1', prizeId: 'p1', status: 'pending', actualCostCents: null }],
    });
    const { rerender } = render(<DrawingsAdmin view={pending} fulfillmentActionsEnabled />);
    expect(screen.getByText('Pending')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark ready' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Forfeit' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark fulfilled' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create fulfillment records' })).toBeNull();

    rerender(
      <DrawingsAdmin
        view={view({
          fulfillments: [{ id: 'f1', winnerId: 'w1', prizeId: 'p1', status: 'ready', actualCostCents: null }],
        })}
        fulfillmentActionsEnabled
      />,
    );
    expect(screen.getByText('Ready')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark fulfilled' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Forfeit' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark ready' })).toBeNull();

    rerender(
      <DrawingsAdmin
        view={view({
          fulfillments: [{ id: 'f1', winnerId: 'w1', prizeId: 'p1', status: 'fulfilled', actualCostCents: 500 }],
        })}
        fulfillmentActionsEnabled
      />,
    );
    expect(screen.getByText('Fulfilled · $5.00')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();

    rerender(
      <DrawingsAdmin
        view={view({
          fulfillments: [{ id: 'f1', winnerId: 'w1', prizeId: 'p1', status: 'forfeited', actualCostCents: null }],
        })}
        fulfillmentActionsEnabled
      />,
    );
    expect(screen.getByText('Forfeited')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows Forfeit only for a deleted member and forfeits without a cost', async () => {
    transitionDrawingFulfillmentAction.mockResolvedValue({ ok: true });
    render(
      <DrawingsAdmin
        view={view({
          deleted: true,
          fulfillments: [{ id: 'f-deleted', winnerId: 'w1', prizeId: 'p1', status: 'pending', actualCostCents: null }],
        })}
        fulfillmentActionsEnabled
      />,
    );
    const row = screen.getAllByRole('row').find((item) => item.textContent?.includes('Deleted member'));
    if (!row) throw new Error('missing deleted member row');
    expect(within(row).getByText('Pending')).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Forfeit' })).toBeTruthy();
    expect(within(row).queryByRole('button', { name: 'Mark ready' })).toBeNull();
    expect(within(row).queryByRole('button', { name: 'Mark fulfilled' })).toBeNull();
    expect(document.body.textContent ?? '').not.toContain(DELETED_ID);

    fireEvent.click(within(row).getByRole('button', { name: 'Forfeit' }));
    expect(transitionDrawingFulfillmentAction).not.toHaveBeenCalled();
    expect(screen.getByText("Forfeiting can't be undone and does not pick a new winner.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, forfeit' }));
    await waitFor(() => expect(transitionDrawingFulfillmentAction).toHaveBeenCalledTimes(1));
    expect(transitionDrawingFulfillmentAction).toHaveBeenCalledWith({
      fulfillmentId: 'f-deleted',
      toStatus: 'forfeited',
      note: '',
    });
    expect(createDrawingFulfillmentsAction).not.toHaveBeenCalled();
  });

  it('does not call on the first fulfilled click, then warns and records on the allowance button', async () => {
    const warning =
      'This cost puts recorded cost above the fulfillment allowance (recorded $5.00 + this $8.00 > allowance $10.00). Click again to record it anyway.';
    transitionDrawingFulfillmentAction
      .mockResolvedValueOnce({ ok: false, error: 'over_allowance_confirm', message: warning })
      .mockResolvedValueOnce({ ok: true });
    render(
      <DrawingsAdmin
        view={view({
          fulfillments: [{ id: 'f-ready', winnerId: 'w1', prizeId: 'p1', status: 'ready', actualCostCents: null }],
        })}
        fulfillmentActionsEnabled
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mark fulfilled' }));
    expect(transitionDrawingFulfillmentAction).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Actual cost in dollars')).toBeTruthy();
    expect(screen.getByText("Fulfilled can't be undone.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Actual cost in dollars'), { target: { value: '8.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Yes, mark fulfilled' }));
    await waitFor(() => expect(transitionDrawingFulfillmentAction).toHaveBeenCalledTimes(1));
    expect(transitionDrawingFulfillmentAction).toHaveBeenCalledWith({
      fulfillmentId: 'f-ready',
      toStatus: 'fulfilled',
      note: '',
      actualCostDollars: '8.00',
      confirmOverAllowance: false,
    });
    expect(screen.getByRole('alert').textContent).toBe(warning);
    expect(screen.getByRole('button', { name: 'Yes, record above allowance' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Yes, record above allowance' }));
    await waitFor(() => expect(transitionDrawingFulfillmentAction).toHaveBeenCalledTimes(2));
    expect(transitionDrawingFulfillmentAction).toHaveBeenLastCalledWith({
      fulfillmentId: 'f-ready',
      toStatus: 'fulfilled',
      note: '',
      actualCostDollars: '8.00',
      confirmOverAllowance: true,
    });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('This prize is marked fulfilled.'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('blocks a note over 500 characters before calling the action', () => {
    render(
      <DrawingsAdmin
        view={view({
          fulfillments: [{ id: 'f1', winnerId: 'w1', prizeId: 'p1', status: 'pending', actualCostCents: null }],
        })}
        fulfillmentActionsEnabled
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mark ready' }));
    expect(transitionDrawingFulfillmentAction).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Note, optional'), { target: { value: 'n'.repeat(501) } });
    expect(screen.getByText('501/500')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, mark ready' }));
    expect(transitionDrawingFulfillmentAction).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(FULFILLMENT_NOTE_MESSAGE);
  });
});
