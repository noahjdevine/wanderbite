import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { discoveryReplayMac } from '@/lib/ai-guest';
import {
  DISCOVER_AI_PICK_LOG,
  DISCOVER_FALLBACK_LOG,
  DISCOVER_FALLBACK_REASONS,
  type DiscoverAiPickLog,
  type DiscoverFallbackLog,
  type DiscoverFallbackReason,
} from '@/lib/discover/fallback-reason';
import {
  DISCOVERY_REPLAY_MISMATCH_ERROR,
  buildStoredDiscoveryPayload,
  canonicalFilterString,
  discoveryCardSentence,
} from '@/lib/discovery-turn';
import { restaurantMatchesDietaryQuick } from '@/lib/roulette-dietary';

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

import { POST } from '@/app/api/roulette/route';

const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EMAIL = 'member@example.com';
const IP = '203.0.113.10';
const MESSAGE = 'quiet Japanese date night';
const NOTE = 'note-body-private';
const API_KEY = 'sk-ant-test-key';
const MODEL_SECRET = 'model-output-secret';
const IDEMPOTENCY = '11111111-1111-4111-8111-111111111111';
const LEDGER_ID = 'req-ledger-1';
const SIGNING = 'test-guest-signing-secret';
const IP_SECRET = 'test-ip-hash-secret-value';

const VEGAN = {
  id: 'rest-vegan',
  name: 'Green Table',
  cuisine_tags: ['vegan'],
  neighborhood: 'Downtown',
  address: '1 Main',
  price_range: '$$',
  image_url: null,
  google_place_id: null,
  is_dairy_free: true,
  is_vegan: true,
  is_halal: false,
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
};

type RestaurantRow = typeof VEGAN;

let restaurantRows: RestaurantRow[] = [VEGAN];
let warn: ReturnType<typeof vi.spyOn>;

function post(options?: { body?: Record<string, unknown>; ip?: string | null }): NextRequest {
  const headers = new Headers({
    'content-type': 'application/json',
    'idempotency-key': IDEMPOTENCY,
  });
  if (options?.ip !== null) headers.set('x-forwarded-for', options?.ip ?? IP);
  return new NextRequest('http://localhost/api/roulette', {
    method: 'POST',
    headers,
    body: JSON.stringify({ message: `${MESSAGE} ${NOTE}`, ...options?.body }),
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
  delete process.env.E05_RECIPES_ENABLED;
  delete process.env.E05_RECIPE_QA_ENABLED;
}

function ledgerRow(acquired: boolean, denyReason: string | null) {
  return {
    acquired,
    customer_released: false,
    deny_reason: denyReason,
    request_id: LEDGER_ID,
    reserved_customer_microdollars: 0,
    reserved_platform_microdollars: 0,
    settled_customer_microdollars: 0,
    settled_platform_microdollars: 0,
    status: acquired ? 'reserved' : 'denied',
  };
}

function fallbackLogs(): DiscoverFallbackLog[] {
  return warn.mock.calls
    .filter((call: unknown[]) => call[0] === DISCOVER_FALLBACK_LOG)
    .map((call: unknown[]) => call[1] as DiscoverFallbackLog);
}

function aiPickLogs(): DiscoverAiPickLog[] {
  return warn.mock.calls
    .filter((call: unknown[]) => call[0] === DISCOVER_AI_PICK_LOG)
    .map((call: unknown[]) => call[1] as DiscoverAiPickLog);
}

function assertSafeLogs(): void {
  const discover = warn.mock.calls.filter(
    (call: unknown[]) => call[0] === DISCOVER_FALLBACK_LOG || call[0] === DISCOVER_AI_PICK_LOG,
  );
  const blob = JSON.stringify(discover);
  for (const secret of [USER, EMAIL, IP, MESSAGE, NOTE, API_KEY, MODEL_SECRET]) {
    expect(blob).not.toContain(secret);
  }
  for (const call of discover) {
    const payload = call[1] as Record<string, unknown>;
    const allowed =
      call[0] === DISCOVER_AI_PICK_LOG
        ? ['requestId', 'poolSize']
        : ['reason', 'requestId', 'memberType', 'poolSize', 'dietaryFilterCount', 'providerStatus'];
    expect(Object.keys(payload).every((key) => allowed.includes(key))).toBe(true);
    expect(payload).not.toHaveProperty('message');
    expect(payload).not.toHaveProperty('note');
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('userId');
    expect(payload).not.toHaveProperty('ip');
    expect(payload).not.toHaveProperty('token');
  }
}

async function expectFallback(
  reason: DiscoverFallbackReason,
  requestId: string,
  response: Response,
): Promise<DiscoverFallbackLog> {
  expect(response.status).toBe(200);
  const body = (await response.clone().json()) as { selectionMode: string; reason: string };
  expect(body.selectionMode).toBe('random_fallback');
  expect(body.reason).not.toBe(reason);
  expect(body.reason).not.toContain(MESSAGE);
  const lines = fallbackLogs();
  expect(lines).toHaveLength(1);
  expect(aiPickLogs()).toHaveLength(0);
  expect(lines[0]).toMatchObject({
    reason,
    requestId,
    memberType: 'member',
    poolSize: restaurantRows.length,
    dietaryFilterCount: 0,
  });
  assertSafeLogs();
  return lines[0]!;
}

describe('Discover fallback reasons', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    enableConfig();
    restaurantRows = [VEGAN];
    allowBillableRoulette.mockReset();
    allowBillableRoulette.mockResolvedValue(true);
    getUser.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: USER, email: EMAIL } } });
    from.mockReset();
    from.mockImplementation((table: string) => {
      const api = {
        select: () => api,
        eq: () => api,
        maybeSingle: async () => {
          if (table === 'user_profiles') {
            return {
              data: { subscription_status: 'active', dietary_flags: [], allergy_flags: [] },
              error: null,
            };
          }
          if (table === 'user_preferences') {
            return { data: { excluded_cuisines: [] }, error: null };
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
              : { data: null, error: null },
          ).then(resolve, reject),
      };
      return api;
    });
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error('fetch should not run'));
    vi.stubGlobal('fetch', fetchMock);
    for (const fn of Object.values(rpcs)) fn.mockReset();
    rpcs.rpcAiCurrentVersions.mockResolvedValue({
      config_version_id: 'cfg-1',
      price_version_id: 'price-1',
    });
    rpcs.rpcAiReserve.mockResolvedValue(ledgerRow(true, null));
    rpcs.rpcAiDispatch.mockResolvedValue(ledgerRow(true, null));
    rpcs.rpcAiLoadResultPayload.mockResolvedValue({
      deny_reason: '',
      request_id: LEDGER_ID,
      result_payload: null,
      status: 'reserved',
    });
    rpcs.rpcAiRecoverStaleRequests.mockResolvedValue(undefined);
    rpcs.rpcAiFailBeforeDispatch.mockResolvedValue(undefined);
    rpcs.rpcAiMarkAssumedSpent.mockResolvedValue(undefined);
    rpcs.rpcAiReconcile.mockResolvedValue(undefined);
    rpcs.rpcAiReleaseCustomerAllowance.mockResolvedValue(undefined);
    rpcs.rpcAiSettle.mockResolvedValue(ledgerRow(true, null));
    rpcs.rpcAiStoreResultPayload.mockResolvedValue(undefined);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('logs ai_disabled and keeps the random_fallback response', async () => {
    vi.stubEnv('WANDERBITE_AI_DISABLED', 'true');
    const response = await POST(post());
    const body = await response.clone().json();
    await expectFallback('ai_disabled', IDEMPOTENCY, response);
    expect(body).toEqual({
      restaurantId: VEGAN.id,
      restaurantName: VEGAN.name,
      reason: discoveryCardSentence(VEGAN, 'McKinney, Texas'),
      cuisine_tags: VEGAN.cuisine_tags,
      neighborhood: VEGAN.neighborhood,
      address: VEGAN.address,
      price_range: VEGAN.price_range,
      image_url: null,
      google_place_id: null,
      selectionMode: 'random_fallback',
    });
    expect(allowBillableRoulette).not.toHaveBeenCalled();
    expect(rpcs.rpcAiReserve).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs missing_config when the API key, guest secret, or IP hash secret is absent', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    await expectFallback('missing_config', IDEMPOTENCY, await POST(post()));

    enableConfig();
    vi.stubEnv('WANDERBITE_GUEST_SIGNING_SECRET', 'short');
    warn.mockClear();
    await expectFallback('missing_config', IDEMPOTENCY, await POST(post()));

    enableConfig();
    vi.stubEnv('WANDERBITE_IP_HASH_SECRET', 'short');
    warn.mockClear();
    await expectFallback('missing_config', IDEMPOTENCY, await POST(post()));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs missing_identity when the trusted IP is absent', async () => {
    const response = await POST(post({ ip: null }));
    await expectFallback('missing_identity', IDEMPOTENCY, response);
    expect(allowBillableRoulette).not.toHaveBeenCalled();
  });

  it('logs rate_limited when allowBillableRoulette returns false', async () => {
    allowBillableRoulette.mockResolvedValue(false);
    await expectFallback('rate_limited', IDEMPOTENCY, await POST(post()));
    expect(allowBillableRoulette).toHaveBeenCalledOnce();
    expect(rpcs.rpcAiReserve).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['insufficient_budget', 'guest_turns_exhausted', 'paid_core_reserve', 'zero_quote'])(
    'logs budget_exceeded when reserve denies with %s',
    async (deny) => {
      rpcs.rpcAiReserve.mockResolvedValue(ledgerRow(false, deny));
      await expectFallback('budget_exceeded', LEDGER_ID, await POST(post()));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(rpcs.rpcAiDispatch).not.toHaveBeenCalled();
      expect(rpcs.rpcAiSettle).not.toHaveBeenCalled();
    },
  );

  it('logs guest_transferred when the guest ledger row was already transferred', async () => {
    rpcs.rpcAiReserve.mockResolvedValue(ledgerRow(false, 'guest_already_transferred'));
    await expectFallback('guest_transferred', LEDGER_ID, await POST(post()));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs missing_metadata when a replay has no stored card', async () => {
    rpcs.rpcAiReserve.mockResolvedValue(ledgerRow(false, ''));
    rpcs.rpcAiLoadResultPayload.mockResolvedValue({
      deny_reason: '',
      request_id: LEDGER_ID,
      result_payload: null,
      status: 'dispatched',
    });
    await expectFallback('missing_metadata', LEDGER_ID, await POST(post()));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs invalid_pick when a stored id is no longer in the pool', async () => {
    rpcs.rpcAiReserve.mockResolvedValue(ledgerRow(false, ''));
    rpcs.rpcAiLoadResultPayload.mockResolvedValue({
      deny_reason: '',
      request_id: LEDGER_ID,
      result_payload: { restaurantId: 'left-the-pool', selectionMode: 'random_fallback' },
      status: 'settled',
    });
    const response = await POST(post());
    await expectFallback('invalid_pick', LEDGER_ID, response);
    const body = (await response.clone().json()) as { restaurantId: string };
    expect(body.restaurantId).toBe(VEGAN.id);
  });

  it('logs replay_fallback and returns the stored non-AI card', async () => {
    const message = `${MESSAGE} ${NOTE}`;
    const messageMac = discoveryReplayMac('message', message);
    const filterMac = discoveryReplayMac(
      'filter',
      canonicalFilterString({ dietary: [], excluded: [] }),
    );
    expect(messageMac && filterMac).toBeTruthy();
    rpcs.rpcAiReserve.mockResolvedValue(ledgerRow(false, ''));
    rpcs.rpcAiLoadResultPayload.mockResolvedValue({
      deny_reason: '',
      request_id: LEDGER_ID,
      result_payload: buildStoredDiscoveryPayload({
        restaurantId: VEGAN.id,
        selectionMode: 'random_fallback',
        promptIds: [VEGAN.id],
        messageMac: messageMac!,
        filterMac: filterMac!,
      }),
      status: 'settled',
    });
    const response = await POST(post());
    const body = (await response.clone().json()) as { restaurantId: string; selectionMode: string };
    await expectFallback('replay_fallback', LEDGER_ID, response);
    expect(body).toMatchObject({ restaurantId: VEGAN.id, selectionMode: 'random_fallback' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpcs.rpcAiStoreResultPayload).not.toHaveBeenCalled();
  });

  it('logs provider_error with the HTTP status and still stores the fallback card', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: MODEL_SECRET, token: API_KEY }), {
        status: 503,
        headers: { 'request-id': 'provider-req' },
      }),
    );
    const response = await POST(post());
    const line = await expectFallback('provider_error', LEDGER_ID, response);
    expect(line.providerStatus).toBe(503);
    expect(rpcs.rpcAiMarkAssumedSpent).toHaveBeenCalledWith(LEDGER_ID);
    expect(rpcs.rpcAiReleaseCustomerAllowance).toHaveBeenCalledWith(LEDGER_ID);
    expect(rpcs.rpcAiStoreResultPayload).toHaveBeenCalledWith(
      LEDGER_ID,
      expect.objectContaining({ restaurantId: VEGAN.id, selectionMode: 'random_fallback' }),
    );
    const stored = JSON.stringify(rpcs.rpcAiStoreResultPayload.mock.calls[0]?.[1]);
    expect(stored).not.toContain(MESSAGE);
    expect(stored).not.toContain(MODEL_SECRET);
  });

  it('logs provider_error when Anthropic times out', async () => {
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
    const response = await pending;
    const line = await expectFallback('provider_error', LEDGER_ID, response);
    expect(line.providerStatus).toBeUndefined();
    expect(
      warn.mock.calls.some(
        (call: unknown[]) => call[0] === '[roulette] anthropic timeout — using template fallback',
      ),
    ).toBe(true);
    expect(fallbackLogs()).toHaveLength(1);
  });

  it('logs parse_failed when the model text has no restaurant id', async () => {
    fetchMock.mockResolvedValue(anthropicResponse(`no id here ${MODEL_SECRET}`));
    const response = await POST(post());
    await expectFallback('parse_failed', LEDGER_ID, response);
    const body = (await response.clone().json()) as { reason: string };
    expect(body.reason).not.toContain(MODEL_SECRET);
    expect(rpcs.rpcAiReconcile).toHaveBeenCalled();
  });

  it('logs invalid_pick when the model id is outside the prompt pool', async () => {
    fetchMock.mockResolvedValue(
      anthropicResponse(JSON.stringify({ restaurantId: 'not-in-pool', note: MODEL_SECRET })),
    );
    const response = await POST(post());
    await expectFallback('invalid_pick', LEDGER_ID, response);
    const body = (await response.clone().json()) as { restaurantId: string };
    expect(body.restaurantId).toBe(VEGAN.id);
  });

  it('logs ai_pick and no fallback when the model id is in the pool', async () => {
    fetchMock.mockResolvedValue(
      anthropicResponse(JSON.stringify({ restaurantId: VEGAN.id, note: MODEL_SECRET })),
    );
    const response = await POST(post());
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      restaurantId: string;
      selectionMode: string;
      reason: string;
    };
    expect(body).toMatchObject({
      restaurantId: VEGAN.id,
      selectionMode: 'ai',
      reason: discoveryCardSentence(VEGAN, 'McKinney, Texas'),
    });
    expect(Object.keys(body).sort()).toEqual(
      [
        'address',
        'cuisine_tags',
        'google_place_id',
        'image_url',
        'neighborhood',
        'price_range',
        'reason',
        'restaurantId',
        'restaurantName',
        'selectionMode',
      ].sort(),
    );
    expect(fallbackLogs()).toHaveLength(0);
    expect(aiPickLogs()).toEqual([{ requestId: LEDGER_ID, poolSize: 1 }]);
    expect(rpcs.rpcAiSettle).toHaveBeenCalledWith(LEDGER_ID, expect.any(Object));
    const stored = rpcs.rpcAiStoreResultPayload.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(stored).toMatchObject({ restaurantId: VEGAN.id, selectionMode: 'ai' });
    expect(stored).not.toHaveProperty('message');
    expect(JSON.stringify(stored)).not.toContain(MESSAGE);
    assertSafeLogs();
  });

  it('returns 409 on a replay fingerprint mismatch and does not log a pick', async () => {
    const messageMac = discoveryReplayMac('message', 'a different ask');
    const filterMac = discoveryReplayMac(
      'filter',
      canonicalFilterString({ dietary: [], excluded: [] }),
    );
    rpcs.rpcAiReserve.mockResolvedValue(ledgerRow(false, ''));
    rpcs.rpcAiLoadResultPayload.mockResolvedValue({
      deny_reason: '',
      request_id: LEDGER_ID,
      result_payload: buildStoredDiscoveryPayload({
        restaurantId: VEGAN.id,
        selectionMode: 'ai',
        promptIds: [VEGAN.id],
        messageMac: messageMac!,
        filterMac: filterMac!,
      }),
      status: 'settled',
    });
    const response = await POST(post());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: DISCOVERY_REPLAY_MISMATCH_ERROR,
    });
    expect(fallbackLogs()).toHaveLength(0);
    expect(aiPickLogs()).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs ai_pick when an idempotent replay returns the stored AI card', async () => {
    const message = `${MESSAGE} ${NOTE}`;
    const messageMac = discoveryReplayMac('message', message);
    const filterMac = discoveryReplayMac(
      'filter',
      canonicalFilterString({ dietary: [], excluded: [] }),
    );
    rpcs.rpcAiReserve.mockResolvedValue(ledgerRow(false, ''));
    rpcs.rpcAiLoadResultPayload.mockResolvedValue({
      deny_reason: '',
      request_id: LEDGER_ID,
      result_payload: buildStoredDiscoveryPayload({
        restaurantId: VEGAN.id,
        selectionMode: 'ai',
        promptIds: [VEGAN.id],
        messageMac: messageMac!,
        filterMac: filterMac!,
      }),
      status: 'settled',
    });
    const response = await POST(post());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      restaurantId: VEGAN.id,
      selectionMode: 'ai',
    });
    expect(fallbackLogs()).toHaveLength(0);
    expect(aiPickLogs()).toEqual([{ requestId: LEDGER_ID, poolSize: 1 }]);
    expect(fetchMock).not.toHaveBeenCalled();
    assertSafeLogs();
  });

  it('picks the fallback only from restaurants that pass the dietary filter', async () => {
    restaurantRows = [VEGAN, BBQ];
    vi.stubEnv('WANDERBITE_AI_DISABLED', 'true');
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const response = await POST(post({ body: { dietaryQuick: ['vegan'] } }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { restaurantId: string; selectionMode: string };
    expect(body).toMatchObject({ restaurantId: VEGAN.id, selectionMode: 'random_fallback' });
    expect(restaurantMatchesDietaryQuick(VEGAN, ['vegan'])).toBe(true);
    expect(restaurantMatchesDietaryQuick(BBQ, ['vegan'])).toBe(false);
    expect(fallbackLogs()).toEqual([
      expect.objectContaining({
        reason: 'ai_disabled',
        poolSize: 1,
        dietaryFilterCount: 1,
        memberType: 'member',
      }),
    ]);
    assertSafeLogs();
  });

  it('returns 404 and does not log a fallback when every restaurant fails the dietary filter', async () => {
    restaurantRows = [BBQ];
    const response = await POST(post({ body: { dietaryQuick: ['vegan'] } }));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error:
        'No restaurants match those dietary filters yet. Try fewer options, or we may still be tagging partners — check back soon.',
    });
    expect(fallbackLogs()).toHaveLength(0);
    expect(aiPickLogs()).toHaveLength(0);
  });

  it('returns 503 and does not log a fallback when the catalog is empty', async () => {
    restaurantRows = [];
    const response = await POST(post());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'No restaurants available right now.',
    });
    expect(fallbackLogs()).toHaveLength(0);
  });

  it('passes a reason into every randomFallback call', () => {
    const route = readFileSync(
      path.join(path.resolve(__dirname, '../../../..'), 'src/app/api/roulette/route.ts'),
      'utf8',
    );
    const calls = [...route.matchAll(/randomFallback\(([^)]*)\)/g)].map((match) => match[1] ?? '');
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const args of calls) {
      expect(args.trim().length).toBeGreaterThan(0);
      expect(args).not.toBe('');
    }
    for (const reason of [
      'rate_limited',
      'missing_config',
      'missing_identity',
      'invalid_pick',
      'replay_fallback',
    ] as const) {
      expect(route).toContain(`'${reason}'`);
      expect(DISCOVER_FALLBACK_REASONS).toContain(reason);
    }
  });
});
