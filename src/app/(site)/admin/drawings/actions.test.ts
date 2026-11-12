import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DRAWING_ADMIN_ACTION_ERRORS,
  drawingAdminActionMessage,
  type DrawingAdminActionError,
} from '@/lib/drawings/admin-actions';
import { activateCampaignAction, closeCampaignAction, runSelectionAction } from './actions';

const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAMPAIGN_ID = 'c1111111-1111-4111-8111-111111111111';
const ROOT = path.resolve(__dirname, '../../../../..');

const harness = vi.hoisted(() => ({
  tables: [] as string[],
  sessionClients: 0,
  user: {
    ok: true as const,
    userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    email: 'admin@example.com',
  } as { ok: true; userId: string; email: string | null } | { ok: false; error: string },
  role: 'admin' as string | null,
  roleError: false,
  aal: { currentLevel: 'aal2' as string | null, nextLevel: 'aal2' as string | null },
  aalError: null as { message: string } | null,
}));

const stores = vi.hoisted(() => ({
  activate: vi.fn(),
  close: vi.fn(),
  select: vi.fn(),
  revalidatePath: vi.fn(),
}));

const requireUser = vi.hoisted(() => vi.fn(async () => harness.user));

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => stores.revalidatePath(...args),
}));

vi.mock('@/lib/auth/require-user', () => ({
  requireUser: () => requireUser(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => {
    harness.sessionClients += 1;
    return {
      auth: {
        mfa: {
          getAuthenticatorAssuranceLevel: () =>
            Promise.resolve({ data: harness.aal, error: harness.aalError }),
        },
      },
    };
  }),
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      const run = () => {
        harness.tables.push(table);
        if (harness.roleError) return Promise.resolve({ data: null, error: { message: 'role' } });
        return Promise.resolve({ data: { role: harness.role }, error: null });
      };
      const api = {
        select() {
          return api;
        },
        eq() {
          return api;
        },
        maybeSingle: () => run(),
        then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          return run().then(onFulfilled, onRejected);
        },
      };
      return api;
    },
  }),
}));

vi.mock('@/lib/drawings/campaign-store', () => ({
  activateCampaign: (...args: unknown[]) => stores.activate(...args),
  closeCampaign: (...args: unknown[]) => stores.close(...args),
}));

vi.mock('@/lib/drawings/selection-store', () => ({
  runSimulatedSelection: (...args: unknown[]) => stores.select(...args),
}));

const actions = [
  ['activate', activateCampaignAction, () => stores.activate],
  ['close', closeCampaignAction, () => stores.close],
  ['select', runSelectionAction, () => stores.select],
] as const;

function setFlag(name: 'E09_DRAWINGS_ADMIN_ENABLED' | 'E09_DRAWINGS_ADMIN_ACTIONS_ENABLED', value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function enableFlags() {
  setFlag('E09_DRAWINGS_ADMIN_ENABLED', 'true');
  setFlag('E09_DRAWINGS_ADMIN_ACTIONS_ENABLED', 'true');
}

function storesCalled(): number {
  return stores.activate.mock.calls.length + stores.close.mock.calls.length + stores.select.mock.calls.length;
}

describe('drawing admin actions', () => {
  beforeEach(() => {
    harness.tables = [];
    harness.sessionClients = 0;
    harness.user = { ok: true, userId: ADMIN_ID, email: 'admin@example.com' };
    harness.role = 'admin';
    harness.roleError = false;
    harness.aal = { currentLevel: 'aal2', nextLevel: 'aal2' };
    harness.aalError = null;
    requireUser.mockClear();
    stores.activate.mockReset();
    stores.close.mockReset();
    stores.select.mockReset();
    stores.revalidatePath.mockReset();
    delete process.env.E09_DRAWINGS_ADMIN_ENABLED;
    delete process.env.E09_DRAWINGS_ADMIN_ACTIONS_ENABLED;
  });

  it('returns disabled before auth or a store when either flag is not exactly true', async () => {
    const adminValues = [undefined, '', 'TRUE', '1', ' true', 'false', 'true'] as const;
    const actionValues = [undefined, '', 'TRUE', 'True', '1', ' true', 'true ', 'false', 'true'] as const;
    for (const [, action] of actions) {
      for (const adminValue of adminValues) {
        for (const actionValue of actionValues) {
          if (adminValue === 'true' && actionValue === 'true') continue;
          setFlag('E09_DRAWINGS_ADMIN_ENABLED', adminValue);
          setFlag('E09_DRAWINGS_ADMIN_ACTIONS_ENABLED', actionValue);
          requireUser.mockClear();
          const result = await action(CAMPAIGN_ID);
          expect(result).toEqual({
            ok: false,
            error: 'disabled',
            message: drawingAdminActionMessage('disabled'),
          });
        }
      }
    }
    expect(requireUser).not.toHaveBeenCalled();
    expect(storesCalled()).toBe(0);
    expect(harness.tables).toEqual([]);
    expect(harness.sessionClients).toBe(0);
    expect(stores.revalidatePath).not.toHaveBeenCalled();
  });

  it('rejects a signed-out user, a non-admin, and an admin without MFA before any store call', async () => {
    enableFlags();
    for (const [, action] of actions) {
      harness.user = { ok: false, error: 'You must be signed in.' };
      harness.tables = [];
      harness.sessionClients = 0;
      const signedOut = await action(CAMPAIGN_ID);
      expect(signedOut).toMatchObject({ ok: false, error: 'forbidden' });
      expect(harness.tables).toEqual([]);
      expect(harness.sessionClients).toBe(0);

      harness.user = { ok: true, userId: ADMIN_ID, email: 'member@example.com' };
      harness.role = 'member';
      harness.tables = [];
      const member = await action(CAMPAIGN_ID);
      expect(member).toMatchObject({ ok: false, error: 'forbidden' });
      expect(harness.tables).toEqual(['user_profiles']);
      expect(harness.sessionClients).toBe(0);

      harness.role = 'admin';
      harness.aal = { currentLevel: 'aal1', nextLevel: 'aal1' };
      const enroll = await action(CAMPAIGN_ID);
      expect(enroll).toEqual({
        ok: false,
        error: 'mfa_enroll',
        message: drawingAdminActionMessage('mfa_enroll'),
      });

      harness.aal = { currentLevel: 'aal1', nextLevel: 'aal2' };
      const challenge = await action(CAMPAIGN_ID);
      expect(challenge).toEqual({
        ok: false,
        error: 'mfa_challenge',
        message: drawingAdminActionMessage('mfa_challenge'),
      });
      harness.aal = { currentLevel: 'aal2', nextLevel: 'aal2' };
    }
    expect(storesCalled()).toBe(0);
    expect(stores.revalidatePath).not.toHaveBeenCalled();
  });

  it('maps a role lookup failure and an authenticator error without calling a store', async () => {
    enableFlags();
    harness.roleError = true;
    const role = await activateCampaignAction(CAMPAIGN_ID);
    expect(role).toEqual({
      ok: false,
      error: 'role_lookup_failed',
      message: drawingAdminActionMessage('role_lookup_failed'),
    });

    harness.roleError = false;
    harness.aalError = { message: 'down' };
    const auth = await closeCampaignAction(CAMPAIGN_ID);
    expect(auth).toEqual({
      ok: false,
      error: 'auth_error',
      message: drawingAdminActionMessage('auth_error'),
    });
    expect(storesCalled()).toBe(0);
  });

  it('rejects a bad campaign id before a store call', async () => {
    enableFlags();
    const missing = await activateCampaignAction('not-a-uuid');
    expect(missing).toEqual({
      ok: false,
      error: 'not_found',
      message: drawingAdminActionMessage('not_found'),
    });
    const odd = await closeCampaignAction(1 as unknown as string);
    expect(odd).toMatchObject({ ok: false, error: 'not_found' });
    expect(storesCalled()).toBe(0);
    expect(stores.revalidatePath).not.toHaveBeenCalled();
  });

  it('activates and closes through the store, then revalidates the drawings page', async () => {
    enableFlags();
    stores.activate.mockResolvedValue({ ok: true, campaign: { id: CAMPAIGN_ID, status: 'active' } });
    const activated = await activateCampaignAction(CAMPAIGN_ID);
    expect(activated).toEqual({ ok: true });
    expect(stores.activate).toHaveBeenCalledTimes(1);
    expect(stores.activate).toHaveBeenCalledWith(CAMPAIGN_ID);
    expect(stores.close).not.toHaveBeenCalled();
    expect(stores.select).not.toHaveBeenCalled();

    stores.close.mockResolvedValue({ ok: true, campaign: { id: CAMPAIGN_ID, status: 'closed' } });
    const closed = await closeCampaignAction(`  ${CAMPAIGN_ID.toUpperCase()}  `);
    expect(closed).toEqual({ ok: true });
    expect(stores.close).toHaveBeenCalledWith(CAMPAIGN_ID);
    expect(stores.revalidatePath).toHaveBeenCalledTimes(2);
    expect(stores.revalidatePath).toHaveBeenCalledWith('/admin/drawings');
  });

  it('maps each campaign store error to a plain message and does not revalidate', async () => {
    enableFlags();
    const codes = [
      'invalid_transition',
      'live_activation_blocked',
      'campaign_window_ended',
      'no_prizes',
      'over_budget',
      'not_found',
      'unavailable',
      'quarter_campaign_open',
      'campaign_locked',
    ] as const satisfies readonly DrawingAdminActionError[];
    for (const code of codes) {
      stores.revalidatePath.mockClear();
      stores.activate.mockResolvedValue({ ok: false, error: code });
      const result = await activateCampaignAction(CAMPAIGN_ID);
      expect(result).toEqual({ ok: false, error: code, message: drawingAdminActionMessage(code) });
      expect(stores.revalidatePath).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toMatch(/@/);
    }
    stores.activate.mockResolvedValue({ ok: false, errors: ['over_budget'] });
    const listed = await activateCampaignAction(CAMPAIGN_ID);
    expect(listed).toMatchObject({ ok: false, error: 'over_budget' });
    stores.activate.mockResolvedValue({ ok: false, error: 'something_else' });
    const unknown = await activateCampaignAction(CAMPAIGN_ID);
    expect(unknown).toEqual({
      ok: false,
      error: 'unavailable',
      message: drawingAdminActionMessage('unavailable'),
    });
    expect(JSON.stringify(unknown)).not.toContain('something_else');
    stores.activate.mockRejectedValue(new Error('down'));
    const thrown = await activateCampaignAction(CAMPAIGN_ID);
    expect(thrown).toMatchObject({ ok: false, error: 'unavailable' });
    expect(stores.select).not.toHaveBeenCalled();
  });

  it('stores one simulated selection under admin: plus 8 id characters', async () => {
    enableFlags();
    stores.select.mockResolvedValue({ ok: true, selection: { id: 'selection-1' } });
    const result = await runSelectionAction(CAMPAIGN_ID);
    expect(result).toEqual({ ok: true });
    expect(stores.select).toHaveBeenCalledTimes(1);
    const [id, runBy] = stores.select.mock.calls[0] as [string, string];
    expect(id).toBe(CAMPAIGN_ID);
    expect(runBy).toBe('admin:aaaaaaaa');
    expect(runBy).not.toContain(ADMIN_ID);
    expect(runBy).not.toContain('admin@example.com');
    expect(stores.revalidatePath).toHaveBeenCalledWith('/admin/drawings');
    expect(stores.activate).not.toHaveBeenCalled();
  });

  it('returns the selection gate code on a second call and does not treat it as success', async () => {
    enableFlags();
    stores.select
      .mockResolvedValueOnce({ ok: true, selection: { id: 'selection-1' } })
      .mockResolvedValueOnce({ ok: false, error: 'already_selected' });
    const first = await runSelectionAction(CAMPAIGN_ID);
    const second = await runSelectionAction(CAMPAIGN_ID);
    expect(first).toEqual({ ok: true });
    expect(second).toEqual({
      ok: false,
      error: 'already_selected',
      message: drawingAdminActionMessage('already_selected'),
    });
    expect(stores.select).toHaveBeenCalledTimes(2);
    expect(stores.revalidatePath).toHaveBeenCalledTimes(1);
  });

  it('maps each selection store error to a plain message', async () => {
    enableFlags();
    const codes = [
      'not_found',
      'live_selection_blocked',
      'campaign_not_closed',
      'already_selected',
      'invalid_run_by',
      'invalid_seed',
      'no_eligible_entries',
      'unavailable',
    ] as const satisfies readonly DrawingAdminActionError[];
    for (const code of codes) {
      stores.revalidatePath.mockClear();
      stores.select.mockResolvedValue({ ok: false, error: code });
      const result = await runSelectionAction(CAMPAIGN_ID);
      expect(result).toEqual({ ok: false, error: code, message: drawingAdminActionMessage(code) });
      expect(stores.revalidatePath).not.toHaveBeenCalled();
      expect(DRAWING_ADMIN_ACTION_ERRORS).toContain(code);
    }
  });

  it('refuses a user id that cannot make an admin: label and does not call the store', async () => {
    enableFlags();
    harness.user = { ok: true, userId: 'abc', email: 'admin@example.com' };
    const result = await runSelectionAction(CAMPAIGN_ID);
    expect(result).toEqual({
      ok: false,
      error: 'invalid_run_by',
      message: drawingAdminActionMessage('invalid_run_by'),
    });
    expect(stores.select).not.toHaveBeenCalled();
    expect(stores.revalidatePath).not.toHaveBeenCalled();
  });

  it('checks both flags and the admin guard before the stores, and does not write fulfillment', () => {
    const source = readFileSync(path.join(ROOT, 'src/app/(site)/admin/drawings/actions.ts'), 'utf8');
    expect(source.indexOf('drawingsAdminActionsEnabled()')).toBeLessThan(source.indexOf('assertAdmin()'));
    expect(source.indexOf('assertAdmin()')).toBeLessThan(source.indexOf('activateCampaign('));
    expect(source).not.toMatch(/auth\.email/);
    expect(source).not.toMatch(
      /createCampaign|updateCampaign|save_drawing_campaign|createFulfillments|transitionFulfillment|verifySelection/,
    );
  });
});
