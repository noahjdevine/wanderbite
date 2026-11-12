import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DrawingsAdmin } from '@/app/(site)/admin/drawings/drawings-admin';
import {
  ACTIVE_CLOSE_CONFIRM_NOTE,
  CLOSED_WITHOUT_ACTIVATION_NOTE,
  DRAFT_CLOSE_CONFIRM_NOTE,
  LIVE_CAMPAIGN_ACTIVATION_NOTE,
} from '@/lib/drawings/admin-actions';
import { DRAWINGS_NOT_SET_UP, summarizeDrawingsAdmin, type DrawingsAdminSource } from '@/lib/drawings/admin-read-model';

const refresh = vi.hoisted(() => vi.fn());
const activateCampaignAction = vi.hoisted(() => vi.fn());
const closeCampaignAction = vi.hoisted(() => vi.fn());
const runSelectionAction = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock('./actions', () => ({
  activateCampaignAction,
  closeCampaignAction,
  runSelectionAction,
}));

const CAMPAIGN_ID = 'c1111111-1111-4111-8111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SEED = 'cd'.repeat(32);

function source(overrides?: {
  status?: DrawingsAdminSource['campaign']['status'];
  mode?: DrawingsAdminSource['campaign']['mode'];
  selection?: boolean;
  activatedAt?: string | null;
  closedAt?: string | null;
}): DrawingsAdminSource {
  const status = overrides?.status ?? 'draft';
  const mode = overrides?.mode ?? 'sample';
  return {
    campaign: {
      id: CAMPAIGN_ID,
      quarterKey: '2027-Q1',
      mode,
      status,
      totalBudgetCents: 20_000,
      fulfillmentAllowanceCents: 3_000,
      activatedAt:
        overrides?.activatedAt !== undefined
          ? overrides.activatedAt
          : status === 'draft'
            ? null
            : '2026-12-15T18:00:00.000Z',
      closedAt:
        overrides?.closedAt !== undefined
          ? overrides.closedAt
          : status === 'closed'
            ? '2027-01-01T05:30:00.000Z'
            : null,
      prizes: [
        {
          id: 'p1',
          label: mode === 'sample' ? 'Sample prize: First' : 'Dinner',
          quantity: 1,
          unitValueCents: 5_000,
          position: 0,
        },
      ],
    },
    selection:
      overrides?.selection === false
        ? null
        : {
            id: '51111111-1111-4111-8111-111111111111',
            seed: SEED,
            eligibleEntryCount: 2,
            unfilledUnitCount: 0,
            runBy: 'admin:aaaaaaaa',
            createdAt: '2027-01-02T18:00:00.000Z',
            winners: [{ id: 'w1', rank: 1, prizeId: 'p1', userId: USER_ID, unitIndex: 1 }],
          },
    fulfillments: [],
    events: [],
    profileIds: new Set([USER_ID]),
  };
}

function campaignView(overrides?: Parameters<typeof source>[0]) {
  const view = summarizeDrawingsAdmin(source(overrides));
  if (!view) throw new Error('expected a campaign view');
  return { ok: true as const, campaigns: [view] };
}

describe('drawing campaign actions', () => {
  beforeEach(() => {
    refresh.mockReset();
    activateCampaignAction.mockReset();
    closeCampaignAction.mockReset();
    runSelectionAction.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('hides every action when the flag prop is off, including a live draft', () => {
    render(<DrawingsAdmin view={campaignView({ status: 'draft', mode: 'live', selection: false })} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(LIVE_CAMPAIGN_ACTIVATION_NOTE)).toBeNull();
    expect(screen.queryByText(DRAFT_CLOSE_CONFIRM_NOTE)).toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('hides the closed-without-activation note when actions are off', () => {
    render(
      <DrawingsAdmin
        view={campaignView({ status: 'closed', mode: 'sample', selection: false, activatedAt: null })}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(CLOSED_WITHOUT_ACTIVATION_NOTE)).toBeNull();
    expect(screen.queryByText(DRAFT_CLOSE_CONFIRM_NOTE)).toBeNull();
    expect(screen.queryByText(ACTIVE_CLOSE_CONFIRM_NOTE)).toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('hides actions when the drawing tables are not set up', () => {
    render(<DrawingsAdmin view={{ ok: false, reason: 'not_set_up' }} actionsEnabled />);
    expect(screen.getByText(DRAWINGS_NOT_SET_UP)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('confirms activate on a second click and shows the store message', async () => {
    activateCampaignAction.mockResolvedValue({ ok: true });
    render(<DrawingsAdmin view={campaignView({ status: 'draft', mode: 'sample', selection: false })} actionsEnabled />);
    expect(screen.getByRole('button', { name: 'Activate' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Yes, activate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Run simulated selection' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
    expect(activateCampaignAction).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Yes, activate' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(activateCampaignAction).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Activate' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, activate' }));
    await waitFor(() => expect(activateCampaignAction).toHaveBeenCalledTimes(1));
    expect(activateCampaignAction).toHaveBeenCalledWith(CAMPAIGN_ID);
    expect(closeCampaignAction).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('This campaign is active.'));
    expect(refresh).toHaveBeenCalledTimes(1);

    activateCampaignAction.mockResolvedValue({
      ok: false,
      error: 'no_prizes',
      message: "This campaign has no prizes, so it can't be activated.",
    });
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, activate' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        "This campaign has no prizes, so it can't be activated.",
      ),
    );
    expect(screen.queryByText('no_prizes')).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('asks before closing a draft and does not call the action on the first click', async () => {
    closeCampaignAction.mockResolvedValue({ ok: true });
    render(<DrawingsAdmin view={campaignView({ status: 'draft', mode: 'sample', selection: false })} actionsEnabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(closeCampaignAction).not.toHaveBeenCalled();
    expect(activateCampaignAction).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Yes, close without activating' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByText(DRAFT_CLOSE_CONFIRM_NOTE)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(closeCampaignAction).not.toHaveBeenCalled();
    expect(screen.queryByText(DRAFT_CLOSE_CONFIRM_NOTE)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, close without activating' }));
    await waitFor(() => expect(closeCampaignAction).toHaveBeenCalledTimes(1));
    expect(closeCampaignAction).toHaveBeenCalledWith(CAMPAIGN_ID);
    expect(activateCampaignAction).not.toHaveBeenCalled();
  });

  it('uses the same draft close confirmation on a live draft', () => {
    render(<DrawingsAdmin view={campaignView({ status: 'draft', mode: 'live', selection: false })} actionsEnabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(closeCampaignAction).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Yes, close without activating' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByText(DRAFT_CLOSE_CONFIRM_NOTE)).toBeTruthy();
    expect(screen.getByRole('note').textContent).toBe(LIVE_CAMPAIGN_ACTIVATION_NOTE);
  });

  it('says an active close cannot be undone, and waits for the second click', () => {
    render(<DrawingsAdmin view={campaignView({ status: 'active', mode: 'sample', selection: false })} actionsEnabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(closeCampaignAction).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Yes, close' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByText(ACTIVE_CLOSE_CONFIRM_NOTE)).toBeTruthy();
    expect(screen.queryByText(DRAFT_CLOSE_CONFIRM_NOTE)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Yes, close without activating' })).toBeNull();
  });

  it('offers close without activate on a live draft, and names the official-rules block', () => {
    render(<DrawingsAdmin view={campaignView({ status: 'draft', mode: 'live', selection: false })} actionsEnabled />);
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(screen.getByRole('note').textContent).toBe(LIVE_CAMPAIGN_ACTIVATION_NOTE);
    expect(screen.queryByRole('button', { name: 'Run simulated selection' })).toBeNull();
  });

  it('offers only close on an active campaign', () => {
    render(<DrawingsAdmin view={campaignView({ status: 'active', mode: 'sample', selection: false })} actionsEnabled />);
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Run simulated selection' })).toBeNull();
  });

  it('confirms simulated selection once, then hides the button after a selection exists', async () => {
    runSelectionAction.mockResolvedValue({ ok: true });
    const { rerender } = render(
      <DrawingsAdmin view={campaignView({ status: 'closed', mode: 'sample', selection: false })} actionsEnabled />,
    );
    expect(screen.getByText('Dec 31, 2026')).toBeTruthy();
    expect(screen.queryByText(CLOSED_WITHOUT_ACTIVATION_NOTE)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Run simulated selection' }));
    expect(runSelectionAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, run simulated selection' }));
    await waitFor(() => expect(runSelectionAction).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('The simulated selection is stored.'));

    rerender(
      <DrawingsAdmin view={campaignView({ status: 'closed', mode: 'sample', selection: true })} actionsEnabled />,
    );
    expect(screen.queryByRole('button', { name: 'Run simulated selection' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(screen.queryByText(CLOSED_WITHOUT_ACTIVATION_NOTE)).toBeNull();
    const body = document.body.textContent ?? '';
    expect(body).not.toContain(SEED);
    expect(body).not.toContain(USER_ID);
    expect(body).not.toMatch(/@/);
  });

  it('explains a sample campaign closed from draft, and offers no selection button', () => {
    const { rerender } = render(
      <DrawingsAdmin
        view={campaignView({
          status: 'closed',
          mode: 'sample',
          selection: false,
          activatedAt: null,
          closedAt: '2027-01-01T05:30:00.000Z',
        })}
        actionsEnabled
      />,
    );
    expect(screen.getByText('Dec 31, 2026')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('note').textContent).toBe(CLOSED_WITHOUT_ACTIVATION_NOTE);

    rerender(
      <DrawingsAdmin
        view={campaignView({
          status: 'closed',
          mode: 'sample',
          selection: false,
          activatedAt: '2026-12-15T18:00:00.000Z',
          closedAt: null,
        })}
        actionsEnabled
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('note').textContent).toBe(CLOSED_WITHOUT_ACTIVATION_NOTE);
  });

  it('offers nothing on a closed live campaign', () => {
    render(
      <DrawingsAdmin
        view={campaignView({ status: 'closed', mode: 'live', selection: false, activatedAt: null, closedAt: null })}
        actionsEnabled
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(CLOSED_WITHOUT_ACTIVATION_NOTE)).toBeNull();
  });

  it('ignores a second confirm click while the first request is still running', async () => {
    let release: (value: { ok: true }) => void = () => {};
    activateCampaignAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    render(<DrawingsAdmin view={campaignView({ status: 'draft', mode: 'sample', selection: false })} actionsEnabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, activate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, activate' }));
    expect(activateCampaignAction).toHaveBeenCalledTimes(1);
    release({ ok: true });
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
  });
});
