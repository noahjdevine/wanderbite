import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DRAWING_ADMIN_ACTION_ERRORS,
  drawingAdminActionMessage,
  isDrawingStoreError,
  type DrawingAdminActionError,
} from '@/lib/drawings/admin-actions';
import { CAMPAIGN_ERROR_CODES } from '@/lib/drawings/campaign';
import {
  CAMPAIGN_EDITOR_STORE_ERRORS,
  campaignEditorMessage,
  type CampaignEditorError,
} from '@/lib/drawings/campaign-editor';
import { FULFILLMENT_ERROR_CODES } from '@/lib/drawings/fulfillment';
import { drawingFulfillmentActionMessage } from '@/lib/drawings/fulfillment-admin-actions';
import {
  activateCampaignAction,
  closeCampaignAction,
  createDrawingCampaignAction,
  createDrawingFulfillmentsAction,
  runSelectionAction,
  transitionDrawingFulfillmentAction,
  updateDrawingCampaignAction,
} from './actions';

const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAMPAIGN_ID = 'c1111111-1111-4111-8111-111111111111';
const SELECTION_ID = '51111111-1111-4111-8111-111111111111';
const FULFILLMENT_ID = 'f1111111-1111-4111-8111-111111111111';
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
  create: vi.fn(),
  transition: vi.fn(),
  budget: vi.fn(),
  createCampaign: vi.fn(),
  updateCampaign: vi.fn(),
  getCampaign: vi.fn(),
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
  createCampaign: (...args: unknown[]) => stores.createCampaign(...args),
  updateCampaign: (...args: unknown[]) => stores.updateCampaign(...args),
  getCampaign: (...args: unknown[]) => stores.getCampaign(...args),
}));

vi.mock('@/lib/drawings/selection-store', () => ({
  runSimulatedSelection: (...args: unknown[]) => stores.select(...args),
}));

vi.mock('@/lib/drawings/fulfillment-store', () => ({
  createFulfillments: (...args: unknown[]) => stores.create(...args),
  transitionFulfillment: (...args: unknown[]) => stores.transition(...args),
}));

vi.mock('@/lib/drawings/admin-read-model', async () => {
  const actual = await vi.importActual<typeof import('@/lib/drawings/admin-read-model')>(
    '@/lib/drawings/admin-read-model',
  );
  return {
    ...actual,
    loadFulfillmentBudget: (...args: unknown[]) => stores.budget(...args),
  };
});

const actions = [
  ['activate', activateCampaignAction, () => stores.activate],
  ['close', closeCampaignAction, () => stores.close],
  ['select', runSelectionAction, () => stores.select],
] as const;

function setFlag(
  name:
    | 'E09_DRAWINGS_ADMIN_ENABLED'
    | 'E09_DRAWINGS_ADMIN_ACTIONS_ENABLED'
    | 'E09_DRAWINGS_FULFILLMENT_ACTIONS_ENABLED'
    | 'E09_DRAWINGS_CAMPAIGN_EDITOR_ENABLED',
  value: string | undefined,
) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function enableFlags() {
  setFlag('E09_DRAWINGS_ADMIN_ENABLED', 'true');
  setFlag('E09_DRAWINGS_ADMIN_ACTIONS_ENABLED', 'true');
}

function storesCalled(): number {
  return (
    stores.activate.mock.calls.length +
    stores.close.mock.calls.length +
    stores.select.mock.calls.length +
    stores.create.mock.calls.length +
    stores.transition.mock.calls.length +
    stores.budget.mock.calls.length
  );
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
    stores.create.mockReset();
    stores.transition.mockReset();
    stores.budget.mockReset();
    stores.revalidatePath.mockReset();
    delete process.env.E09_DRAWINGS_ADMIN_ENABLED;
    delete process.env.E09_DRAWINGS_ADMIN_ACTIONS_ENABLED;
    delete process.env.E09_DRAWINGS_FULFILLMENT_ACTIONS_ENABLED;
    delete process.env.E09_DRAWINGS_CAMPAIGN_EDITOR_ENABLED;
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

  it('maps setup-only campaign codes to campaign_invalid and leaves an unrecognized result unavailable', async () => {
    enableFlags();
    const message = drawingAdminActionMessage('campaign_invalid');
    for (const code of CAMPAIGN_ERROR_CODES) {
      stores.revalidatePath.mockClear();
      stores.activate.mockResolvedValue({ ok: false, errors: [code] });
      const activated = await activateCampaignAction(CAMPAIGN_ID);
      stores.close.mockResolvedValue({ ok: false, errors: [code] });
      const closed = await closeCampaignAction(CAMPAIGN_ID);
      if (isDrawingStoreError(code)) {
        expect(activated, code).toEqual({ ok: false, error: code, message: drawingAdminActionMessage(code) });
        expect(closed, code).toEqual({ ok: false, error: code, message: drawingAdminActionMessage(code) });
      } else {
        expect(activated, code).toEqual({ ok: false, error: 'campaign_invalid', message });
        expect(closed, code).toEqual({ ok: false, error: 'campaign_invalid', message });
        expect(JSON.stringify(activated)).not.toContain(code);
        expect(JSON.stringify(closed)).not.toContain(code);
      }
      expect(stores.revalidatePath).not.toHaveBeenCalled();
    }

    stores.activate.mockResolvedValue({ ok: false, errors: ['invalid_label', 'over_budget'] });
    expect(await activateCampaignAction(CAMPAIGN_ID)).toMatchObject({ ok: false, error: 'over_budget' });
    stores.close.mockResolvedValue({ ok: false, error: 'not_found', errors: ['invalid_quarter_key'] });
    expect(await closeCampaignAction(CAMPAIGN_ID)).toMatchObject({ ok: false, error: 'not_found' });

    stores.activate.mockResolvedValue({ ok: false, errors: [] });
    expect(await activateCampaignAction(CAMPAIGN_ID)).toMatchObject({ ok: false, error: 'unavailable' });
    stores.close.mockResolvedValue({ ok: false, errors: ['not_a_campaign_code'] });
    const unknown = await closeCampaignAction(CAMPAIGN_ID);
    expect(unknown).toEqual({
      ok: false,
      error: 'unavailable',
      message: drawingAdminActionMessage('unavailable'),
    });
    expect(JSON.stringify(unknown)).not.toContain('not_a_campaign_code');
    stores.activate.mockResolvedValue({ ok: false });
    expect(await activateCampaignAction(CAMPAIGN_ID)).toMatchObject({ ok: false, error: 'unavailable' });

    stores.close.mockRejectedValue(new Error('postgres down'));
    const thrown = await closeCampaignAction(CAMPAIGN_ID);
    expect(thrown).toMatchObject({ ok: false, error: 'unavailable' });
    expect(JSON.stringify(thrown)).not.toContain('postgres');
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

  it('checks both flags and the admin guard before the stores, and campaign actions do not write fulfillment', () => {
    const source = readFileSync(path.join(ROOT, 'src/app/(site)/admin/drawings/actions.ts'), 'utf8');
    const campaign = source.slice(
      source.indexOf('/** Activates one sample draft'),
      source.indexOf('export type DrawingFulfillmentActionResult'),
    );
    expect(campaign.indexOf('ready(')).toBeLessThan(campaign.indexOf('activateCampaign('));
    expect(source.indexOf('drawingsAdminActionsEnabled()')).toBeLessThan(source.indexOf('assertAdmin()'));
    expect(source.indexOf('assertAdmin()')).toBeLessThan(source.indexOf('activateCampaign('));
    expect(campaign).not.toMatch(/createFulfillments\(|transitionFulfillment\(|loadFulfillmentBudget\(|verifySelection\(/);
    expect(campaign).not.toMatch(/createCampaign|updateCampaign|save_drawing_campaign/);
    expect(source).not.toMatch(/auth\.email/);
    const gate = source.slice(
      source.indexOf('async function fulfillmentAuth'),
      source.indexOf('export async function createDrawingFulfillmentsAction'),
    );
    expect(gate.indexOf('drawingsFulfillmentActionsEnabled()')).toBeGreaterThan(-1);
    expect(gate.indexOf('drawingsFulfillmentActionsEnabled()')).toBeLessThan(gate.indexOf('assertAdmin()'));
    expect(gate).not.toMatch(/createFulfillments\(|transitionFulfillment\(|loadFulfillmentBudget\(/);
    const fulfillment = source.slice(source.indexOf('export async function createDrawingFulfillmentsAction'));
    expect(fulfillment.indexOf('fulfillmentAuth()')).toBeLessThan(fulfillment.indexOf('createFulfillments('));
    expect(fulfillment.indexOf('fulfillmentAuth()')).toBeLessThan(fulfillment.indexOf('loadFulfillmentBudget('));
    expect(fulfillment.indexOf('loadFulfillmentBudget(')).toBeLessThan(fulfillment.indexOf('transitionFulfillment('));
    const deletedGate = "budget.memberDeleted && (toStatus === 'ready' || toStatus === 'fulfilled')";
    expect(fulfillment.indexOf(deletedGate)).toBeGreaterThan(fulfillment.indexOf('loadFulfillmentBudget('));
    expect(fulfillment.indexOf(deletedGate)).toBeLessThan(fulfillment.indexOf('parseFulfillmentDollars('));
    expect(fulfillment.indexOf(deletedGate)).toBeLessThan(fulfillment.indexOf('projectedOverAllowance('));
    expect(fulfillment.indexOf(deletedGate)).toBeLessThan(fulfillment.indexOf('transitionFulfillment('));
  });
});

const fulfillmentCalls = [
  ['create', () => createDrawingFulfillmentsAction(SELECTION_ID)],
  [
    'transition',
    () => transitionDrawingFulfillmentAction({ fulfillmentId: FULFILLMENT_ID, toStatus: 'ready' }),
  ],
] as const;

function enableFulfillmentFlags() {
  setFlag('E09_DRAWINGS_ADMIN_ENABLED', 'true');
  setFlag('E09_DRAWINGS_ADMIN_ACTIONS_ENABLED', 'true');
  setFlag('E09_DRAWINGS_FULFILLMENT_ACTIONS_ENABLED', 'true');
}

function writersCalled(): number {
  return stores.create.mock.calls.length + stores.transition.mock.calls.length;
}

describe('drawing fulfillment actions', () => {
  beforeEach(() => {
    harness.tables = [];
    harness.sessionClients = 0;
    harness.user = { ok: true, userId: ADMIN_ID, email: 'admin@example.com' };
    harness.role = 'admin';
    harness.roleError = false;
    harness.aal = { currentLevel: 'aal2', nextLevel: 'aal2' };
    harness.aalError = null;
    requireUser.mockClear();
    stores.create.mockReset();
    stores.transition.mockReset();
    stores.budget.mockReset();
    stores.revalidatePath.mockReset();
    delete process.env.E09_DRAWINGS_ADMIN_ENABLED;
    delete process.env.E09_DRAWINGS_ADMIN_ACTIONS_ENABLED;
    delete process.env.E09_DRAWINGS_FULFILLMENT_ACTIONS_ENABLED;
    delete process.env.E09_DRAWINGS_CAMPAIGN_EDITOR_ENABLED;
  });

  it('returns disabled before auth, a budget read, or a store when any flag is not exactly true', async () => {
    const values = [undefined, '', 'TRUE', '1', ' true', 'false', 'true'] as const;
    for (const [, action] of fulfillmentCalls) {
      for (const adminValue of values) {
        for (const actionValue of values) {
          for (const fulfillmentValue of values) {
            if (adminValue === 'true' && actionValue === 'true' && fulfillmentValue === 'true') continue;
            setFlag('E09_DRAWINGS_ADMIN_ENABLED', adminValue);
            setFlag('E09_DRAWINGS_ADMIN_ACTIONS_ENABLED', actionValue);
            setFlag('E09_DRAWINGS_FULFILLMENT_ACTIONS_ENABLED', fulfillmentValue);
            requireUser.mockClear();
            const result = await action();
            expect(result).toEqual({
              ok: false,
              error: 'disabled',
              message: drawingFulfillmentActionMessage('disabled'),
            });
          }
        }
      }
    }
    expect(requireUser).not.toHaveBeenCalled();
    expect(writersCalled()).toBe(0);
    expect(stores.budget).not.toHaveBeenCalled();
    expect(harness.tables).toEqual([]);
    expect(harness.sessionClients).toBe(0);
    expect(stores.revalidatePath).not.toHaveBeenCalled();
  });

  it('rejects a signed-out user, a non-admin, and an admin without MFA before any store call', async () => {
    enableFulfillmentFlags();
    for (const [, action] of fulfillmentCalls) {
      harness.user = { ok: false, error: 'You must be signed in.' };
      harness.tables = [];
      harness.sessionClients = 0;
      const signedOut = await action();
      expect(signedOut).toMatchObject({ ok: false, error: 'forbidden' });
      expect(harness.tables).toEqual([]);
      expect(harness.sessionClients).toBe(0);

      harness.user = { ok: true, userId: ADMIN_ID, email: 'member@example.com' };
      harness.role = 'member';
      harness.tables = [];
      const member = await action();
      expect(member).toMatchObject({ ok: false, error: 'forbidden' });
      expect(harness.tables).toEqual(['user_profiles']);
      expect(harness.sessionClients).toBe(0);

      harness.role = 'admin';
      harness.aal = { currentLevel: 'aal1', nextLevel: 'aal1' };
      const enroll = await action();
      expect(enroll).toEqual({
        ok: false,
        error: 'mfa_enroll',
        message: drawingFulfillmentActionMessage('mfa_enroll'),
      });

      harness.aal = { currentLevel: 'aal1', nextLevel: 'aal2' };
      const challenge = await action();
      expect(challenge).toEqual({
        ok: false,
        error: 'mfa_challenge',
        message: drawingFulfillmentActionMessage('mfa_challenge'),
      });
      harness.aal = { currentLevel: 'aal2', nextLevel: 'aal2' };
    }
    expect(writersCalled()).toBe(0);
    expect(stores.budget).not.toHaveBeenCalled();
    expect(stores.revalidatePath).not.toHaveBeenCalled();
  });

  it('creates fulfillment records once per call with admin: plus 8 id characters', async () => {
    enableFulfillmentFlags();
    stores.create.mockResolvedValue({ ok: true, fulfillments: [{ id: FULFILLMENT_ID, status: 'pending' }] });
    const created = await createDrawingFulfillmentsAction(`  ${SELECTION_ID.toUpperCase()}  `);
    expect(created).toEqual({ ok: true });
    expect(stores.create).toHaveBeenCalledTimes(1);
    expect(stores.create).toHaveBeenCalledWith(SELECTION_ID, 'admin:aaaaaaaa');
    expect(stores.create.mock.calls[0][1]).not.toContain(ADMIN_ID);
    expect(stores.create.mock.calls[0][1]).not.toContain('admin@example.com');
    expect(stores.transition).not.toHaveBeenCalled();
    expect(stores.revalidatePath).toHaveBeenCalledWith('/admin/drawings');

    const again = await createDrawingFulfillmentsAction(SELECTION_ID);
    expect(again).toEqual({ ok: true });
    expect(stores.create).toHaveBeenCalledTimes(2);
    expect(stores.create.mock.calls[1]).toEqual(stores.create.mock.calls[0]);
  });

  it('refuses a label that cannot be built and a bad id before the store', async () => {
    enableFulfillmentFlags();
    harness.user = { ok: true, userId: 'abc', email: 'admin@example.com' };
    const createLabel = await createDrawingFulfillmentsAction(SELECTION_ID);
    expect(createLabel).toEqual({
      ok: false,
      error: 'invalid_run_by',
      message: drawingFulfillmentActionMessage('invalid_run_by'),
    });
    const moveLabel = await transitionDrawingFulfillmentAction({
      fulfillmentId: FULFILLMENT_ID,
      toStatus: 'ready',
    });
    expect(moveLabel).toEqual({
      ok: false,
      error: 'invalid_actor',
      message: drawingFulfillmentActionMessage('invalid_actor'),
    });
    harness.user = { ok: true, userId: ADMIN_ID, email: 'admin@example.com' };
    const badSelection = await createDrawingFulfillmentsAction('not-a-uuid');
    expect(badSelection).toMatchObject({ ok: false, error: 'not_found' });
    const badFulfillment = await transitionDrawingFulfillmentAction({
      fulfillmentId: 'not-a-uuid',
      toStatus: 'ready',
    });
    expect(badFulfillment).toMatchObject({ ok: false, error: 'not_found' });
    expect(writersCalled()).toBe(0);
    expect(stores.budget).not.toHaveBeenCalled();
  });

  it('marks ready and forfeited without sending a cost, and does not insert another row', async () => {
    enableFulfillmentFlags();
    stores.budget.mockResolvedValue({
      ok: true,
      status: 'pending',
      recordedCostCents: 0,
      allowanceCents: 1_000,
      memberDeleted: false,
    });
    stores.transition.mockResolvedValue({ ok: true, fulfillment: { id: FULFILLMENT_ID, status: 'ready' } });
    const ready = await transitionDrawingFulfillmentAction({
      fulfillmentId: FULFILLMENT_ID,
      toStatus: 'ready',
      note: '  packed  ',
      actualCostDollars: '5.00',
    });
    expect(ready).toEqual({ ok: true });
    expect(stores.transition).toHaveBeenCalledWith(FULFILLMENT_ID, 'ready', 'admin:aaaaaaaa', { note: '  packed  ' });
    expect(stores.create).not.toHaveBeenCalled();

    stores.transition.mockResolvedValue({ ok: true, fulfillment: { id: FULFILLMENT_ID, status: 'forfeited' } });
    const forfeited = await transitionDrawingFulfillmentAction({
      fulfillmentId: FULFILLMENT_ID,
      toStatus: 'forfeited',
      note: '   ',
    });
    expect(forfeited).toEqual({ ok: true });
    expect(stores.transition).toHaveBeenLastCalledWith(FULFILLMENT_ID, 'forfeited', 'admin:aaaaaaaa', {
      note: null,
    });
    expect(stores.create).not.toHaveBeenCalled();
    expect(stores.revalidatePath).toHaveBeenCalledTimes(2);
  });

  it('returns invalid_transition for pending to fulfilled and does not call the store', async () => {
    enableFulfillmentFlags();
    stores.budget.mockResolvedValue({
      ok: true,
      status: 'pending',
      recordedCostCents: 0,
      allowanceCents: 1_000,
      memberDeleted: false,
    });
    const jumped = await transitionDrawingFulfillmentAction({
      fulfillmentId: FULFILLMENT_ID,
      toStatus: 'fulfilled',
      actualCostDollars: '5.00',
    });
    expect(jumped).toEqual({
      ok: false,
      error: 'invalid_transition',
      message: drawingFulfillmentActionMessage('invalid_transition'),
    });
    const malformed = await transitionDrawingFulfillmentAction({
      fulfillmentId: FULFILLMENT_ID,
      toStatus: 'fulfilled',
      actualCostDollars: 'abc',
    });
    expect(malformed).toMatchObject({ ok: false, error: 'invalid_transition' });
    expect(stores.transition).not.toHaveBeenCalled();
    expect(stores.create).not.toHaveBeenCalled();
    expect(stores.revalidatePath).not.toHaveBeenCalled();
  });

  it('rejects a missing or unusable fulfilled cost before the store', async () => {
    enableFulfillmentFlags();
    stores.budget.mockResolvedValue({
      ok: true,
      status: 'ready',
      recordedCostCents: 0,
      allowanceCents: 1_000,
      memberDeleted: false,
    });
    const missing = await transitionDrawingFulfillmentAction({
      fulfillmentId: FULFILLMENT_ID,
      toStatus: 'fulfilled',
    });
    expect(missing).toEqual({
      ok: false,
      error: 'cost_required',
      message: drawingFulfillmentActionMessage('cost_required'),
    });
    const blank = await transitionDrawingFulfillmentAction({
      fulfillmentId: FULFILLMENT_ID,
      toStatus: 'fulfilled',
      actualCostDollars: '',
    });
    expect(blank).toMatchObject({ ok: false, error: 'cost_required' });
    for (const actualCostDollars of ['12.345', '-1', 'abc']) {
      const result = await transitionDrawingFulfillmentAction({
        fulfillmentId: FULFILLMENT_ID,
        toStatus: 'fulfilled',
        actualCostDollars,
      });
      expect(result, actualCostDollars).toEqual({
        ok: false,
        error: 'invalid_cost',
        message: drawingFulfillmentActionMessage('invalid_cost'),
      });
    }
    expect(stores.transition).not.toHaveBeenCalled();
    expect(stores.create).not.toHaveBeenCalled();
  });

  it('records a cost at or under the allowance, including zero, on one confirm', async () => {
    enableFulfillmentFlags();
    stores.budget.mockResolvedValue({
      ok: true,
      status: 'ready',
      recordedCostCents: 500,
      allowanceCents: 1_000,
      memberDeleted: false,
    });
    stores.transition.mockResolvedValue({ ok: true, fulfillment: { id: FULFILLMENT_ID, status: 'fulfilled' } });
    const equal = await transitionDrawingFulfillmentAction({
      fulfillmentId: FULFILLMENT_ID,
      toStatus: 'fulfilled',
      actualCostDollars: '5.00',
    });
    expect(equal).toEqual({ ok: true });
    expect(stores.transition).toHaveBeenCalledTimes(1);
    expect(stores.transition).toHaveBeenCalledWith(FULFILLMENT_ID, 'fulfilled', 'admin:aaaaaaaa', {
      note: null,
      actualCostCents: 500,
    });

    stores.budget.mockResolvedValue({
      ok: true,
      status: 'ready',
      recordedCostCents: 0,
      allowanceCents: 0,
      memberDeleted: false,
    });
    const zero = await transitionDrawingFulfillmentAction({
      fulfillmentId: FULFILLMENT_ID,
      toStatus: 'fulfilled',
      actualCostDollars: '0.00',
    });
    expect(zero).toEqual({ ok: true });
    expect(stores.transition).toHaveBeenLastCalledWith(FULFILLMENT_ID, 'fulfilled', 'admin:aaaaaaaa', {
      note: null,
      actualCostCents: 0,
    });
  });

  it('asks before recording above the allowance, then stores the same cents on the second call', async () => {
    enableFulfillmentFlags();
    stores.budget.mockResolvedValue({
      ok: true,
      status: 'ready',
      recordedCostCents: 500,
      allowanceCents: 1_000,
      memberDeleted: false,
    });
    stores.transition.mockResolvedValue({ ok: true, fulfillment: { id: FULFILLMENT_ID, status: 'fulfilled' } });
    const warned = await transitionDrawingFulfillmentAction({
      fulfillmentId: FULFILLMENT_ID,
      toStatus: 'fulfilled',
      actualCostDollars: '5.01',
      note: 'receipt',
    });
    expect(warned).toEqual({
      ok: false,
      error: 'over_allowance_confirm',
      message:
        'This cost puts recorded cost above the fulfillment allowance (recorded $5.00 + this $5.01 > allowance $10.00). Click again to record it anyway.',
    });
    expect(stores.transition).not.toHaveBeenCalled();
    expect(stores.revalidatePath).not.toHaveBeenCalled();

    const recorded = await transitionDrawingFulfillmentAction({
      fulfillmentId: FULFILLMENT_ID,
      toStatus: 'fulfilled',
      actualCostDollars: '5.01',
      note: 'receipt',
      confirmOverAllowance: true,
    });
    expect(recorded).toEqual({ ok: true });
    expect(stores.transition).toHaveBeenCalledTimes(1);
    expect(stores.transition).toHaveBeenCalledWith(FULFILLMENT_ID, 'fulfilled', 'admin:aaaaaaaa', {
      note: 'receipt',
      actualCostCents: 501,
    });
    expect(stores.revalidatePath).toHaveBeenCalledTimes(1);
  });

  it('rejects a note over 500 characters before the store', async () => {
    enableFulfillmentFlags();
    stores.budget.mockResolvedValue({
      ok: true,
      status: 'pending',
      recordedCostCents: 0,
      allowanceCents: 1_000,
      memberDeleted: false,
    });
    const result = await transitionDrawingFulfillmentAction({
      fulfillmentId: FULFILLMENT_ID,
      toStatus: 'ready',
      note: 'n'.repeat(501),
    });
    const message = drawingFulfillmentActionMessage('drawing_fulfillment_events_note_check');
    expect(message).not.toContain('drawing_fulfillment_events_note_check');
    expect(result).toEqual({
      ok: false,
      error: 'drawing_fulfillment_events_note_check',
      message,
    });
    expect(stores.transition).not.toHaveBeenCalled();
  });

  it('maps each fulfillment store error to a plain message', async () => {
    enableFulfillmentFlags();
    stores.budget.mockResolvedValue({
      ok: true,
      status: 'pending',
      recordedCostCents: 0,
      allowanceCents: 1_000,
      memberDeleted: false,
    });
    for (const code of [...FULFILLMENT_ERROR_CODES, 'unavailable'] as const) {
      stores.revalidatePath.mockClear();
      stores.transition.mockResolvedValue({ ok: false, error: code });
      const result = await transitionDrawingFulfillmentAction({
        fulfillmentId: FULFILLMENT_ID,
        toStatus: 'forfeited',
      });
      expect(result, code).toEqual({
        ok: false,
        error: code,
        message: drawingFulfillmentActionMessage(code),
      });
      expect(JSON.stringify(result)).not.toMatch(/@/);
      expect(stores.revalidatePath).not.toHaveBeenCalled();
    }
    stores.create.mockResolvedValue({ ok: false, error: 'not_found' });
    expect(await createDrawingFulfillmentsAction(SELECTION_ID)).toMatchObject({ ok: false, error: 'not_found' });
    stores.create.mockResolvedValue({ ok: false, error: 'mystery' });
    const unknown = await createDrawingFulfillmentsAction(SELECTION_ID);
    expect(unknown).toEqual({
      ok: false,
      error: 'unavailable',
      message: drawingFulfillmentActionMessage('unavailable'),
    });
    expect(JSON.stringify(unknown)).not.toContain('mystery');
    stores.transition.mockRejectedValue(new Error('down'));
    stores.budget.mockResolvedValue({
      ok: true,
      status: 'pending',
      recordedCostCents: 0,
      allowanceCents: 1_000,
      memberDeleted: false,
    });
    const thrown = await transitionDrawingFulfillmentAction({
      fulfillmentId: FULFILLMENT_ID,
      toStatus: 'ready',
    });
    expect(thrown).toMatchObject({ ok: false, error: 'unavailable' });
    expect(JSON.stringify(thrown)).not.toContain('down');
  });

  it('rejects ready and fulfilled for a deleted member before cost, allowance, or the store', async () => {
    enableFulfillmentFlags();
    stores.budget.mockResolvedValue({
      ok: true,
      status: 'pending',
      recordedCostCents: 0,
      allowanceCents: 1_000,
      memberDeleted: true,
    });
    const ready = await transitionDrawingFulfillmentAction({
      fulfillmentId: FULFILLMENT_ID,
      toStatus: 'ready',
      actualCostDollars: 'nope',
      note: 'n'.repeat(501),
    });
    expect(ready).toEqual({
      ok: false,
      error: 'invalid_transition',
      message: drawingFulfillmentActionMessage('invalid_transition'),
    });

    stores.budget.mockResolvedValue({
      ok: true,
      status: 'ready',
      recordedCostCents: 500,
      allowanceCents: 1_000,
      memberDeleted: true,
    });
    const fulfilled = await transitionDrawingFulfillmentAction({
      fulfillmentId: FULFILLMENT_ID,
      toStatus: 'fulfilled',
      actualCostDollars: '5.01',
    });
    expect(fulfilled).toEqual({
      ok: false,
      error: 'invalid_transition',
      message: drawingFulfillmentActionMessage('invalid_transition'),
    });
    expect(stores.transition).not.toHaveBeenCalled();
    expect(stores.create).not.toHaveBeenCalled();
    expect(stores.revalidatePath).not.toHaveBeenCalled();
  });

  it('forfeits a deleted member from pending or ready and does not send a cost', async () => {
    enableFulfillmentFlags();
    stores.transition.mockResolvedValue({ ok: true, fulfillment: { id: FULFILLMENT_ID, status: 'forfeited' } });
    for (const status of ['pending', 'ready'] as const) {
      stores.budget.mockResolvedValue({
        ok: true,
        status,
        recordedCostCents: 0,
        allowanceCents: 1_000,
        memberDeleted: true,
      });
      const result = await transitionDrawingFulfillmentAction({
        fulfillmentId: FULFILLMENT_ID,
        toStatus: 'forfeited',
        note: '  left  ',
        actualCostDollars: '9.00',
      });
      expect(result, status).toEqual({ ok: true });
    }
    expect(stores.transition).toHaveBeenCalledTimes(2);
    expect(stores.transition).toHaveBeenNthCalledWith(1, FULFILLMENT_ID, 'forfeited', 'admin:aaaaaaaa', {
      note: '  left  ',
    });
    expect(stores.transition).toHaveBeenNthCalledWith(2, FULFILLMENT_ID, 'forfeited', 'admin:aaaaaaaa', {
      note: '  left  ',
    });
    expect(stores.create).not.toHaveBeenCalled();
  });

  it('returns unavailable when the profile read fails and does not transition', async () => {
    enableFulfillmentFlags();
    stores.budget.mockResolvedValue({ ok: false, error: 'unavailable' });
    const failed = await transitionDrawingFulfillmentAction({
      fulfillmentId: FULFILLMENT_ID,
      toStatus: 'fulfilled',
      actualCostDollars: 'nope',
    });
    expect(failed).toEqual({
      ok: false,
      error: 'unavailable',
      message: drawingFulfillmentActionMessage('unavailable'),
    });

    stores.budget.mockRejectedValue(new Error('profile down'));
    const thrown = await transitionDrawingFulfillmentAction({
      fulfillmentId: FULFILLMENT_ID,
      toStatus: 'forfeited',
    });
    expect(thrown).toEqual({
      ok: false,
      error: 'unavailable',
      message: drawingFulfillmentActionMessage('unavailable'),
    });
    expect(JSON.stringify(thrown)).not.toContain('profile down');
    expect(stores.transition).not.toHaveBeenCalled();
    expect(stores.revalidatePath).not.toHaveBeenCalled();
  });
});

const EDITOR_ID = 'c2222222-2222-4222-8222-222222222222';

function sampleForm(overrides?: {
  quarterKey?: string;
  totalBudgetDollars?: string;
  fulfillmentAllowanceDollars?: string;
  label?: string;
  quantity?: string;
  unitValueDollars?: string;
  prizes?: { label: string; quantity: string; unitValueDollars: string }[];
}) {
  return {
    quarterKey: overrides?.quarterKey ?? '2027-Q1',
    totalBudgetDollars: overrides?.totalBudgetDollars ?? '100',
    fulfillmentAllowanceDollars: overrides?.fulfillmentAllowanceDollars ?? '20',
    prizes: overrides?.prizes ?? [
      {
        label: overrides?.label ?? 'Sample prize: Dinner for two',
        quantity: overrides?.quantity ?? '2',
        unitValueDollars: overrides?.unitValueDollars ?? '40',
      },
    ],
  };
}

function enableEditorFlags() {
  setFlag('E09_DRAWINGS_ADMIN_ENABLED', 'true');
  setFlag('E09_DRAWINGS_ADMIN_ACTIONS_ENABLED', 'true');
  setFlag('E09_DRAWINGS_CAMPAIGN_EDITOR_ENABLED', 'true');
}

function editorStoresCalled(): number {
  return (
    stores.createCampaign.mock.calls.length +
    stores.updateCampaign.mock.calls.length +
    stores.getCampaign.mock.calls.length
  );
}

function storedSample() {
  return { ok: true as const, campaign: { id: EDITOR_ID, mode: 'sample' as const, status: 'draft' as const } };
}

describe('drawing campaign editor actions', () => {
  beforeEach(() => {
    harness.tables = [];
    harness.sessionClients = 0;
    harness.user = { ok: true, userId: ADMIN_ID, email: 'admin@example.com' };
    harness.role = 'admin';
    harness.roleError = false;
    harness.aal = { currentLevel: 'aal2', nextLevel: 'aal2' };
    harness.aalError = null;
    requireUser.mockClear();
    stores.createCampaign.mockReset();
    stores.updateCampaign.mockReset();
    stores.getCampaign.mockReset();
    stores.getCampaign.mockResolvedValue(storedSample());
    stores.revalidatePath.mockReset();
    delete process.env.E09_DRAWINGS_ADMIN_ENABLED;
    delete process.env.E09_DRAWINGS_ADMIN_ACTIONS_ENABLED;
    delete process.env.E09_DRAWINGS_CAMPAIGN_EDITOR_ENABLED;
  });

  it('returns disabled before auth or a store when any of the three flags is not exactly true', async () => {
    const values = [undefined, '', 'TRUE', '1', ' true', 'false', 'true'] as const;
    const calls = [
      () => createDrawingCampaignAction(sampleForm()),
      () => updateDrawingCampaignAction(EDITOR_ID, sampleForm()),
    ];
    for (const action of calls) {
      for (const adminValue of values) {
        for (const actionValue of values) {
          for (const editorValue of values) {
            if (adminValue === 'true' && actionValue === 'true' && editorValue === 'true') continue;
            setFlag('E09_DRAWINGS_ADMIN_ENABLED', adminValue);
            setFlag('E09_DRAWINGS_ADMIN_ACTIONS_ENABLED', actionValue);
            setFlag('E09_DRAWINGS_CAMPAIGN_EDITOR_ENABLED', editorValue);
            requireUser.mockClear();
            const result = await action();
            expect(result).toEqual({
              ok: false,
              error: 'disabled',
              message: campaignEditorMessage('disabled'),
            });
          }
        }
      }
    }
    expect(requireUser).not.toHaveBeenCalled();
    expect(editorStoresCalled()).toBe(0);
    expect(harness.tables).toEqual([]);
    expect(harness.sessionClients).toBe(0);
    expect(stores.revalidatePath).not.toHaveBeenCalled();
  });

  it('rejects a signed-out user, a non-admin, and an admin without MFA before any store call', async () => {
    enableEditorFlags();
    const calls = [
      () => createDrawingCampaignAction(sampleForm()),
      () => updateDrawingCampaignAction(EDITOR_ID, sampleForm()),
    ];
    for (const action of calls) {
      harness.user = { ok: false, error: 'You must be signed in.' };
      harness.tables = [];
      harness.sessionClients = 0;
      const signedOut = await action();
      expect(signedOut).toMatchObject({ ok: false, error: 'forbidden' });
      expect(harness.tables).toEqual([]);
      expect(harness.sessionClients).toBe(0);

      harness.user = { ok: true, userId: ADMIN_ID, email: 'member@example.com' };
      harness.role = 'member';
      harness.tables = [];
      const member = await action();
      expect(member).toMatchObject({ ok: false, error: 'forbidden' });
      expect(harness.tables).toEqual(['user_profiles']);
      expect(harness.sessionClients).toBe(0);

      harness.role = 'admin';
      harness.aal = { currentLevel: 'aal1', nextLevel: 'aal1' };
      const enroll = await action();
      expect(enroll).toEqual({
        ok: false,
        error: 'mfa_enroll',
        message: campaignEditorMessage('mfa_enroll'),
      });

      harness.aal = { currentLevel: 'aal1', nextLevel: 'aal2' };
      const challenge = await action();
      expect(challenge).toEqual({
        ok: false,
        error: 'mfa_challenge',
        message: campaignEditorMessage('mfa_challenge'),
      });
      harness.aal = { currentLevel: 'aal2', nextLevel: 'aal2' };
      harness.user = { ok: true, userId: ADMIN_ID, email: 'admin@example.com' };
    }
    expect(editorStoresCalled()).toBe(0);
    expect(stores.revalidatePath).not.toHaveBeenCalled();
  });

  it('creates one sample draft and prefixes a label that is missing the sample marker', async () => {
    enableEditorFlags();
    stores.createCampaign.mockResolvedValue({ ok: true, campaign: { id: EDITOR_ID } });
    const created = await createDrawingCampaignAction(
      sampleForm({ label: 'Dinner for two', totalBudgetDollars: '100.00', unitValueDollars: '40.00' }),
    );
    expect(created).toEqual({ ok: true });
    expect(stores.createCampaign).toHaveBeenCalledTimes(1);
    expect(stores.createCampaign).toHaveBeenCalledWith({
      quarterKey: '2027-Q1',
      mode: 'sample',
      rulesVersion: 'v0',
      totalBudgetCents: 10_000,
      fulfillmentAllowanceCents: 2_000,
      prizes: [
        {
          label: 'Sample prize: Dinner for two',
          quantity: 2,
          unitValueCents: 4_000,
          isSample: true,
        },
      ],
      eligibleEntrySources: ['level_milestone'],
    });
    expect(stores.updateCampaign).not.toHaveBeenCalled();
    expect(stores.revalidatePath).toHaveBeenCalledWith('/admin/drawings');
  });

  it('updates a draft by id and does not create another row', async () => {
    enableEditorFlags();
    stores.updateCampaign.mockResolvedValue({ ok: true, campaign: { id: EDITOR_ID } });
    const updated = await updateDrawingCampaignAction(`  ${EDITOR_ID.toUpperCase()}  `, sampleForm({ label: 'Sample prize: Lunch' }));
    expect(updated).toEqual({ ok: true });
    expect(stores.updateCampaign).toHaveBeenCalledTimes(1);
    expect(stores.updateCampaign.mock.calls[0]?.[0]).toBe(EDITOR_ID);
    expect(stores.updateCampaign.mock.calls[0]?.[1]).toMatchObject({
      quarterKey: '2027-Q1',
      mode: 'sample',
      prizes: [expect.objectContaining({ label: 'Sample prize: Lunch', quantity: 2 })],
    });
    expect(stores.createCampaign).not.toHaveBeenCalled();
    expect(stores.getCampaign).toHaveBeenCalledWith(EDITOR_ID);
    expect(stores.revalidatePath).toHaveBeenCalledTimes(1);
  });

  it('refuses a non-sample campaign before updateCampaign, and maps a missing or failed read', async () => {
    enableEditorFlags();
    stores.getCampaign.mockResolvedValue({
      ok: true,
      campaign: { id: EDITOR_ID, mode: 'live', status: 'draft' },
    });
    const live = await updateDrawingCampaignAction(EDITOR_ID, sampleForm());
    expect(live).toEqual({
      ok: false,
      error: 'invalid_mode',
      message: 'This page saves sample campaigns only.',
    });
    expect(stores.getCampaign).toHaveBeenCalledWith(EDITOR_ID);
    expect(stores.updateCampaign).not.toHaveBeenCalled();
    expect(stores.revalidatePath).not.toHaveBeenCalled();

    stores.getCampaign.mockResolvedValue({ ok: false, error: 'not_found' });
    const missing = await updateDrawingCampaignAction(EDITOR_ID, sampleForm());
    expect(missing).toEqual({
      ok: false,
      error: 'not_found',
      message: campaignEditorMessage('not_found'),
    });
    expect(stores.updateCampaign).not.toHaveBeenCalled();

    stores.getCampaign.mockResolvedValue({ ok: false, error: 'unavailable' });
    const failed = await updateDrawingCampaignAction(EDITOR_ID, sampleForm());
    expect(failed).toEqual({
      ok: false,
      error: 'unavailable',
      message: campaignEditorMessage('unavailable'),
    });
    expect(stores.updateCampaign).not.toHaveBeenCalled();

    stores.getCampaign.mockResolvedValue(storedSample());
    stores.updateCampaign.mockResolvedValue({ ok: true, campaign: { id: EDITOR_ID } });
    const saved = await updateDrawingCampaignAction(EDITOR_ID, sampleForm());
    expect(saved).toEqual({ ok: true });
    expect(stores.updateCampaign).toHaveBeenCalledTimes(1);
    expect(stores.updateCampaign.mock.calls[0]?.[0]).toBe(EDITOR_ID);
  });

  it('returns field errors and does not call the store for an empty prize list, a bad quantity, or a bad amount', async () => {
    enableEditorFlags();
    const cases = [
      sampleForm({ prizes: [] }),
      sampleForm({ quantity: '0' }),
      sampleForm({ quantity: '1001' }),
      sampleForm({ unitValueDollars: '-1' }),
      sampleForm({ unitValueDollars: '12.345' }),
      sampleForm({ unitValueDollars: 'abc' }),
      sampleForm({ totalBudgetDollars: '' }),
      sampleForm({ fulfillmentAllowanceDollars: '100001' }),
    ];
    for (const input of cases) {
      const created = await createDrawingCampaignAction(input);
      expect(created.ok, JSON.stringify(input)).toBe(false);
      if (created.ok) continue;
      expect(created.error).toBe('invalid_form');
      expect(created.fieldErrors?.length).toBeGreaterThan(0);
      expect(created.message).not.toMatch(/invalid_amount|zero_quantity|empty_prizes/);
      expect(created.message.length).toBeGreaterThan(0);
    }
    const missingId = await updateDrawingCampaignAction('not-a-uuid', sampleForm());
    expect(missingId).toEqual({
      ok: false,
      error: 'not_found',
      message: campaignEditorMessage('not_found'),
    });
    expect(editorStoresCalled()).toBe(0);
    expect(stores.revalidatePath).not.toHaveBeenCalled();
  });

  it('maps over_budget, quarter_campaign_open, and campaign_locked to plain messages', async () => {
    enableEditorFlags();
    stores.createCampaign.mockResolvedValue({ ok: false, errors: ['over_budget'] });
    const over = await createDrawingCampaignAction(sampleForm({ fulfillmentAllowanceDollars: '30' }));
    expect(over).toEqual({
      ok: false,
      error: 'over_budget',
      message: 'The prizes and fulfillment allowance are over the campaign budget.',
    });
    expect(over.ok ? '' : over.message).not.toContain('over_budget');

    stores.createCampaign.mockResolvedValue({ ok: false, error: 'quarter_campaign_open' });
    const open = await createDrawingCampaignAction(sampleForm());
    expect(open).toEqual({
      ok: false,
      error: 'quarter_campaign_open',
      message: 'A campaign for that quarter is already open.',
    });

    stores.updateCampaign.mockResolvedValue({ ok: false, error: 'campaign_locked' });
    const locked = await updateDrawingCampaignAction(EDITOR_ID, sampleForm());
    expect(locked).toEqual({
      ok: false,
      error: 'campaign_locked',
      message: "This campaign is no longer a draft, so it can't be edited.",
    });
    expect(stores.revalidatePath).not.toHaveBeenCalled();
  });

  it('maps every campaign setup code and store error to a plain message', async () => {
    enableEditorFlags();
    const codes = [...CAMPAIGN_ERROR_CODES, ...CAMPAIGN_EDITOR_STORE_ERRORS] as const;
    const seen = new Set<string>();
    for (const code of codes) {
      if (seen.has(code)) continue;
      seen.add(code);
      stores.revalidatePath.mockClear();
      const message = campaignEditorMessage(code);
      expect(message, code).not.toBe(code);
      expect(message.length, code).toBeGreaterThan(0);
      if (code !== 'unavailable') expect(message, code).not.toContain(code);
      stores.createCampaign.mockResolvedValue(
        code === 'over_budget' || (CAMPAIGN_ERROR_CODES as readonly string[]).includes(code)
          ? { ok: false, errors: [code] }
          : { ok: false, error: code },
      );
      const result = await createDrawingCampaignAction(sampleForm());
      expect(result, code).toEqual({ ok: false, error: code, message });
      expect(stores.revalidatePath).not.toHaveBeenCalled();
    }
    stores.createCampaign.mockResolvedValue({ ok: false, error: 'mystery' });
    const unknown = await createDrawingCampaignAction(sampleForm());
    expect(unknown).toEqual({
      ok: false,
      error: 'unavailable',
      message: campaignEditorMessage('unavailable'),
    });
    expect(JSON.stringify(unknown)).not.toContain('mystery');
    stores.createCampaign.mockRejectedValue(new Error('postgres down'));
    const thrown = await createDrawingCampaignAction(sampleForm());
    expect(thrown).toEqual({
      ok: false,
      error: 'unavailable',
      message: 'Drawing records are unavailable.',
    });
    expect(JSON.stringify(thrown)).not.toContain('postgres');
  });

  it('checks the editor flag before assertAdmin and parses before the store', () => {
    const source = readFileSync(path.join(ROOT, 'src/app/(site)/admin/drawings/actions.ts'), 'utf8');
    const gate = source.slice(source.indexOf('async function editorAuth'), source.indexOf('function fieldFailure'));
    expect(gate.indexOf('drawingsCampaignEditorEnabled()')).toBeGreaterThan(-1);
    expect(gate.indexOf('drawingsCampaignEditorEnabled()')).toBeLessThan(gate.indexOf('assertAdmin()'));
    expect(gate).not.toMatch(/createCampaign\(|updateCampaign\(/);
    const createBody = source.slice(
      source.indexOf('export async function createDrawingCampaignAction'),
      source.indexOf('export async function updateDrawingCampaignAction'),
    );
    expect(createBody.indexOf('editorAuth()')).toBeLessThan(createBody.indexOf('parseCampaignEditorForm('));
    expect(createBody.indexOf('parseCampaignEditorForm(')).toBeLessThan(createBody.indexOf('createCampaign('));
    const updateBody = source.slice(source.indexOf('export async function updateDrawingCampaignAction'));
    expect(updateBody.indexOf('editorAuth()')).toBeLessThan(updateBody.indexOf('parseCampaignEditorForm('));
    expect(updateBody.indexOf('parseCampaignEditorForm(')).toBeLessThan(updateBody.indexOf('getCampaign('));
    expect(updateBody.indexOf('getCampaign(')).toBeLessThan(updateBody.indexOf("mode !== 'sample'"));
    expect(updateBody.indexOf("mode !== 'sample'")).toBeLessThan(updateBody.indexOf('updateCampaign('));
    expect(createBody).not.toMatch(/activateCampaign\(|closeCampaign\(|runSimulatedSelection\(|createFulfillments\(/);
    const codes = [
      'disabled',
      'forbidden',
      'quarter_campaign_open',
      'campaign_locked',
      'over_budget',
      'unavailable',
    ] as const satisfies readonly CampaignEditorError[];
    for (const code of codes) expect(campaignEditorMessage(code).length).toBeGreaterThan(0);
  });
});
