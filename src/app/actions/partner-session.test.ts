import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generatePartnerSessionToken,
  hashPartnerSessionToken,
  LEGACY_PARTNER_COOKIE_NAME,
  PARTNER_ANALYTICS_UNAVAILABLE_MESSAGE,
  PARTNER_COOKIE_KIOSK_MAX_AGE,
  PARTNER_COOKIE_MAX_AGE,
  PARTNER_LOGOUT_FAILED_MESSAGE,
  PARTNER_SESSION_COOKIE_NAME,
  PARTNER_SESSION_EXPIRED_MESSAGE,
  PARTNER_SESSION_START_FAILED_MESSAGE,
} from '@/lib/partner-session';
import { hashRedemptionToken } from '@/lib/redemption-token-hash';

const ACTIVE_ID = '50000000-0000-4000-8000-000000000001';
const OTHER_ID = '50000000-0000-4000-8000-000000000002';
const PAUSED_ID = '50000000-0000-4000-8000-000000000003';

type SessionRow = {
  token_hash: string;
  restaurant_id: string;
  expires_at: string;
};

type RestaurantRow = {
  id: string;
  name: string;
  status: 'active' | 'paused';
  pin_hash: string | null;
};

type RedemptionRow = {
  id: string;
  user_id: string;
  restaurant_id: string;
  status: string;
  token_hash: string;
  verified_at: string | null;
};

const state = vi.hoisted(() => ({
  jar: {} as Record<string, string>,
  cookieSetShouldThrow: false,
  insertError: false,
  deleteError: false,
  analyticsError: false,
  sessions: new Map<string, SessionRow>(),
  restaurants: new Map<string, RestaurantRow>(),
  redemptions: [] as RedemptionRow[],
  redemptionRestaurantIds: [] as string[],
  cookieSets: [] as { name: string; value: string; options: Record<string, unknown> }[],
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      state.jar[name] !== undefined ? { value: state.jar[name] } : undefined,
    set: (name: string, value: string, options: Record<string, unknown>) => {
      if (state.cookieSetShouldThrow && name === 'partner_session' && value) {
        throw new Error('cookie set failed');
      }
      state.cookieSets.push({ name, value, options });
      if (options.maxAge === 0 || value === '') {
        delete state.jar[name];
      } else {
        state.jar[name] = value;
      }
    },
  }),
  headers: async () => ({
    get: (header: string) => (header === 'x-forwarded-for' ? '127.0.0.1' : null),
  }),
}));

vi.mock('@/lib/ratelimit', () => ({
  partnerLoginLimiter: null,
}));

vi.mock('@/lib/partner-pin', () => ({
  verifyPartnerPin: async (pin: string) => pin === '1234',
}));

vi.mock('@/lib/supabase-admin', () => {
  function executeSelect(
    table: string,
    filters: Record<string, string>,
    maybeSingle: boolean,
  ) {
    if (table === 'partner_sessions') {
      const row = state.sessions.get(filters.token_hash);
      if (!row) return { data: maybeSingle ? null : [], error: null };
      if (filters['gt:expires_at'] && row.expires_at <= filters['gt:expires_at']) {
        return { data: maybeSingle ? null : [], error: null };
      }
      return { data: maybeSingle ? { ...row } : [{ ...row }], error: null };
    }
    if (table === 'restaurants') {
      const row = [...state.restaurants.values()].find((r) => r.id === filters.id) ?? null;
      if (!row || (filters.status && row.status !== filters.status)) {
        return { data: maybeSingle ? null : [], error: null };
      }
      return { data: maybeSingle ? { ...row } : [{ ...row }], error: null };
    }
    if (table === 'redemptions') {
      if (filters.restaurant_id) state.redemptionRestaurantIds.push(filters.restaurant_id);
      if (state.analyticsError) {
        return { data: null, error: { message: 'db boom' }, count: null };
      }
      const rows = state.redemptions
        .filter((row) => {
          if (filters.token_hash && row.token_hash !== filters.token_hash) return false;
          if (filters.restaurant_id && row.restaurant_id !== filters.restaurant_id) return false;
          if (filters.status && row.status !== filters.status) return false;
          return true;
        })
        .map((row) => ({ ...row }));
      return { data: rows, error: null, count: rows.length };
    }
    if (table === 'user_profiles') {
      return { data: maybeSingle ? null : [], error: null };
    }
    return { data: maybeSingle ? null : [], error: null };
  }

  function from(table: string) {
    const filters: Record<string, string> = {};
    const run = (maybeSingle: boolean) =>
      Promise.resolve(executeSelect(table, filters, maybeSingle));
    const chain = {
      select() {
        return chain;
      },
      eq(column: string, value: string) {
        filters[column] = value;
        return chain;
      },
      gt(column: string, value: string) {
        filters[`gt:${column}`] = value;
        return chain;
      },
      gte(column: string, value: string) {
        filters[`gte:${column}`] = value;
        return chain;
      },
      in() {
        return chain;
      },
      order() {
        return chain;
      },
      limit() {
        return run(false);
      },
      maybeSingle: () => run(true),
    };
    return {
      select() {
        return Object.assign(chain, {
          then(
            onFulfilled: (value: unknown) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) {
            return run(false).then(onFulfilled, onRejected);
          },
        });
      },
      insert: async (payload: SessionRow) => {
        if (state.insertError) return { error: { message: 'insert failed' } };
        state.sessions.set(payload.token_hash, payload);
        return { error: null };
      },
      delete() {
        return {
          eq: async (_column: string, hash: string) => {
            if (state.deleteError) return { error: { message: 'delete failed' } };
            state.sessions.delete(hash);
            return { error: null };
          },
        };
      },
      update() {
        return {
          eq: async () => ({ error: null }),
        };
      },
      upsert: async () => ({ error: null }),
    };
  }

  return { getSupabaseAdmin: () => ({ from }) };
});

function seedRestaurants() {
  state.restaurants.set(ACTIVE_ID, {
    id: ACTIVE_ID,
    name: 'Active Grill',
    status: 'active',
    pin_hash: 'hashed',
  });
  state.restaurants.set(OTHER_ID, {
    id: OTHER_ID,
    name: 'Other Kitchen',
    status: 'active',
    pin_hash: 'hashed',
  });
  state.restaurants.set(PAUSED_ID, {
    id: PAUSED_ID,
    name: 'Paused Pub',
    status: 'paused',
    pin_hash: 'hashed',
  });
}

function putSession(restaurantId: string, expiresAt = new Date(Date.now() + 86_400_000).toISOString()) {
  const issued = generatePartnerSessionToken();
  state.sessions.set(issued.tokenHash, {
    token_hash: issued.tokenHash,
    restaurant_id: restaurantId,
    expires_at: expiresAt,
  });
  state.jar[PARTNER_SESSION_COOKIE_NAME] = issued.token;
  return issued;
}

describe('requirePartnerSession', () => {
  beforeEach(() => {
    state.jar = {};
    state.cookieSetShouldThrow = false;
    state.insertError = false;
    state.deleteError = false;
    state.analyticsError = false;
    state.sessions = new Map();
    state.restaurants = new Map();
    state.redemptions = [];
    state.redemptionRestaurantIds = [];
    state.cookieSets = [];
    seedRestaurants();
  });

  it('rejects a missing cookie', async () => {
    const { requirePartnerSession } = await import('@/lib/require-partner-session');
    await expect(requirePartnerSession()).resolves.toEqual({ ok: false });
  });

  it('rejects a UUID or malformed cookie without a lookup hash', async () => {
    const { requirePartnerSession } = await import('@/lib/require-partner-session');
    state.jar[PARTNER_SESSION_COOKIE_NAME] = ACTIVE_ID;
    await expect(requirePartnerSession()).resolves.toEqual({ ok: false });
    state.jar[PARTNER_SESSION_COOKIE_NAME] = 'not-valid';
    await expect(requirePartnerSession()).resolves.toEqual({ ok: false });
  });

  it('rejects an expired session', async () => {
    putSession(ACTIVE_ID, new Date(Date.now() - 1000).toISOString());
    const { requirePartnerSession } = await import('@/lib/require-partner-session');
    await expect(requirePartnerSession()).resolves.toEqual({ ok: false });
  });

  it('rejects a session whose restaurant is not active', async () => {
    putSession(PAUSED_ID);
    const { requirePartnerSession } = await import('@/lib/require-partner-session');
    await expect(requirePartnerSession()).resolves.toEqual({ ok: false });
  });

  it('accepts a live hashed session for an active restaurant', async () => {
    const issued = putSession(ACTIVE_ID);
    const { requirePartnerSession } = await import('@/lib/require-partner-session');
    await expect(requirePartnerSession()).resolves.toEqual({
      ok: true,
      restaurantId: ACTIVE_ID,
      restaurantName: 'Active Grill',
      tokenHash: issued.tokenHash,
    });
  });
});

describe('loginPartner and logoutPartner', () => {
  beforeEach(() => {
    state.jar = {};
    state.cookieSetShouldThrow = false;
    state.insertError = false;
    state.deleteError = false;
    state.analyticsError = false;
    state.sessions = new Map();
    state.restaurants = new Map();
    state.redemptions = [];
    state.redemptionRestaurantIds = [];
    state.cookieSets = [];
    seedRestaurants();
  });

  it('refuses a paused restaurant and does not write a session', async () => {
    const { loginPartner } = await import('@/app/actions/partner-auth');
    const result = await loginPartner(PAUSED_ID, '1234');
    expect(result).toEqual({ ok: false, error: 'Restaurant not found.' });
    expect(state.sessions.size).toBe(0);
    expect(state.jar[PARTNER_SESSION_COOKIE_NAME]).toBeUndefined();
  });

  it('sets an httpOnly partner_session cookie and forgets the legacy UUID cookie', async () => {
    state.jar[LEGACY_PARTNER_COOKIE_NAME] = ACTIVE_ID;
    const { loginPartner } = await import('@/app/actions/partner-auth');
    const result = await loginPartner(ACTIVE_ID, '1234');
    expect(result).toEqual({ ok: true, restaurantName: 'Active Grill' });
    const token = state.jar[PARTNER_SESSION_COOKIE_NAME];
    expect(token).toBeDefined();
    expect(hashPartnerSessionToken(token)).toBeTruthy();
    expect(state.jar[LEGACY_PARTNER_COOKIE_NAME]).toBeUndefined();
    const live = state.cookieSets.find(
      (call) => call.name === PARTNER_SESSION_COOKIE_NAME && call.value === token,
    );
    expect(live?.options).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: PARTNER_COOKIE_MAX_AGE,
    });
    const expiredLegacy = state.cookieSets.find(
      (call) => call.name === LEGACY_PARTNER_COOKIE_NAME && call.options.maxAge === 0,
    );
    expect(expiredLegacy).toBeDefined();
  });

  it('uses the 90-day TTL when rememberDevice is set', async () => {
    const { loginPartner } = await import('@/app/actions/partner-auth');
    await loginPartner(ACTIVE_ID, '1234', { rememberDevice: true });
    const live = state.cookieSets.find((call) => call.name === PARTNER_SESSION_COOKIE_NAME);
    expect(live?.options.maxAge).toBe(PARTNER_COOKIE_KIOSK_MAX_AGE);
  });

  it('keeps independent sessions for two tablets at the same restaurant', async () => {
    const { loginPartner } = await import('@/app/actions/partner-auth');
    await loginPartner(ACTIVE_ID, '1234');
    const first = state.jar[PARTNER_SESSION_COOKIE_NAME];
    const firstHash = hashPartnerSessionToken(first)!;
    delete state.jar[PARTNER_SESSION_COOKIE_NAME];
    await loginPartner(ACTIVE_ID, '1234');
    const secondHash = hashPartnerSessionToken(state.jar[PARTNER_SESSION_COOKIE_NAME])!;
    expect(state.sessions.has(firstHash)).toBe(true);
    expect(state.sessions.has(secondHash)).toBe(true);
    expect(firstHash).not.toBe(secondHash);
  });

  it('rolls back the new row and preserves the old session when cookie set throws', async () => {
    const previous = putSession(ACTIVE_ID);
    state.cookieSetShouldThrow = true;
    const { loginPartner } = await import('@/app/actions/partner-auth');
    const result = await loginPartner(ACTIVE_ID, '1234');
    expect(result).toEqual({ ok: false, error: PARTNER_SESSION_START_FAILED_MESSAGE });
    expect(state.jar[PARTNER_SESSION_COOKIE_NAME]).toBe(previous.token);
    expect(state.sessions.has(previous.tokenHash)).toBe(true);
    expect(state.sessions.size).toBe(1);
  });

  it('does not overwrite the old session when insert fails', async () => {
    const previous = putSession(ACTIVE_ID);
    state.insertError = true;
    const { loginPartner } = await import('@/app/actions/partner-auth');
    const result = await loginPartner(ACTIVE_ID, '1234');
    expect(result).toEqual({ ok: false, error: PARTNER_SESSION_START_FAILED_MESSAGE });
    expect(state.jar[PARTNER_SESSION_COOKIE_NAME]).toBe(previous.token);
    expect(state.sessions.has(previous.tokenHash)).toBe(true);
  });

  it('still logs in if the previous hash cannot be revoked after the new cookie is set', async () => {
    const previous = putSession(ACTIVE_ID);
    state.deleteError = true;
    const { loginPartner } = await import('@/app/actions/partner-auth');
    const result = await loginPartner(ACTIVE_ID, '1234');
    expect(result).toEqual({ ok: true, restaurantName: 'Active Grill' });
    expect(state.jar[PARTNER_SESSION_COOKIE_NAME]).not.toBe(previous.token);
    expect(state.sessions.has(previous.tokenHash)).toBe(true);
    expect(state.sessions.size).toBe(2);
  });

  it('returns a generic error and keeps cookies when logout delete fails', async () => {
    putSession(ACTIVE_ID);
    state.deleteError = true;
    const { logoutPartner } = await import('@/app/actions/partner-auth');
    const result = await logoutPartner();
    expect(result).toEqual({ ok: false, error: PARTNER_LOGOUT_FAILED_MESSAGE });
    expect(state.jar[PARTNER_SESSION_COOKIE_NAME]).toBeDefined();
  });

  it('treats a missing or malformed cookie as a successful logout', async () => {
    const { logoutPartner } = await import('@/app/actions/partner-auth');
    await expect(logoutPartner()).resolves.toEqual({ ok: true });
    state.jar[PARTNER_SESSION_COOKIE_NAME] = ACTIVE_ID;
    state.jar[LEGACY_PARTNER_COOKIE_NAME] = ACTIVE_ID;
    await expect(logoutPartner()).resolves.toEqual({ ok: true });
    expect(state.jar[PARTNER_SESSION_COOKIE_NAME]).toBeUndefined();
    expect(state.jar[LEGACY_PARTNER_COOKIE_NAME]).toBeUndefined();
  });
});

describe('session-bound partner analytics and verify', () => {
  beforeEach(() => {
    state.jar = {};
    state.cookieSetShouldThrow = false;
    state.insertError = false;
    state.deleteError = false;
    state.analyticsError = false;
    state.sessions = new Map();
    state.restaurants = new Map();
    state.redemptions = [];
    state.redemptionRestaurantIds = [];
    state.cookieSets = [];
    seedRestaurants();
  });

  it('refuses analytics without a valid session', async () => {
    const { getPartnerAnalytics, getPartnerRedemptionsThisMonth } = await import(
      '@/app/actions/partner-auth'
    );
    await expect(getPartnerAnalytics()).resolves.toEqual({
      ok: false,
      error: PARTNER_SESSION_EXPIRED_MESSAGE,
    });
    await expect(getPartnerRedemptionsThisMonth()).resolves.toEqual({
      ok: false,
      error: PARTNER_SESSION_EXPIRED_MESSAGE,
    });
    expect(state.redemptionRestaurantIds).toEqual([]);
  });

  it('scopes analytics queries to the session restaurant and hides raw errors', async () => {
    putSession(ACTIVE_ID);
    const { getPartnerAnalytics } = await import('@/app/actions/partner-auth');
    const ok = await getPartnerAnalytics();
    expect(ok.ok).toBe(true);
    expect(state.redemptionRestaurantIds.every((id) => id === ACTIVE_ID)).toBe(true);

    state.analyticsError = true;
    await expect(getPartnerAnalytics()).resolves.toEqual({
      ok: false,
      error: PARTNER_ANALYTICS_UNAVAILABLE_MESSAGE,
    });
  });

  it('binds verify to the session restaurant', async () => {
    putSession(ACTIVE_ID);
    const code = 'WB-G3TEST';
    state.redemptions.push({
      id: 'redemption-1',
      user_id: 'user-1',
      restaurant_id: OTHER_ID,
      status: 'issued',
      token_hash: hashRedemptionToken(code),
      verified_at: null,
    });
    const { verifyRedemptionTokenForPartner } = await import('@/app/actions/partner-verify');
    await expect(verifyRedemptionTokenForPartner(code)).resolves.toEqual({
      success: false,
      message: 'This code is not for your restaurant.',
    });
  });

  it('refuses verify when the partner session is missing', async () => {
    const { verifyRedemptionTokenForPartner } = await import('@/app/actions/partner-verify');
    await expect(verifyRedemptionTokenForPartner('WB-ANY')).resolves.toEqual({
      success: false,
      message: PARTNER_SESSION_EXPIRED_MESSAGE,
    });
  });
});
