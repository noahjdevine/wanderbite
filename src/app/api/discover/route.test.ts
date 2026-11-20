import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  DISCOVERY_ALLERGY_ERROR,
  DISCOVERY_MESSAGE_TOO_LONG_ERROR,
  discoveryCardSentence,
} from '@/lib/discovery-turn';
import { parseDiscoverSse } from '@/lib/discover/events';
import { ROULETTE_MAX_MESSAGE_CHARS } from '@/lib/ai-bounds';

const { allowBillableRoulette, getUser, from, fetchMock, rpcs, serverFrom } = vi.hoisted(() => ({
  allowBillableRoulette: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
  fetchMock: vi.fn(),
  serverFrom: vi.fn(),
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
    from: (table: string) => serverFrom(table),
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
import {
  ANTHROPIC_HAIKU_SNAPSHOT,
  DISCOVER_LINE_MAX_OUTPUT_TOKENS,
  ROULETTE_MAX_OUTPUT_TOKENS,
} from '@/lib/ai-budget/models';
import { resetBriefingsLogs } from '@/lib/briefings/flag';
import { DISCOVER_AI_PICK_LOG, DISCOVER_FALLBACK_LOG } from '@/lib/discover/fallback-reason';
import { resetMemberVisitsReadLog } from '@/lib/discover/member-visits';
import type { BriefingRecord } from '@/lib/briefings/types';
import { DISCOVER_FACT_PROMPT_NOTE } from '@/lib/discover/briefing-facts';
import { LAUNCH_MARKET } from '@/lib/launch-market';

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

const TACO = {
  id: 'rest-taco',
  name: 'Taco House',
  cuisine_tags: ['mexican', 'tacos'],
  neighborhood: 'West',
  address: '3 Main',
  price_range: '$',
  image_url: null,
  google_place_id: null,
  is_dairy_free: false,
  is_vegan: false,
  is_halal: false,
  status: 'active',
};

const SALSA = {
  id: 'rest-salsa',
  name: 'Salsa Room',
  cuisine_tags: ['mexican'],
  neighborhood: 'East',
  address: '4 Main',
  price_range: '$',
  image_url: null,
  google_place_id: null,
  is_dairy_free: false,
  is_vegan: false,
  is_halal: false,
  status: 'active',
};

const LINE = 'Taco House is a bright West room for tacos.';

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

const CHECKED = '2026-11-05T06:00:00.000Z';
const MAPS = 'https://maps.google.com/maps/place/wanderbite-fact';
const FACT_SOURCE = 'https://example.com/wanderbite-fact';

type BriefingResult = { data: unknown; error: { code?: string; message?: string } | null };

let briefingResult: BriefingResult = { data: [], error: null };
let briefingCalls: unknown[][] = [];

type VisitRow = {
  restaurant_id: string;
  status: string;
  verified_at?: string | null;
};

let redemptionRows: VisitRow[] | null = [];
let redemptionError: { message: string } | null = null;
let redemptionThrow = false;
let redemptionQuery: unknown[][] = [];

function briefingApi() {
  const api = {
    select: () => api,
    eq: (column: string, value: string) => {
      briefingCalls.push(['eq', column, value]);
      return api;
    },
    in: (column: string, value: readonly string[]) => {
      briefingCalls.push(['in', column, value]);
      return api;
    },
    then: (
      resolve: (value: BriefingResult) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(briefingResult).then(resolve, reject),
  };
  return api;
}

function factRow(overrides: Partial<BriefingRecord> = {}): BriefingRecord {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    restaurant_id: VEGAN.id,
    field: 'vibe',
    body: 'The room is cozy and candlelit.',
    source_url: FACT_SOURCE,
    last_verified_at: CHECKED,
    status: 'active',
    is_sample: false,
    version: 1,
    ...overrides,
  };
}

function promptRowsFrom(content: string): Array<Record<string, unknown>> {
  const line = content.split('\n').find((item) => item.startsWith('['));
  if (!line) throw new Error('prompt has no restaurant array');
  return JSON.parse(line) as Array<Record<string, unknown>>;
}

function anthropicBody(call: unknown): {
  model: string;
  max_tokens: number;
  temperature: number;
  system: string;
  messages: { content: string }[];
} {
  const init = (call as [unknown, { body?: string }])[1];
  return JSON.parse(String(init?.body)) as {
    model: string;
    max_tokens: number;
    temperature: number;
    system: string;
    messages: { content: string }[];
  };
}

function expectedSystemPrompt(): string {
  return `You choose one restaurant id for a discovery app in ${LAUNCH_MARKET.displayName}.

Each request is independent. Do not default to the same restaurant. Choose exactly one id from the JSON array you receive.

Return ONLY a single JSON object, no markdown fences, no commentary before or after.
Required key: "restaurantId" (string id from the list). Do not include a reason, a vibe, or a dish.

{"restaurantId":"..."}`;
}

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
    delete process.env.E06_BRIEFINGS_ENABLED;
    delete process.env.DISCOVER_CODE_PICK_ENABLED;
    resetBriefingsLogs();
    resetMemberVisitsReadLog();
    briefingResult = { data: [], error: null };
    briefingCalls = [];
    redemptionRows = [];
    redemptionError = null;
    redemptionThrow = false;
    redemptionQuery = [];
    serverFrom.mockReset();
    serverFrom.mockImplementation((table: string) => {
      briefingCalls.push(['from', table]);
      return briefingApi();
    });
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
        select: (columns?: string) => {
          if (table === 'redemptions') redemptionQuery.push(['select', columns]);
          return api;
        },
        eq: (column?: string, value?: unknown) => {
          if (table === 'redemptions') redemptionQuery.push(['eq', column, value]);
          return api;
        },
        in: (column?: string, value?: unknown) => {
          if (table === 'redemptions') redemptionQuery.push(['in', column, value]);
          return api;
        },
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
          resolve: (value: { data: unknown; error: { message: string } | null }) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => {
          if (table === 'redemptions' && redemptionThrow) {
            return Promise.reject(new Error('visits down')).then(resolve, reject);
          }
          const payload =
            table === 'restaurants'
              ? { data: restaurantRows, error: null }
              : table === 'admin_audit_log'
                ? { data: offerAudits, error: null }
                : table === 'redemptions'
                  ? { data: redemptionRows, error: redemptionError }
                  : { data: null, error: null };
          return Promise.resolve(payload).then(resolve, reject);
        },
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

  it('labels a signed-in member with no verified visit as new', async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER } } });
    const response = await POST(post({ user: true }));
    const events = parseDiscoverSse(await response.text());
    expect(events.map((event) => (event.type === 'step' ? event.id : event.type))).toEqual([
      'parse',
      'filter',
      'memory',
      'pick',
    ]);
    expect(events.find((event) => event.type === 'step' && event.id === 'memory')).toMatchObject({
      line: "You haven't been to Green Table yet.",
    });
    expect(events.find((event) => event.type === 'pick')).toMatchObject({
      type: 'pick',
      isNewToMember: true,
      partner: { id: VEGAN.id },
    });
    expect(events.some((event) => event.type === 'step' && event.id === 'rank')).toBe(false);
    expect(tables).toEqual(expect.arrayContaining(['user_profiles', 'user_preferences', 'restaurants', 'redemptions']));
    expect(tables).not.toContain('bite_notes');
    expect(redemptionQuery).toEqual([
      ['select', 'restaurant_id, status'],
      ['eq', 'user_id', USER],
      ['eq', 'status', 'verified'],
      ['in', 'restaurant_id', [VEGAN.id, BBQ.id]],
    ]);
    const sent = anthropicBody(fetchMock.mock.calls[0]);
    expect(sent.system).toBe(expectedSystemPrompt());
    expect(sent.max_tokens).toBe(ROULETTE_MAX_OUTPUT_TOKENS);
    expect(sent.temperature).toBe(1);
    expect(sent.messages[0]?.content ?? '').not.toContain("haven't been");
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
      expect(fallback.message).toContain("Closest I've got:");
      expect(fallback.message.toLowerCase()).toContain('may not match everything');
      expect(fallback.message.toLowerCase()).not.toContain('not a match');
      expect(fallback.tone).toBe('alternative');
    }
    expect(events.some((event) => event.type === 'pick')).toBe(false);

    const surprise = await POST(post({ message: '', body: { askTone: 'surprise' } }));
    const surpriseFallback = parseDiscoverSse(await surprise.text()).find((event) => event.type === 'fallback');
    expect(surpriseFallback && surpriseFallback.type === 'fallback' ? surpriseFallback.message : '').toContain(
      "Here's a surprise",
    );
    expect(
      surpriseFallback && surpriseFallback.type === 'fallback'
        ? surpriseFallback.message.toLowerCase()
        : '',
    ).not.toContain('not a match');

    const another = await POST(
      post({ message: 'quiet sushi', body: { askTone: 'another', preferredCuisine: 'japanese' } }),
    );
    const anotherFallback = parseDiscoverSse(await another.text()).find((event) => event.type === 'fallback');
    expect(anotherFallback && anotherFallback.type === 'fallback' ? anotherFallback.message : '').toContain(
      "Here's another idea",
    );
    expect(
      anotherFallback && anotherFallback.type === 'fallback' ? anotherFallback.message.toLowerCase() : '',
    ).not.toContain('not a match');
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

  it('excludes shown restaurants on the model path and the random path', async () => {
    const response = await POST(post({ body: { excludeRestaurantIds: [BBQ.id] } }));
    expect(response.status).toBe(200);
    const picked = parseDiscoverSse(await response.text()).find((event) => event.type === 'pick');
    expect(picked).toMatchObject({ type: 'pick', partner: { id: VEGAN.id } });
    const promptCall = fetchMock.mock.calls.find((call) => String(call[0]).includes('anthropic'));
    const sent = JSON.parse(String((promptCall?.[1] as RequestInit | undefined)?.body)) as {
      messages?: { content?: string }[];
    };
    const prompt = sent.messages?.[0]?.content ?? '';
    expect(prompt).toContain(VEGAN.id);
    expect(prompt).not.toContain(BBQ.id);

    fetchMock.mockImplementation(() =>
      Promise.resolve(anthropicResponse(JSON.stringify({ restaurantId: VEGAN.id }))),
    );
    const missed = await POST(post({ body: { excludeRestaurantIds: [VEGAN.id] } }));
    expect(missed.status).toBe(200);
    const missedEvents = parseDiscoverSse(await missed.text());
    expect(missedEvents.some((event) => event.type === 'error')).toBe(false);
    expect(missedEvents.find((event) => event.type === 'fallback')).toMatchObject({
      type: 'fallback',
      alternative: { id: BBQ.id },
    });
    const missedPrompt = fetchMock.mock.calls
      .map((call) => String((call[1] as RequestInit | undefined)?.body ?? ''))
      .find((body) => body.includes(BBQ.id));
    expect(missedPrompt).toBeTruthy();
    expect(missedPrompt).not.toContain(VEGAN.id);

    vi.stubEnv('WANDERBITE_AI_DISABLED', 'true');
    const exhausted = await POST(
      post({ body: { excludeRestaurantIds: [VEGAN.id, BBQ.id, VEGAN.id] } }),
    );
    expect(exhausted.status).toBe(200);
    const exhaustedEvents = parseDiscoverSse(await exhausted.text());
    expect(exhaustedEvents.some((event) => event.type === 'error')).toBe(false);
    expect(exhaustedEvents.find((event) => event.type === 'fallback')).toMatchObject({
      type: 'fallback',
      alternative: { id: VEGAN.id },
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

  it('leaves the prompt and the card unchanged when briefings are off', async () => {
    const response = await POST(post());
    expect(response.status).toBe(200);
    const sent = anthropicBody(fetchMock.mock.calls[0]);
    const content = sent.messages[0]?.content ?? '';
    const rows = promptRowsFrom(content);
    expect(serverFrom).not.toHaveBeenCalled();
    expect(tables).not.toContain('restaurant_briefing_facts');
    expect(content).not.toContain(DISCOVER_FACT_PROMPT_NOTE);
    expect(content).not.toContain('"facts"');
    expect(content).toContain(
      'each has id, name, cuisine_tags, neighborhood, price_range',
    );
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        'cuisine_tags',
        'id',
        'name',
        'neighborhood',
        'price_range',
      ]);
    }
    expect(sent.model).toBe(ANTHROPIC_HAIKU_SNAPSHOT);
    expect(sent.max_tokens).toBe(ROULETTE_MAX_OUTPUT_TOKENS);
    expect(sent.temperature).toBe(1);
    expect(sent.system).toBe(expectedSystemPrompt());
    const pick = parseDiscoverSse(await response.text()).find((event) => event.type === 'pick');
    expect(pick && pick.type === 'pick' ? Object.hasOwn(pick, 'facts') : true).toBe(false);

    vi.stubEnv('E06_BRIEFINGS_ENABLED', 'TRUE');
    serverFrom.mockClear();
    const wrong = await POST(post({ message: '', body: { askTone: 'surprise' } }));
    expect(wrong.status).toBe(200);
    expect(serverFrom).not.toHaveBeenCalled();
  });

  it('shows two card facts and capped prompt notes when the flag is on', async () => {
    const longVibe = `${'p'.repeat(120)}UNIQUE_TAIL`;
    briefingResult = {
      data: [
        factRow({
          id: '11111111-1111-4111-8111-111111111111',
          field: 'known_for',
          body: 'Known for hand-pulled noodles.',
          source_url: MAPS,
        }),
        factRow({
          id: '22222222-2222-4222-8222-222222222222',
          field: 'vibe',
          body: longVibe,
        }),
        factRow({
          id: '33333333-3333-4333-8333-333333333333',
          field: 'good_for',
          body: 'Good for a quiet date night.',
        }),
        factRow({
          id: '44444444-4444-4444-8444-444444444444',
          field: 'seating',
          body: 'There is a covered patio out back.',
        }),
        factRow({
          id: '55555555-5555-4555-8555-555555555555',
          field: 'vibe',
          body: 'A newer sample vibe that must stay hidden.',
          is_sample: true,
          version: 4,
        }),
        factRow({
          id: '66666666-6666-4666-8666-666666666666',
          field: 'parking',
          body: 'The lot is behind the building.',
        }),
        factRow({
          id: '77777777-7777-4777-8777-777777777777',
          field: 'reservations',
          body: 'Walk-ins are welcome.',
        }),
        factRow({
          id: '88888888-8888-4888-8888-888888888888',
          field: 'known_for',
          body: 'A paused note that must stay hidden.',
          status: 'paused',
          version: 9,
        }),
      ],
      error: null,
    };
    vi.stubEnv('E06_BRIEFINGS_ENABLED', 'true');
    const response = await POST(post());
    expect(response.status).toBe(200);
    const events = parseDiscoverSse(await response.text());
    const pick = events.find((event) => event.type === 'pick');
    expect(pick).toMatchObject({
      type: 'pick',
      isNewToMember: false,
      reason: discoveryCardSentence(VEGAN, LAUNCH_MARKET.displayName),
      facts: [
        {
          field: 'known_for',
          label: 'Known for',
          text: 'Known for hand-pulled noodles.',
          sourceUrl: MAPS,
        },
        {
          field: 'vibe',
          label: 'Vibe',
          text: longVibe,
        },
      ],
    });
    if (pick?.type === 'pick') {
      expect(pick.reason).not.toContain('hand-pulled');
      expect(pick.reason).not.toContain('UNIQUE_TAIL');
      const chips = JSON.stringify({
        matched: pick.matched,
        unknown: pick.unknown,
        unmet: pick.unmet,
      });
      expect(chips).not.toContain('hand-pulled');
      expect(chips).not.toContain('patio');
      expect(chips).not.toContain('date night');
    }
    expect(events.some((event) => event.type === 'step' && event.id === 'memory')).toBe(false);
    expect(events.some((event) => event.type === 'step' && event.id === 'rank')).toBe(false);
    expect(JSON.stringify(events)).not.toContain('behind the building');
    expect(JSON.stringify(events)).not.toContain('Walk-ins');
    expect(JSON.stringify(events)).not.toContain('sample vibe');
    expect(JSON.stringify(events)).not.toContain('paused note');
    expect(JSON.stringify(events)).not.toContain('Sample');

    const sent = anthropicBody(
      fetchMock.mock.calls.find((call) => String(call[0]).includes('anthropic')),
    );
    expect(sent.model).toBe(ANTHROPIC_HAIKU_SNAPSHOT);
    expect(ANTHROPIC_HAIKU_SNAPSHOT).toBe('claude-haiku-4-5-20251001');
    expect(sent.max_tokens).toBe(300);
    expect(ROULETTE_MAX_OUTPUT_TOKENS).toBe(300);
    expect(sent.temperature).toBe(1);
    expect(sent.system).toBe(expectedSystemPrompt());
    const content = sent.messages[0]?.content ?? '';
    expect(content).toContain(DISCOVER_FACT_PROMPT_NOTE);
    expect(content).not.toContain(MAPS);
    expect(content).not.toContain(FACT_SOURCE);
    expect(content).not.toContain('UNIQUE_TAIL');
    expect(content).toContain('p'.repeat(120));
    const rows = promptRowsFrom(content);
    const vegan = rows.find((row) => row.id === VEGAN.id);
    const bbq = rows.find((row) => row.id === BBQ.id);
    expect(vegan?.facts).toEqual({
      vibe: 'p'.repeat(120),
      known_for: 'Known for hand-pulled noodles.',
      good_for: 'Good for a quiet date night.',
      seating: 'There is a covered patio out back.',
    });
    expect(bbq && 'facts' in bbq).toBe(false);
    expect(serverFrom).toHaveBeenCalledTimes(1);
    expect(briefingCalls).toContainEqual(['from', 'restaurant_briefing_facts']);
    expect(briefingCalls).toContainEqual(['eq', 'status', 'active']);
    expect(tables).not.toContain('restaurant_briefing_facts');
    const reserved = rpcs.rpcAiReserve.mock.calls.at(-1)?.[0] as {
      modelId?: string;
      usageUnits?: { input?: number; output?: number };
    };
    expect(reserved.modelId).toBe(ANTHROPIC_HAIKU_SNAPSHOT);
    expect(reserved.usageUnits?.output).toBe(300);

    const jsonResponse = await roulettePost(post());
    const body = (await jsonResponse.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
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
    ]);
    expect(body.reason).toBe(discoveryCardSentence(VEGAN, LAUNCH_MARKET.displayName));
    expect(JSON.stringify(body)).not.toContain('hand-pulled');
    expect(JSON.stringify(body)).not.toContain('facts');
  });

  it('still picks when the briefing read fails or throws', async () => {
    vi.stubEnv('E06_BRIEFINGS_ENABLED', 'true');
    briefingResult = { data: null, error: { message: 'boom' } };
    const failed = await POST(post());
    expect(failed.status).toBe(200);
    const failedPick = parseDiscoverSse(await failed.text()).find((event) => event.type === 'pick');
    expect(failedPick).toMatchObject({ type: 'pick', partner: { id: VEGAN.id } });
    expect(failedPick && failedPick.type === 'pick' ? Object.hasOwn(failedPick, 'facts') : true).toBe(
      false,
    );
    expect(warn.mock.calls.some((call: unknown[]) => call[0] === '[briefings] read failed')).toBe(true);
    const failedPrompt = anthropicBody(fetchMock.mock.calls[0]).messages[0]?.content ?? '';
    expect(failedPrompt).not.toContain(DISCOVER_FACT_PROMPT_NOTE);
    expect(failedPrompt).not.toContain('"facts"');

    resetBriefingsLogs();
    warn.mockClear();
    serverFrom.mockImplementation(() => {
      throw new Error('briefing down');
    });
    const thrown = await POST(post());
    expect(thrown.status).toBe(200);
    const thrownPick = parseDiscoverSse(await thrown.text()).find((event) => event.type === 'pick');
    expect(thrownPick).toMatchObject({ type: 'pick', isNewToMember: false });
    expect(thrownPick && thrownPick.type === 'pick' ? Object.hasOwn(thrownPick, 'facts') : true).toBe(
      false,
    );
    expect(warn.mock.calls.some((call: unknown[]) => call[0] === '[briefings] read failed')).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('puts facts only on the current prompt rows and rebuilds them after the 80k shrink', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const places = Array.from({ length: 51 }, (_, index) => ({
        ...VEGAN,
        id: `rest-${String(index).padStart(2, '0')}`,
        name: `Place ${index}`,
        neighborhood: index === 0 ? 'North' : 'N'.repeat(1800),
        address: `${index} Main`,
      }));
      restaurantRows = places;
      const longVibe = `${'p'.repeat(120)}UNIQUE_TAIL`;
      briefingResult = {
        data: places.flatMap((place, index) => {
          if (index === 0) {
            return [
              factRow({
                id: `fact-${place.id}-known`,
                restaurant_id: place.id,
                field: 'known_for',
                body: 'CARD ONLY BRISKET',
                source_url: MAPS,
              }),
              factRow({
                id: `fact-${place.id}-vibe`,
                restaurant_id: place.id,
                field: 'vibe',
                body: 'CARD ONLY ROOM',
                source_url: FACT_SOURCE,
              }),
              factRow({
                id: `fact-${place.id}-good`,
                restaurant_id: place.id,
                field: 'good_for',
                body: 'CARD ONLY BIRTHDAY',
              }),
              factRow({
                id: `fact-${place.id}-seat`,
                restaurant_id: place.id,
                field: 'seating',
                body: 'CARD ONLY PATIO',
              }),
            ];
          }
          return [
            factRow({
              id: `fact-${place.id}-vibe`,
              restaurant_id: place.id,
              field: 'vibe',
              body: index === 1 ? longVibe : `Shared note ${index}`,
            }),
          ];
        }),
        error: null,
      };
      vi.stubEnv('E06_BRIEFINGS_ENABLED', 'true');
      fetchMock.mockImplementation(() =>
        Promise.resolve(anthropicResponse(JSON.stringify({ restaurantId: 'not-in-the-list' }))),
      );
      const response = await POST(post());
      expect(response.status).toBe(200);
      const events = parseDiscoverSse(await response.text());
      const fallback = events.find((event) => event.type === 'fallback');
      expect(fallback).toMatchObject({
        type: 'fallback',
        tone: 'alternative',
        alternative: { id: 'rest-00' },
        facts: [
          { field: 'known_for', text: 'CARD ONLY BRISKET' },
          { field: 'vibe', text: 'CARD ONLY ROOM' },
        ],
      });
      expect(JSON.stringify(fallback)).not.toContain('CARD ONLY BIRTHDAY');
      expect(JSON.stringify(fallback)).not.toContain('CARD ONLY PATIO');
      expect(events.some((event) => event.type === 'step' && event.id === 'memory')).toBe(false);

      const sent = anthropicBody(
        fetchMock.mock.calls.find((call) => String(call[0]).includes('anthropic')),
      );
      expect(sent.model).toBe(ANTHROPIC_HAIKU_SNAPSHOT);
      expect(sent.max_tokens).toBe(300);
      expect(sent.temperature).toBe(1);
      expect(sent.system).toBe(expectedSystemPrompt());
      const content = sent.messages[0]?.content ?? '';
      const rows = promptRowsFrom(content);
      expect(rows).toHaveLength(25);
      expect(rows.every((row) => row.facts && typeof row.facts === 'object')).toBe(true);
      expect(rows.map((row) => row.id)).toContain('rest-01');
      expect(rows.map((row) => row.id)).not.toContain('rest-00');
      expect(rows.map((row) => row.id)).not.toContain('rest-26');
      expect(content).toContain(DISCOVER_FACT_PROMPT_NOTE);
      expect(content).toContain('p'.repeat(120));
      expect(content).not.toContain('UNIQUE_TAIL');
      expect(content).not.toContain('CARD ONLY');
      expect(content).not.toContain(MAPS);
      expect(content).not.toContain(FACT_SOURCE);
      expect(serverFrom).toHaveBeenCalledTimes(1);
      const queried = briefingCalls.find((call) => call[0] === 'in');
      expect(queried?.[2]).toEqual(places.map((place) => place.id));
    } finally {
      random.mockRestore();
    }
  });

  it('does not override an AI pick and still prefers an unvisited fallback', async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER } } });
    redemptionRows = [
      { restaurant_id: VEGAN.id, status: 'verified', verified_at: '2020-03-08T02:30:00.000Z' },
      { restaurant_id: VEGAN.id, status: 'issued', verified_at: null },
    ];
    const ai = await POST(post({ user: true }));
    const aiEvents = parseDiscoverSse(await ai.text());
    expect(aiEvents.find((event) => event.type === 'pick')).toMatchObject({
      type: 'pick',
      isNewToMember: false,
      partner: { id: VEGAN.id },
    });
    expect(aiEvents.find((event) => event.type === 'step' && event.id === 'memory')).toMatchObject({
      line: "You've been here before.",
    });
    const prompt = anthropicBody(fetchMock.mock.calls[0]).messages[0]?.content ?? '';
    expect(prompt).toContain(VEGAN.id);
    expect(prompt).toContain(BBQ.id);
    expect(prompt).not.toContain("You've been here before");
    expect(prompt).not.toContain('verified');

    vi.stubEnv('WANDERBITE_AI_DISABLED', 'true');
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const fallback = parseDiscoverSse(await (await POST(post({ user: true, message: '', body: { askTone: 'surprise' } }))).text());
      expect(fallback.find((event) => event.type === 'fallback')).toMatchObject({
        type: 'fallback',
        tone: 'surprise',
        isNewToMember: true,
        alternative: { id: BBQ.id },
      });
      expect(fallback.find((event) => event.type === 'step' && event.id === 'memory')).toMatchObject({
        line: "You haven't been to Smokehouse yet.",
      });
      expect(
        warn.mock.calls.some(
          (call: unknown[]) =>
            call[0] === DISCOVER_FALLBACK_LOG &&
            (call[1] as { reason?: string; poolSize?: number; memberType?: string }).reason ===
              'ai_disabled' &&
            (call[1] as { poolSize?: number }).poolSize === 2 &&
            (call[1] as { memberType?: string }).memberType === 'member',
        ),
      ).toBe(true);
    } finally {
      random.mockRestore();
    }
  });

  it('keeps facts when the visit read fails, and memory when the facts read fails', async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER } } });
    vi.stubEnv('E06_BRIEFINGS_ENABLED', 'true');
    briefingResult = {
      data: [factRow({ field: 'known_for', body: 'Known for hand-pulled noodles.', source_url: MAPS })],
      error: null,
    };
    redemptionError = { message: 'visits down' };
    const visitsDown = parseDiscoverSse(await (await POST(post({ user: true }))).text());
    const visitsDownPick = visitsDown.find((event) => event.type === 'pick');
    expect(visitsDownPick).toMatchObject({
      type: 'pick',
      isNewToMember: false,
      partner: { id: VEGAN.id },
      facts: [{ field: 'known_for', text: 'Known for hand-pulled noodles.' }],
    });
    expect(visitsDown.some((event) => event.type === 'step' && event.id === 'memory')).toBe(false);
    expect(warn.mock.calls.filter((call: unknown[]) => call[0] === '[discover] member visits read failed')).toHaveLength(1);

    redemptionError = null;
    redemptionThrow = true;
    const thrown = await POST(post({ user: true }));
    expect(thrown.status).toBe(200);
    expect(warn.mock.calls.filter((call: unknown[]) => call[0] === '[discover] member visits read failed')).toHaveLength(1);
    expect(parseDiscoverSse(await thrown.text()).some((event) => event.type === 'step' && event.id === 'memory')).toBe(false);

    redemptionThrow = false;
    redemptionRows = [
      { restaurant_id: VEGAN.id, status: 'verified', verified_at: '2026-11-01T04:30:00.000Z' },
    ];
    serverFrom.mockImplementation(() => {
      throw new Error('briefing down');
    });
    const factsDown = parseDiscoverSse(await (await POST(post({ user: true }))).text());
    const factsDownPick = factsDown.find((event) => event.type === 'pick');
    expect(factsDownPick).toMatchObject({
      type: 'pick',
      isNewToMember: false,
      partner: { id: VEGAN.id },
    });
    expect(factsDownPick && factsDownPick.type === 'pick' ? Object.hasOwn(factsDownPick, 'facts') : true).toBe(false);
    expect(factsDown.find((event) => event.type === 'step' && event.id === 'memory')).toMatchObject({
      line: "You've been here before.",
    });
    expect(warn.mock.calls.some((call: unknown[]) => call[0] === '[briefings] read failed')).toBe(true);

    const json = await roulettePost(post({ user: true }));
    const body = (await json.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
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
    ]);
    expect(JSON.stringify(body)).not.toContain('isNewToMember');
    expect(JSON.stringify(body)).not.toContain("You've been here before");
  });

  it('prefers an unvisited partner and still honors session exclusions', async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER } } });
    vi.stubEnv('WANDERBITE_AI_DISABLED', 'true');
    redemptionRows = [
      { restaurant_id: VEGAN.id, status: 'verified', verified_at: '2019-11-01T06:00:00.000Z' },
      { restaurant_id: BBQ.id, status: 'expired', verified_at: '2026-11-20T23:00:00.000Z' },
    ];
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const open = parseDiscoverSse(
        await (await POST(post({ user: true, message: '', body: { askTone: 'surprise' } }))).text(),
      );
      expect(open.find((event) => event.type === 'fallback')).toMatchObject({
        alternative: { id: BBQ.id },
        isNewToMember: true,
      });

      redemptionQuery = [];
      const another = parseDiscoverSse(
        await (
          await POST(
            post({
              user: true,
              message: 'quiet sushi',
              body: { askTone: 'another', excludeRestaurantIds: [BBQ.id] },
            }),
          )
        ).text(),
      );
      expect(another.find((event) => event.type === 'fallback')).toMatchObject({
        tone: 'another',
        alternative: { id: VEGAN.id },
        isNewToMember: false,
        message: "Here's another idea: Green Table.",
      });
      expect(JSON.stringify(another)).not.toContain(BBQ.id);
      const scoped = redemptionQuery.find((call) => call[0] === 'in');
      expect(scoped?.[2]).toEqual([VEGAN.id]);

      const exhausted = parseDiscoverSse(
        await (
          await POST(
            post({
              user: true,
              message: '',
              body: { askTone: 'surprise', excludeRestaurantIds: [VEGAN.id, BBQ.id] },
            }),
          )
        ).text(),
      );
      expect(exhausted.find((event) => event.type === 'fallback')).toMatchObject({
        alternative: { id: VEGAN.id },
      });
      expect(JSON.stringify(exhausted)).not.toContain(BBQ.id);

      redemptionRows = [
        { restaurant_id: VEGAN.id, status: 'verified', verified_at: '2026-01-01T00:00:00.000Z' },
        { restaurant_id: BBQ.id, status: 'verified', verified_at: '2026-06-01T12:00:00.000Z' },
      ];
      const allVisited = parseDiscoverSse(
        await (await POST(post({ user: true, message: '', body: { askTone: 'surprise' } }))).text(),
      );
      expect(allVisited.find((event) => event.type === 'fallback')).toMatchObject({
        alternative: { id: VEGAN.id },
        isNewToMember: false,
      });
    } finally {
      random.mockRestore();
    }
  });

  it('leaves a guest surprise unchanged when visits are not read', async () => {
    vi.stubEnv('WANDERBITE_AI_DISABLED', 'true');
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const events = parseDiscoverSse(
        await (await POST(post({ message: '', body: { askTone: 'surprise' } }))).text(),
      );
      expect(events.some((event) => event.type === 'step' && event.id === 'memory')).toBe(false);
      const fallback = events.find((event) => event.type === 'fallback');
      expect(fallback).toMatchObject({
        tone: 'surprise',
        alternative: { id: VEGAN.id },
        message: "Here's a surprise: Green Table.",
      });
      expect(fallback && fallback.type === 'fallback' ? Object.hasOwn(fallback, 'isNewToMember') : true).toBe(false);
      expect(tables).not.toContain('redemptions');
      expect(tables).not.toContain('bite_notes');
    } finally {
      random.mockRestore();
    }
  });

  it('keeps the model prompt, cap, and pick when code pick is not exactly true', async () => {
    restaurantRows = [SALSA, VEGAN];
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    const preference = { preferredCuisine: 'mexican', priceRange: '$' };
    const stripNonce = (content: string) => content.replace(/Request id: .+/g, 'Request id: NONCE');
    try {
      const sent: string[] = [];
      const ids: string[] = [];
      for (const flag of [undefined, '', 'TRUE', ' true'] as const) {
        fetchMock.mockClear();
        if (flag === undefined) delete process.env.DISCOVER_CODE_PICK_ENABLED;
        else vi.stubEnv('DISCOVER_CODE_PICK_ENABLED', flag);
        const response = await roulettePost(post({ body: preference }));
        const body = (await response.json()) as { restaurantId: string; reason: string; selectionMode: string };
        const call = anthropicBody(fetchMock.mock.calls[0]);
        sent.push(stripNonce(call.messages[0]?.content ?? ''));
        ids.push(body.restaurantId);
        expect(call.model).toBe(ANTHROPIC_HAIKU_SNAPSHOT);
        expect(call.max_tokens).toBe(ROULETTE_MAX_OUTPUT_TOKENS);
        expect(call.max_tokens).toBe(300);
        expect(call.temperature).toBe(1);
        expect(call.system).toBe(expectedSystemPrompt());
        expect(body).toMatchObject({
          restaurantId: VEGAN.id,
          selectionMode: 'ai',
          reason: discoveryCardSentence(VEGAN, LAUNCH_MARKET.displayName),
        });
      }
      expect(new Set(sent).size).toBe(1);
      expect(new Set(ids)).toEqual(new Set([VEGAN.id]));
      expect(sent[0]).toContain('"id"');
      expect(sent[0]).not.toContain('already chosen');
    } finally {
      random.mockRestore();
    }
  });

  it('ranks a matching unvisited partner and shows a valid Haiku line', async () => {
    vi.stubEnv('DISCOVER_CODE_PICK_ENABLED', 'true');
    getUser.mockResolvedValue({ data: { user: { id: USER } } });
    restaurantRows = [SALSA, TACO];
    redemptionRows = [{ restaurant_id: SALSA.id, status: 'verified' }];
    fetchMock.mockResolvedValue(anthropicResponse(LINE));
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    try {
      const response = await POST(
        post({
          user: true,
          body: { preferredCuisine: 'mexican', priceRange: '$', idempotencyKey: USER },
        }),
      );
      const events = parseDiscoverSse(await response.text());
      expect(events.map((event) => (event.type === 'step' ? event.id : event.type))).toEqual([
        'parse',
        'filter',
        'memory',
        'pick',
      ]);
      expect(events.some((event) => event.type === 'step' && event.id === 'rank')).toBe(false);
      const pick = events.find((event) => event.type === 'pick');
      expect(pick).toMatchObject({
        type: 'pick',
        reason: LINE,
        isNewToMember: true,
        partner: { id: TACO.id, name: TACO.name },
      });
      expect(events.find((event) => event.type === 'step' && event.id === 'memory')).toMatchObject({
        line: "You haven't been to Taco House yet.",
      });
      const sent = anthropicBody(fetchMock.mock.calls[0]);
      expect(sent.model).toBe(ANTHROPIC_HAIKU_SNAPSHOT);
      expect(sent.max_tokens).toBe(DISCOVER_LINE_MAX_OUTPUT_TOKENS);
      expect(sent.max_tokens).toBe(80);
      expect(sent.temperature).toBe(1);
      expect(sent.system).toContain('already chosen');
      expect(sent.messages[0]?.content).toContain('Taco House');
      expect(sent.messages[0]?.content).not.toContain(SALSA.name);
      expect(sent.messages[0]?.content).not.toContain('"id"');
      const reserved = rpcs.rpcAiReserve.mock.calls.at(-1)?.[0] as {
        modelId?: string;
        featureClass?: string;
        usageUnits?: { output?: number };
      };
      expect(reserved.modelId).toBe(ANTHROPIC_HAIKU_SNAPSHOT);
      expect(reserved.featureClass).toBe('optional');
      expect(reserved.usageUnits?.output).toBe(sent.max_tokens);
      expect(rpcs.rpcAiSettle).toHaveBeenCalled();
      expect(rpcs.rpcAiReconcile).not.toHaveBeenCalled();
      const stored = rpcs.rpcAiStoreResultPayload.mock.calls.at(-1)?.[1] as {
        restaurantId?: string;
        line?: string;
        selectionMode?: string;
      };
      expect(stored).toMatchObject({
        restaurantId: TACO.id,
        selectionMode: 'ai',
        line: LINE,
      });
      expect(stored).not.toHaveProperty('reason');
      expect(warn.mock.calls.some((call: unknown[]) => call[0] === DISCOVER_AI_PICK_LOG)).toBe(true);
      expect(warn.mock.calls.some((call: unknown[]) => call[0] === DISCOVER_FALLBACK_LOG)).toBe(false);

      fetchMock.mockClear();
      redemptionRows = [];
      random.mockReturnValue(0);
      rpcs.rpcAiReserve.mockResolvedValue({ ...ledgerRow(false), deny_reason: '' });
      rpcs.rpcAiLoadResultPayload.mockResolvedValue({
        result_payload: stored,
        deny_reason: '',
      });
      const replay = await roulettePost(
        post({
          user: true,
          body: { preferredCuisine: 'mexican', priceRange: '$', idempotencyKey: USER },
        }),
      );
      await expect(replay.json()).resolves.toMatchObject({
        restaurantId: TACO.id,
        selectionMode: 'ai',
        reason: LINE,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
  });

  it('keeps the code pick and the template when the line is rejected', async () => {
    vi.stubEnv('DISCOVER_CODE_PICK_ENABLED', 'true');
    restaurantRows = [TACO, SALSA];
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    const template = discoveryCardSentence(TACO, LAUNCH_MARKET.displayName);
    const cases = [
      ['See https://evil.example/secret-line before you go.', 'url'],
      ['Call 555-123-4567 for a table.', 'phone'],
      ['It is only $15.', 'price'],
      ['Closed Mondays.', 'hours'],
      ['Ask about the discount.', 'promo'],
      ['Salsa Room is louder than this one.', 'other_restaurant'],
      ['', 'empty'],
      ['Taco House is bright. The room is loud.', 'multi_sentence'],
    ] as const;
    try {
      for (const [text, code] of cases) {
        fetchMock.mockResolvedValue(anthropicResponse(text));
        warn.mockClear();
        rpcs.rpcAiSettle.mockClear();
        rpcs.rpcAiReconcile.mockClear();
        rpcs.rpcAiMarkAssumedSpent.mockClear();
        const response = await roulettePost(
          post({ body: { preferredCuisine: 'mexican', priceRange: '$' } }),
        );
        const body = (await response.json()) as {
          restaurantId: string;
          reason: string;
          selectionMode: string;
        };
        expect(body).toMatchObject({
          restaurantId: TACO.id,
          selectionMode: 'random_fallback',
          reason: template,
        });
        expect(body.reason).not.toContain('secret-line');
        expect(body.restaurantId).not.toBe(SALSA.id);
        const logged = warn.mock.calls.filter((call: unknown[]) => call[0] === DISCOVER_FALLBACK_LOG);
        expect(logged).toHaveLength(1);
        expect(logged[0]?.[1]).toMatchObject({ reason: 'line_rejected', lineCode: code });
        if (text) expect(JSON.stringify(logged)).not.toContain(text);
        expect(JSON.stringify(logged)).not.toContain('secret-line');
        expect(rpcs.rpcAiSettle).not.toHaveBeenCalled();
        expect(rpcs.rpcAiMarkAssumedSpent).toHaveBeenCalled();
        expect(rpcs.rpcAiReconcile).toHaveBeenCalled();
      }
    } finally {
      random.mockRestore();
    }
  });

  it('returns the code pick with the template when AI cannot write the line', async () => {
    vi.stubEnv('DISCOVER_CODE_PICK_ENABLED', 'true');
    restaurantRows = [TACO, SALSA];
    const template = discoveryCardSentence(TACO, LAUNCH_MARKET.displayName);
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      vi.stubEnv('WANDERBITE_AI_DISABLED', 'true');
      const disabled = await roulettePost(
        post({ body: { preferredCuisine: 'mexican', priceRange: '$' } }),
      );
      await expect(disabled.json()).resolves.toMatchObject({
        restaurantId: TACO.id,
        selectionMode: 'random_fallback',
        reason: template,
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(rpcs.rpcAiReserve).not.toHaveBeenCalled();

      vi.stubEnv('WANDERBITE_AI_DISABLED', '');
      fetchMock.mockClear();
      allowBillableRoulette.mockResolvedValueOnce(false);
      const limited = await roulettePost(
        post({ body: { preferredCuisine: 'mexican', priceRange: '$' } }),
      );
      await expect(limited.json()).resolves.toMatchObject({
        restaurantId: TACO.id,
        selectionMode: 'random_fallback',
        reason: template,
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(rpcs.rpcAiReserve).not.toHaveBeenCalled();

      allowBillableRoulette.mockResolvedValue(true);
      rpcs.rpcAiReserve.mockResolvedValue({
        ...ledgerRow(false),
        deny_reason: 'insufficient_budget',
      });
      const denied = await roulettePost(
        post({ body: { preferredCuisine: 'mexican', priceRange: '$' } }),
      );
      await expect(denied.json()).resolves.toMatchObject({
        restaurantId: TACO.id,
        selectionMode: 'random_fallback',
        reason: template,
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(rpcs.rpcAiDispatch).not.toHaveBeenCalled();
      expect(rpcs.rpcAiSettle).not.toHaveBeenCalled();
      expect(rpcs.rpcAiMarkAssumedSpent).not.toHaveBeenCalled();

      rpcs.rpcAiReserve.mockResolvedValue(ledgerRow(true));
      fetchMock.mockResolvedValue(new Response('nope', { status: 503 }));
      const errored = await roulettePost(
        post({ body: { preferredCuisine: 'mexican', priceRange: '$' } }),
      );
      await expect(errored.json()).resolves.toMatchObject({
        restaurantId: TACO.id,
        selectionMode: 'random_fallback',
        reason: template,
      });
      expect(rpcs.rpcAiSettle).not.toHaveBeenCalled();
      expect(rpcs.rpcAiMarkAssumedSpent).toHaveBeenCalled();
      expect(rpcs.rpcAiReleaseCustomerAllowance).toHaveBeenCalled();
      const errorLog = warn.mock.calls.filter((call: unknown[]) => call[0] === DISCOVER_FALLBACK_LOG).at(-1);
      expect(errorLog?.[1]).toMatchObject({ reason: 'provider_error', providerStatus: 503 });

      rpcs.rpcAiMarkAssumedSpent.mockClear();
      rpcs.rpcAiReleaseCustomerAllowance.mockClear();
      rpcs.rpcAiReconcile.mockClear();
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
      const pending = roulettePost(
        post({ body: { preferredCuisine: 'mexican', priceRange: '$' } }),
      );
      await vi.advanceTimersByTimeAsync(7_000);
      const timedOut = await pending;
      await expect(timedOut.json()).resolves.toMatchObject({
        restaurantId: TACO.id,
        selectionMode: 'random_fallback',
        reason: template,
      });
      expect(rpcs.rpcAiSettle).not.toHaveBeenCalled();
      expect(rpcs.rpcAiReconcile).not.toHaveBeenCalled();
      expect(rpcs.rpcAiMarkAssumedSpent).toHaveBeenCalled();
      expect(rpcs.rpcAiReleaseCustomerAllowance).toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
  });

  it('ranks without a visit read for a guest and keeps the closest-pick copy', async () => {
    vi.stubEnv('DISCOVER_CODE_PICK_ENABLED', 'true');
    restaurantRows = [TACO, SALSA];
    fetchMock.mockResolvedValue(anthropicResponse('Salsa Room is the one to skip.'));
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const events = parseDiscoverSse(
        await (
          await POST(post({ body: { preferredCuisine: 'mexican', priceRange: '$' } }))
        ).text(),
      );
      expect(events.some((event) => event.type === 'step' && event.id === 'memory')).toBe(false);
      expect(tables).not.toContain('redemptions');
      const fallback = events.find((event) => event.type === 'fallback');
      expect(fallback).toMatchObject({
        tone: 'alternative',
        alternative: { id: TACO.id },
        message: "Closest I've got: Taco House. It may not match everything you asked for.",
      });
      expect(fallback && fallback.type === 'fallback' ? Object.hasOwn(fallback, 'isNewToMember') : false).toBe(
        false,
      );
    } finally {
      random.mockRestore();
    }
  });

  it('picks from the matching pool when every match was visited', async () => {
    vi.stubEnv('DISCOVER_CODE_PICK_ENABLED', 'true');
    getUser.mockResolvedValue({ data: { user: { id: USER } } });
    restaurantRows = [TACO, SALSA];
    redemptionRows = [
      { restaurant_id: TACO.id, status: 'verified' },
      { restaurant_id: SALSA.id, status: 'verified' },
    ];
    fetchMock.mockResolvedValue(anthropicResponse(LINE));
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const events = parseDiscoverSse(
        await (
          await POST(
            post({
              user: true,
              body: { preferredCuisine: 'mexican', priceRange: '$' },
            }),
          )
        ).text(),
      );
      expect(events.find((event) => event.type === 'pick')).toMatchObject({
        reason: LINE,
        isNewToMember: false,
        partner: { id: TACO.id },
      });
      expect(events.find((event) => event.type === 'step' && event.id === 'memory')).toMatchObject({
        line: "You've been here before.",
      });
    } finally {
      random.mockRestore();
    }
  });

  it('drops a dietary miss before the ranker and still excludes session ids', async () => {
    vi.stubEnv('DISCOVER_CODE_PICK_ENABLED', 'true');
    vi.stubEnv('WANDERBITE_AI_DISABLED', 'true');
    restaurantRows = [TACO, VEGAN];
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const dietary = await roulettePost(
        post({
          body: { dietaryQuick: ['vegan'], preferredCuisine: 'mexican', priceRange: '$' },
        }),
      );
      await expect(dietary.json()).resolves.toMatchObject({
        restaurantId: VEGAN.id,
        selectionMode: 'random_fallback',
      });

      vi.stubEnv('WANDERBITE_AI_DISABLED', '');
      restaurantRows = [TACO, SALSA];
      const excluded = await roulettePost(
        post({
          body: {
            preferredCuisine: 'mexican',
            priceRange: '$',
            excludeRestaurantIds: [TACO.id],
          },
        }),
      );
      await expect(excluded.json()).resolves.toMatchObject({ restaurantId: SALSA.id });

      const readmit = await roulettePost(
        post({
          body: {
            preferredCuisine: 'mexican',
            priceRange: '$',
            excludeRestaurantIds: [TACO.id, SALSA.id],
          },
        }),
      );
      await expect(readmit.json()).resolves.toMatchObject({ restaurantId: TACO.id });
    } finally {
      random.mockRestore();
    }
  });

  it('omits briefing facts from the line prompt unless the flag is exactly true', async () => {
    vi.stubEnv('DISCOVER_CODE_PICK_ENABLED', 'true');
    restaurantRows = [TACO, SALSA];
    fetchMock.mockImplementation(() => Promise.resolve(anthropicResponse(LINE)));
    briefingResult = {
      data: [
        factRow({
          id: '11111111-1111-4111-8111-111111111111',
          restaurant_id: TACO.id,
          field: 'known_for',
          body: 'TACO_FACT_ONLY',
          source_url: MAPS,
        }),
        factRow({
          id: '22222222-2222-4222-8222-222222222222',
          restaurant_id: SALSA.id,
          field: 'vibe',
          body: 'SALSA_FACT_HIDDEN',
        }),
      ],
      error: null,
    };
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const off = await POST(post({ body: { preferredCuisine: 'mexican', priceRange: '$' } }));
      expect(off.status).toBe(200);
      const offPrompt = anthropicBody(fetchMock.mock.calls[0]).messages[0]?.content ?? '';
      expect(offPrompt).not.toContain('TACO_FACT_ONLY');
      expect(offPrompt).not.toContain('SALSA_FACT_HIDDEN');
      expect(offPrompt).not.toContain('"facts"');
      expect(serverFrom).not.toHaveBeenCalled();

      fetchMock.mockClear();
      serverFrom.mockClear();
      vi.stubEnv('E06_BRIEFINGS_ENABLED', 'TRUE');
      const wrong = await POST(post({ body: { preferredCuisine: 'mexican', priceRange: '$' } }));
      expect(wrong.status).toBe(200);
      const wrongPrompt = anthropicBody(fetchMock.mock.calls[0]).messages[0]?.content ?? '';
      expect(wrongPrompt).not.toContain('TACO_FACT_ONLY');
      expect(serverFrom).not.toHaveBeenCalled();

      fetchMock.mockClear();
      vi.stubEnv('E06_BRIEFINGS_ENABLED', 'true');
      const on = await POST(post({ body: { preferredCuisine: 'mexican', priceRange: '$' } }));
      const sent = anthropicBody(fetchMock.mock.calls[0]);
      const content = sent.messages[0]?.content ?? '';
      expect(content).toContain('TACO_FACT_ONLY');
      expect(content).not.toContain('SALSA_FACT_HIDDEN');
      expect(content).not.toContain(MAPS);
      expect(sent.max_tokens).toBe(DISCOVER_LINE_MAX_OUTPUT_TOKENS);
      const events = parseDiscoverSse(await on.text());
      const pick = events.find((event) => event.type === 'pick');
      expect(pick).toMatchObject({
        type: 'pick',
        reason: LINE,
        partner: { id: TACO.id },
        facts: [{ field: 'known_for', text: 'TACO_FACT_ONLY' }],
      });
    } finally {
      random.mockRestore();
    }
  });
});
