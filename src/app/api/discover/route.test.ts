import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  DISCOVERY_ALLERGY_ERROR,
  DISCOVERY_MESSAGE_TOO_LONG_ERROR,
  discoveryCardSentence,
} from '@/lib/discovery-turn';
import { parseDiscoverSse } from '@/lib/discover/events';
import { ROULETTE_MAX_MESSAGE_CHARS } from '@/lib/ai-bounds';

const { allowBillableRoulette, getUser, from, fetchMock, rpcs } = vi.hoisted(() => ({
  allowBillableRoulette: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
  fetchMock: vi.fn(),
  rpcs: {
    rpcAiCurrentVersions: vi.fn(),
    rpcAiDispatch: vi.fn(),
    rpcAiFailBeforeDispatch: vi.fn(),
    rpcAiLoadResultPayload: vi.fn(),
    rpcAiMarkAssumedSpent: vi.fn(),
    rpcAiReconcile: vi.fn(),
    rpcAiRecoverStaleRequests: vi.fn(),
    rpcAiReleaseCustomerAllowance: vi.fn(),
    rpcAiReserve: vi.fn(),
    rpcAiSettle: vi.fn(),
    rpcAiStoreResultPayload: vi.fn(),
  },
}));

vi.mock('@/lib/ratelimit', () => ({
  allowBillableRoulette: (...args: unknown[]) => allowBillableRoulette(...args),
}));

vi.mock('@/lib/ai-budget/rpcs', () => rpcs);

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: () => getUser() },
  }),
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ from }),
}));

vi.mock('@/lib/launch-market-server', () => ({
  requireLaunchMarketId: async () => ({ ok: true, marketId: 'market-1' }),
}));

import { GET, POST } from '@/app/api/discover/route';
import { POST as roulettePost } from '@/app/api/roulette/route';

const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOTE = 'note-body-private';
const API_KEY = 'sk-ant-test-key';
const SIGNING = 'test-guest-signing-secret';
const IP_SECRET = 'test-ip-hash-secret-value';
const IP = '203.0.113.10';

const VEGAN = {
  id: 'rest-vegan',
  name: 'Green Table',
  cuisine_tags: ['vegan', 'noodles'],
  neighborhood: 'Downtown',
  address: '1 Main',
  price_range: '$$',
  image_url: null,
  google_place_id: null,
  is_dairy_free: true,
  is_vegan: true,
  is_halal: false,
  status: 'active',
};

const BBQ = {
  id: 'rest-bbq',
  name: 'Smokehouse',
  cuisine_tags: ['bbq'],
  neighborhood: 'East',
  address: '2 Main',
  price_range: '$$',
  image_url: null,
  google_place_id: null,
  is_dairy_free: false,
  is_vegan: false,
  is_halal: false,
  status: 'active',
};

const HIDDEN = [
  { ...BBQ, id: 'paused-row', name: 'Paused Grill', status: 'paused' },
  { ...BBQ, id: 'hidden-row', name: 'Hidden Test Grill', status: 'hidden' },
  { ...BBQ, id: 'test-row', name: 'Test Kitchen', status: 'test' },
];

type RestaurantRow = typeof VEGAN;

let restaurantRows: RestaurantRow[] = [VEGAN];
let profileDietary: string[] = [];
let tables: string[] = [];
let offerVersion: Record<string, unknown> | null = null;
let offerAudits: Record<string, unknown>[] = [];
let warn: ReturnType<typeof vi.spyOn>;
let errorLog: ReturnType<typeof vi.spyOn>;

function post(options?: {
  message?: string;
  body?: Record<string, unknown>;
  ip?: string | null;
  user?: boolean;
}): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (options?.ip !== null) headers.set('x-forwarded-for', options?.ip ?? IP);
  return new NextRequest('http://localhost/api/discover', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: options?.message ?? `spicy noodles ${NOTE}`,
      ...options?.body,
    }),
  });
}

function anthropicResponse(text: string, status = 200): Response {
  return new Response(
    JSON.stringify({
      content: [{ type: 'text', text }],
      usage: { input_tokens: 12, output_tokens: 4 },
    }),
    { status, headers: { 'request-id': 'provider-req' } },
  );
}

function enableConfig(): void {
  vi.stubEnv('WANDERBITE_AI_DISABLED', '');
  vi.stubEnv('ANTHROPIC_API_KEY', API_KEY);
  vi.stubEnv('WANDERBITE_GUEST_SIGNING_SECRET', SIGNING);
  vi.stubEnv('WANDERBITE_IP_HASH_SECRET', IP_SECRET);
  vi.stubEnv('DISCOVER_STREAM_ENABLED', 'true');
  vi.stubEnv('CHECKOUT_ENABLED', '');
  delete process.env.E05_RECIPES_ENABLED;
  delete process.env.E05_RECIPE_QA_ENABLED;
}

function ledgerRow(acquired: boolean) {
  return {
    acquired,
    customer_released: false,
    deny_reason: null,
    request_id: 'req-ledger-1',
    reserved_customer_microdollars: 0,
    reserved_platform_microdollars: 0,
    settled_customer_microdollars: 0,
    settled_platform_microdollars: 0,
    status: acquired ? 'reserved' : 'denied',
  };
}

describe('Discover stream route', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    enableConfig();
    restaurantRows = [VEGAN, BBQ, ...HIDDEN];
    profileDietary = [];
    tables = [];
    offerVersion = null;
    offerAudits = [];
    allowBillableRoulette.mockReset();
    allowBillableRoulette.mockResolvedValue(true);
    getUser.mockReset();
    getUser.mockResolvedValue({ data: { user: null } });
    from.mockReset();
    from.mockImplementation((table: string) => {
      tables.push(table);
      const api = {
        select: () => api,
        eq: () => api,
        in: () => api,
        maybeSingle: async () => {
          if (table === 'user_profiles') {
            return {
              data: {
                subscription_status: 'active',
                dietary_flags: profileDietary,
                allergy_flags: [],
              },
              error: null,
            };
          }
          if (table === 'user_preferences') {
            return { data: { excluded_cuisines: [] }, error: null };
          }
          if (table === 'restaurants' && offerVersion) {
            return {
              data: {
                id: VEGAN.id,
                status: 'active',
                current_offer_version_id: 'ver-1',
              },
              error: null,
            };
          }
          if (table === 'offer_versions') {
            return { data: offerVersion, error: null };
          }
          return { data: null, error: null };
        },
        then: (
          resolve: (value: { data: unknown; error: null }) => unknown,
          reject?: (reason: unknown) => unknown,
        ) =>
          Promise.resolve(
            table === 'restaurants'
              ? { data: restaurantRows, error: null }
              : table === 'admin_audit_log'
                ? { data: offerAudits, error: null }
                : { data: null, error: null },
          ).then(resolve, reject),
      };
      return api;
    });
    fetchMock.mockReset();
    fetchMock.mockImplementation(() =>
      Promise.resolve(anthropicResponse(JSON.stringify({ restaurantId: VEGAN.id }))),
    );
    vi.stubGlobal('fetch', fetchMock);
    for (const fn of Object.values(rpcs)) fn.mockReset();
    rpcs.rpcAiCurrentVersions.mockResolvedValue({
      config_version_id: 'cfg-1',
      price_version_id: 'price-1',
    });
    rpcs.rpcAiReserve.mockResolvedValue(ledgerRow(true));
    rpcs.rpcAiDispatch.mockResolvedValue(ledgerRow(true));
    rpcs.rpcAiLoadResultPayload.mockResolvedValue({ result_payload: null });
    rpcs.rpcAiRecoverStaleRequests.mockResolvedValue(undefined);
    rpcs.rpcAiSettle.mockResolvedValue(ledgerRow(true));
    rpcs.rpcAiStoreResultPayload.mockResolvedValue(undefined);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    errorLog.mockRestore();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('returns 404 when the flag is unset and leaves /api/roulette on JSON', async () => {
    vi.stubEnv('DISCOVER_STREAM_ENABLED', '');
    const hidden = await POST(post());
    expect(hidden.status).toBe(404);
    await expect(hidden.json()).resolves.toEqual({ error: 'Not found.' });
    expect(hidden.headers.get('content-type')).not.toContain('text/event-stream');
    expect(fetchMock).not.toHaveBeenCalled();

    const roulette = await roulettePost(post());
    expect(roulette.status).toBe(200);
    expect(roulette.headers.get('content-type')).toContain('application/json');
    const body = (await roulette.json()) as { restaurantId: string; selectionMode: string };
    expect(body).toMatchObject({ restaurantId: VEGAN.id, selectionMode: 'ai' });
  });

  it('rejects TRUE and a GET the same way while the flag is off', async () => {
    vi.stubEnv('DISCOVER_STREAM_ENABLED', 'TRUE');
    expect((await POST(post())).status).toBe(404);
    expect((await GET()).status).toBe(404);
  });

  it('streams parse, filter, and pick for a guest spicy-noodles ask', async () => {
    const response = await POST(post());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const events = parseDiscoverSse(await response.text());
    expect(events.map((event) => (event.type === 'step' ? event.id : event.type))).toEqual([
      'parse',
      'filter',
      'pick',
    ]);
    const filter = events[1];
    expect(filter).toMatchObject({ type: 'step', id: 'filter', total: 2 });
    if (filter?.type === 'step' && filter.id === 'filter') {
      expect(filter.sample.map((partner) => partner.id)).toEqual([VEGAN.id, BBQ.id]);
      for (const hiddenId of ['paused-row', 'hidden-row', 'test-row']) {
        expect(filter.sample.map((partner) => partner.id)).not.toContain(hiddenId);
      }
    }
    const pick = events[2];
    expect(pick).toMatchObject({
      type: 'pick',
      food: 'dumpling',
      isNewToMember: false,
      partner: { id: VEGAN.id, name: VEGAN.name },
    });
    if (pick?.type === 'pick') {
      expect(pick.partner.offer).toBeUndefined();
      expect(pick.reason).toBe(discoveryCardSentence(VEGAN, 'McKinney, Texas'));
    }
    expect(JSON.stringify(events)).not.toContain(NOTE);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(NOTE);
    expect(tables).not.toEqual(expect.arrayContaining(['redemptions', 'bite_notes']));
  });

  it('omits memory for a signed-in member with no history read', async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER } } });
    const response = await POST(post({ user: true }));
    const events = parseDiscoverSse(await response.text());
    expect(events.some((event) => event.type === 'step' && event.id === 'memory')).toBe(false);
    expect(events.some((event) => event.type === 'step' && event.id === 'rank')).toBe(false);
    expect(tables).toEqual(expect.arrayContaining(['user_profiles', 'user_preferences', 'restaurants']));
    expect(tables).not.toEqual(expect.arrayContaining(['redemptions', 'bite_notes']));
  });

  it('keeps every streamed partner inside a saved dietary filter, including fallback', async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER } } });
    profileDietary = ['vegan'];
    vi.stubEnv('WANDERBITE_AI_DISABLED', 'true');
    const response = await POST(post({ user: true }));
    const events = parseDiscoverSse(await response.text());
    const blob = JSON.stringify(events);
    expect(blob).not.toContain(BBQ.id);
    expect(blob).not.toContain('paused-row');
    expect(blob).not.toContain('hidden-row');
    expect(blob).not.toContain('test-row');
    const fallback = events.find((event) => event.type === 'fallback');
    expect(fallback).toMatchObject({
      type: 'fallback',
      reason: 'no_match',
      alternative: { id: VEGAN.id },
    });
    if (fallback?.type === 'fallback') {
      expect(fallback.message).toContain('Alternative:');
      expect(fallback.message.toLowerCase()).toContain('not a match');
    }
    expect(events.some((event) => event.type === 'pick')).toBe(false);
    const filter = events.find((event) => event.type === 'step' && event.id === 'filter');
    if (filter?.type === 'step' && filter.id === 'filter') {
      expect(filter.total).toBe(1);
      expect(
        filter.sample.every((partner) => partner.id === VEGAN.id),
      ).toBe(true);
    }
    const parse = events.find((event) => event.type === 'step' && event.id === 'parse');
    if (parse?.type === 'step' && parse.id === 'parse') {
      expect(parse.constraints).toEqual([
        expect.objectContaining({ key: 'dietary', label: 'Vegan', required: true }),
      ]);
    }
  });

  it('returns the same pick as /api/roulette for the same mocked input', async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER } } });
    const requestFor = (path: string) =>
      new NextRequest(`http://localhost${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': IP },
        body: JSON.stringify({ message: `spicy noodles ${NOTE}`, preferredCuisine: 'japanese' }),
      });
    const streamed = await POST(requestFor('/api/discover'));
    const json = await roulettePost(requestFor('/api/roulette'));
    const events = parseDiscoverSse(await streamed.text());
    const body = (await json.json()) as {
      restaurantId: string;
      restaurantName: string;
      reason: string;
      selectionMode: string;
    };
    const pick = events.find((event) => event.type === 'pick');
    expect(body.selectionMode).toBe('ai');
    expect(pick).toMatchObject({
      type: 'pick',
      reason: body.reason,
      partner: { id: body.restaurantId, name: body.restaurantName },
    });
  });

  it('emits provider_error and timeout fallbacks instead of crashing', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ error: 'nope' }), { status: 503 })),
    );
    const errored = await POST(post());
    expect(errored.status).toBe(200);
    const errorEvents = parseDiscoverSse(await errored.text());
    expect(errorEvents.at(-1)).toMatchObject({
      type: 'fallback',
      reason: 'provider_error',
      alternative: { id: VEGAN.id },
    });

    vi.useFakeTimers();
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const fail = () => {
          const error = new Error('The operation was aborted');
          error.name = 'AbortError';
          reject(error);
        };
        if (init?.signal?.aborted) {
          fail();
          return;
        }
        init?.signal?.addEventListener('abort', fail);
      });
    });
    const pending = POST(post());
    await vi.advanceTimersByTimeAsync(7_000);
    const timedOut = await pending;
    expect(timedOut.status).toBe(200);
    const timeoutEvents = parseDiscoverSse(await timedOut.text());
    expect(timeoutEvents.at(-1)).toMatchObject({ type: 'fallback', reason: 'timeout' });
    expect(
      warn.mock.calls.some(
        (call: unknown[]) => call[0] === '[roulette] anthropic timeout — using template fallback',
      ),
    ).toBe(true);
  });

  it('rejects an over-long message the same way as /api/roulette', async () => {
    const message = 'a'.repeat(ROULETTE_MAX_MESSAGE_CHARS + 1);
    const streamed = await POST(post({ message }));
    const json = await roulettePost(post({ message }));
    expect(streamed.status).toBe(json.status);
    expect(streamed.status).toBe(400);
    expect(streamed.headers.get('content-type')).not.toContain('text/event-stream');
    await expect(streamed.json()).resolves.toEqual({ error: DISCOVERY_MESSAGE_TOO_LONG_ERROR });
    await expect(json.json()).resolves.toEqual({ error: DISCOVERY_MESSAGE_TOO_LONG_ERROR });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the allergy block as JSON', async () => {
    const message = 'I cannot have shrimp';
    const streamed = await POST(post({ message }));
    const json = await roulettePost(post({ message }));
    expect(streamed.status).toBe(422);
    expect(json.status).toBe(422);
    await expect(streamed.json()).resolves.toEqual({ error: DISCOVERY_ALLERGY_ERROR });
    await expect(json.json()).resolves.toEqual({ error: DISCOVERY_ALLERGY_ERROR });
  });

  it('adds a real offer only for a member ai pick while checkout is on', async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER } } });
    vi.stubEnv('CHECKOUT_ENABLED', 'true');
    offerVersion = {
      id: 'ver-1',
      restaurant_id: VEGAN.id,
      tiers: [{ threshold_cents: 4000, discount_cents: 1000 }],
      valid_from: '2020-01-01T00:00:00.000Z',
      valid_until: '2028-01-01T00:00:00.000Z',
      withdrawn_from_selection_at: null,
    };
    offerAudits = [];
    const response = await POST(post({ user: true }));
    const events = parseDiscoverSse(await response.text());
    const pick = events.find((event) => event.type === 'pick');
    expect(pick).toMatchObject({
      type: 'pick',
      partner: { id: VEGAN.id, offer: { amountOff: 1000, minSpend: 4000 } },
    });

    offerAudits = [
      {
        action: 'offer.test_mark',
        target_type: 'offer_version',
        target_id: 'ver-1',
        metadata: { is_test: true },
      },
    ];
    const testOffer = parseDiscoverSse(await (await POST(post({ user: true }))).text());
    const hiddenOffer = testOffer.find((event) => event.type === 'pick');
    if (hiddenOffer?.type === 'pick') expect(hiddenOffer.partner.offer).toBeUndefined();

    vi.stubEnv('WANDERBITE_AI_DISABLED', 'true');
    const fallback = parseDiscoverSse(await (await POST(post({ user: true }))).text());
    expect(fallback.some((event) => event.type === 'pick')).toBe(false);
    expect(JSON.stringify(fallback)).not.toContain('amountOff');
  });

  it('does not read offers for a guest or while checkout is paused', async () => {
    offerVersion = {
      id: 'ver-1',
      restaurant_id: VEGAN.id,
      tiers: [{ threshold_cents: 4000, discount_cents: 1000 }],
      valid_from: '2020-01-01T00:00:00.000Z',
      valid_until: '2028-01-01T00:00:00.000Z',
      withdrawn_from_selection_at: null,
    };
    const guest = parseDiscoverSse(await (await POST(post())).text());
    const guestPick = guest.find((event) => event.type === 'pick');
    if (guestPick?.type === 'pick') expect(guestPick.partner.offer).toBeUndefined();
    expect(tables).not.toContain('offer_versions');

    tables = [];
    getUser.mockResolvedValue({ data: { user: { id: USER } } });
    const member = parseDiscoverSse(await (await POST(post({ user: true }))).text());
    const memberPick = member.find((event) => event.type === 'pick');
    if (memberPick?.type === 'pick') expect(memberPick.partner.offer).toBeUndefined();
    expect(tables).not.toContain('offer_versions');
  });
});
