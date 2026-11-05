import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  BRIEFING_HTML_BYTE_CAP,
  BRIEFING_MODEL,
  BRIEFING_PAGE_CHARS,
  BRIEFING_USER_AGENT,
  BRIEFING_WEB_SEARCH_MAX_USES,
  BRIEFING_WEB_SEARCH_TOOL,
  WEB_SEARCH_MICRODOLLARS_PER_REQUEST,
  briefingInsertRow,
  normalizeHttpsUrl,
  briefingModelMatchesDiscover,
  briefingResearchAllowed,
  callBriefingModel,
  discoverBriefingUrls,
  discoverOfficialSubpages,
  estimateMicrodollars,
  filterSupportedFacts,
  findSupportPassage,
  formatBriefingReport,
  parseBriefingArgs,
  rankBriefingUrls,
  researchCatalog,
  researchOneRestaurant,
  type BriefingModelCaller,
} from '@/lib/briefings/research';

const RESTAURANT = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  name: 'Hutchins BBQ',
  address: '1301 N Tennessee St, McKinney, TX 75069',
};

const OFFICIAL = 'https://hutchinsbbq.com/visit';
const YELP = 'https://www.yelp.com/biz/hutchins-bbq';
const PAGE = '<p>Valet parking is available beside the front door.</p>';

const API_KEY = 'test-key';

function searchPayload(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    stop_reason: 'end_turn',
    content: [
      {
        type: 'server_tool_use',
        id: 'srvtoolu_test',
        name: 'web_search',
        input: { query: 'Hutchins BBQ McKinney official site' },
      },
      {
        type: 'web_search_tool_result',
        tool_use_id: 'srvtoolu_test',
        content: [
          { type: 'web_search_result', url: OFFICIAL, title: 'Visit' },
          { type: 'web_search_result', url: YELP, title: 'Yelp' },
          { type: 'web_search_result', url: 'https://example.com/random-blog', title: 'Blog' },
          { type: 'web_search_result', url: 'http://hutchinsbbq.com/insecure', title: 'HTTP' },
        ],
      },
      {
        type: 'text',
        text: 'Official site and a listing.',
        citations: [
          {
            type: 'web_search_result_location',
            url: OFFICIAL,
            title: 'Visit',
            cited_text: 'Valet parking is available beside the front door.',
          },
        ],
      },
    ],
    usage: { server_tool_use: { web_search_requests: 1 } },
    ...extra,
  });
}

function response(body: string, status = 200, contentType = 'text/html'): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

function fetchImpl(searchBody = searchPayload()): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === 'https://api.anthropic.com/v1/messages') {
      return response(searchBody, 200, 'application/json');
    }
    if (url.includes('duckduckgo.com')) return response('challenge', 202, 'text/html');
    if (url.endsWith('/robots.txt')) return response('missing', 404, 'text/plain');
    if (url.startsWith(OFFICIAL)) return response(PAGE);
    if (url.startsWith(YELP)) return response('<p>Guests mention a line at the door.</p>');
    return response('missing', 404, 'text/plain');
  }) as typeof fetch;
}

const MODEL_JSON = JSON.stringify({
  facts: [
    {
      field: 'parking',
      text: 'Valet parking is available beside the front door.',
      source_url: OFFICIAL,
    },
    {
      field: 'attire',
      text: 'Black tie is required every night.',
      source_url: OFFICIAL,
    },
    {
      field: 'arrival',
      text: 'Use the side gate from the lot.',
      source_url: 'https://evil.example/not-fetched',
    },
    {
      field: 'duration',
      text: 'Plan on two hours for dinner.',
      source_url: 'http://hutchinsbbq.com/visit',
    },
    {
      field: 'offer',
      text: 'A discount is not a briefing field.',
      source_url: OFFICIAL,
    },
  ],
});

describe('briefing research filter', () => {
  it('keeps only https facts whose source was fetched and whose words are on that page', () => {
    const filtered = filterSupportedFacts({
      raw: JSON.parse(MODEL_JSON) as unknown,
      pages: [
        { url: OFFICIAL, text: 'Valet parking is available beside the front door.' },
        { url: YELP, text: 'Guests mention a line at the door.' },
      ],
    });
    expect(filtered.kept).toEqual([
      {
        field: 'parking',
        text: 'Valet parking is available beside the front door.',
        sourceUrl: OFFICIAL,
        supportPassage: 'Valet parking is available beside the front door.',
      },
    ]);
    expect(filtered.dropped.join('\n')).toMatch(/not fetched/);
    expect(filtered.dropped.join('\n')).toMatch(/without an https/);
    expect(filtered.dropped.join('\n')).toMatch(/does not support/);
    expect(filtered.dropped.join('\n')).toMatch(/unknown field/);
  });

  it('rejects http, credentials, and non-public hosts', () => {
    expect(normalizeHttpsUrl('http://hutchinsbbq.com/visit')).toBeNull();
    expect(normalizeHttpsUrl('https://user:pass@hutchinsbbq.com/visit')).toBeNull();
    expect(normalizeHttpsUrl('https://127.0.0.1/visit')).toBeNull();
    expect(normalizeHttpsUrl('https://169.254.169.254/latest')).toBeNull();
    expect(normalizeHttpsUrl('https://hutchinsbbq.com/visit')).toBe('https://hutchinsbbq.com/visit');
  });

  it('ranks an official host ahead of a reputable listing and drops other hosts', () => {
    expect(
      rankBriefingUrls(
        [YELP, 'https://example.com/random-blog', OFFICIAL, 'http://hutchinsbbq.com/insecure'],
        'Hutchins BBQ',
      ),
    ).toEqual([OFFICIAL, YELP]);
  });

  it('prices the Haiku snapshot the same way the published rate table does', () => {
    expect(estimateMicrodollars({ input: 1000, output: 100 })).toBe(1500);
    expect(estimateMicrodollars({ web_search_requests: 1 })).toBe(WEB_SEARCH_MICRODOLLARS_PER_REQUEST);
    expect(estimateMicrodollars({ input: 1000, output: 100, web_search_requests: 2 })).toBe(
      1500 + 2 * WEB_SEARCH_MICRODOLLARS_PER_REQUEST,
    );
    expect(BRIEFING_WEB_SEARCH_TOOL).toBe('web_search_20260318');
    expect(BRIEFING_WEB_SEARCH_MAX_USES).toBe(3);
    expect(briefingModelMatchesDiscover()).toBe(true);
    const sql = readFileSync(
      path.resolve(process.cwd(), 'supabase/migrations/20260919172836_ai_budget_reservations.sql'),
      'utf8',
    );
    expect(sql).toContain(`'anthropic', '${BRIEFING_MODEL}', 'input', 1000000`);
    expect(sql).toContain(`'anthropic', '${BRIEFING_MODEL}', 'output', 5000000`);
  });

  it('refuses a hosted URL unless the one-run OK is set', () => {
    expect(briefingResearchAllowed('http://127.0.0.1:54321', {}).ok).toBe(true);
    const hosted = briefingResearchAllowed('https://yiajoycgiyxjvznndjge.supabase.co', {});
    expect(hosted.ok).toBe(false);
    expect(
      briefingResearchAllowed('https://yiajoycgiyxjvznndjge.supabase.co', {
        WANDERBITE_BRIEFINGS_HOSTED_OK: '1',
      }).ok,
    ).toBe(true);
  });

  it('clamps the per-run restaurant cap and rejects unknown arguments', () => {
    expect(parseBriefingArgs(['--limit', '100']).restaurantCap).toBe(25);
    expect(parseBriefingArgs(['--write']).write).toBe(true);
    expect(parseBriefingArgs([]).write).toBe(false);
    expect(parseBriefingArgs(['--cost-cap-cents', '50']).costCapMicrodollars).toBe(500_000);
    expect(parseBriefingArgs(['--publish']).error).toMatch(/Unknown argument/);
  });

  it('inserts paused non-sample rows and never marks them active', () => {
    const row = briefingInsertRow(
      {
        field: 'parking',
        text: 'Valet parking is available beside the front door.',
        sourceUrl: OFFICIAL,
        supportPassage: 'Valet parking is available beside the front door.',
      },
      RESTAURANT.id,
      '2026-11-05T17:00:00.000Z',
    );
    expect(row.status).toBe('paused');
    expect(row.is_sample).toBe(false);
    expect(row.last_verified_at).toBe('2026-11-05T17:00:00.000Z');
  });
});

describe('support passage', () => {
  const page =
    'Valet parking is available beside the front door after 5 pm. Street parking is two blocks east. Most dinners last about 90 minutes.';

  it('keeps a paraphrase when the distinctive words share one passage', () => {
    const fact = 'Valet parking sits beside the front door after 5 pm.';
    const passage = findSupportPassage(fact, page);
    expect(passage).toBe('Valet parking is available beside the front door after 5 pm.');
    const filtered = filterSupportedFacts({
      raw: {
        facts: [{ field: 'parking', text: fact, source_url: OFFICIAL }],
      },
      pages: [{ url: OFFICIAL, text: page }],
    });
    expect(filtered.kept).toHaveLength(1);
    expect(filtered.kept[0]?.supportPassage).toBe(passage);
    const report = formatBriefingReport({
      verifiedAt: '2026-11-05T17:00:00.000Z',
      restaurants: [
        {
          restaurantId: RESTAURANT.id,
          restaurantName: RESTAURANT.name,
          fetchedUrls: [OFFICIAL],
          facts: filtered.kept,
          dropped: [],
          units: { input: 10, output: 4 },
          estimatedMicrodollars: 30,
          notes: [],
        },
      ],
      stoppedBecause: null,
      totals: { input: 10, output: 4, estimatedMicrodollars: 30 },
    });
    expect(report.markdown).toContain(`Passage: ${passage}`);
    expect(report.json).toContain(passage);
  });

  it('drops a fact that only repeats generic words from the page', () => {
    const fact = 'Street parking is available.';
    expect(page.toLowerCase()).toContain('street');
    expect(page.toLowerCase()).toContain('parking');
    expect(page.toLowerCase()).toContain('available');
    expect(findSupportPassage(fact, page)).toBeNull();
    const filtered = filterSupportedFacts({
      raw: {
        facts: [{ field: 'parking', text: fact, source_url: OFFICIAL }],
      },
      pages: [{ url: OFFICIAL, text: page }],
    });
    expect(filtered.kept).toEqual([]);
    expect(filtered.dropped.join('\n')).toMatch(/does not support/);
  });

  it('drops a fact whose number is not the number in the passage', () => {
    const fact = 'Most dinners last about 45 minutes.';
    expect(findSupportPassage(fact, page)).toBeNull();
    expect(findSupportPassage('Most dinners last about 90 minutes.', page)).toBe(
      'Most dinners last about 90 minutes.',
    );
  });
});

describe('discoverBriefingUrls', () => {
  it('sends the current web_search tool and keeps https result URLs', async () => {
    const fetchMock = fetchImpl();
    const found = await discoverBriefingUrls({
      restaurant: RESTAURANT,
      apiKey: API_KEY,
      fetchImpl: fetchMock,
    });
    expect(found.failure).toBeNull();
    expect(found.urls).toEqual([OFFICIAL, YELP, 'https://example.com/random-blog']);
    expect(found.units).toEqual({ web_search_requests: 1 });
    const init = vi.mocked(fetchMock).mock.calls[0]?.[1];
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(API_KEY);
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(String(init?.body)) as {
      model?: string;
      tools?: Array<Record<string, unknown>>;
      messages?: Array<{ content?: string }>;
    };
    expect(body.model).toBe(BRIEFING_MODEL);
    expect(body.tools).toEqual([
      {
        type: 'web_search_20260318',
        name: 'web_search',
        max_uses: 3,
        allowed_callers: ['direct'],
        user_location: {
          type: 'approximate',
          city: 'McKinney',
          region: 'Texas',
          country: 'US',
          timezone: 'America/Chicago',
        },
      },
    ]);
    expect(body.messages?.[0]?.content).toContain('Hutchins BBQ');
    expect(body.messages?.[0]?.content).toContain('McKinney');
    expect(String(vi.mocked(fetchMock).mock.calls[0]?.[0])).toBe('https://api.anthropic.com/v1/messages');
  });

  it('names a tool error when the search returns no page', async () => {
    const fetchMock = vi.fn(async () =>
      response(
        JSON.stringify({
          stop_reason: 'end_turn',
          content: [
            {
              type: 'web_search_tool_result',
              tool_use_id: 'srvtoolu_err',
              content: { type: 'web_search_tool_result_error', error_code: 'too_many_requests' },
            },
          ],
          usage: { server_tool_use: { web_search_requests: 0 } },
        }),
        200,
        'application/json',
      ),
    ) as typeof fetch;
    const found = await discoverBriefingUrls({
      restaurant: RESTAURANT,
      apiKey: API_KEY,
      fetchImpl: fetchMock,
    });
    expect(found.urls).toEqual([]);
    expect(found.failure).toBe('Anthropic web search hit a rate limit (too_many_requests)');
    expect(found.units).toEqual({});
  });

  it('logs the Anthropic error when search fails and does not invent URLs', async () => {
    const fetchMock = vi.fn(async () =>
      response(
        JSON.stringify({
          type: 'error',
          error: { type: 'invalid_request_error', message: 'web search is not enabled' },
        }),
        400,
        'application/json',
      ),
    ) as typeof fetch;
    const found = await discoverBriefingUrls({
      restaurant: RESTAURANT,
      apiKey: API_KEY,
      fetchImpl: fetchMock,
    });
    expect(found.urls).toEqual([]);
    expect(found.failure).toBe(
      'Anthropic web search failed (HTTP 400: invalid_request_error: web search is not enabled)',
    );
    expect(found.units).toEqual({});
  });

  it('names a tool error and continues a paused turn within the search cap', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push(body);
      if (calls.length === 1) {
        return response(
          JSON.stringify({
            stop_reason: 'pause_turn',
            content: [
              {
                type: 'web_search_tool_result',
                tool_use_id: 'srvtoolu_pause',
                content: {
                  type: 'web_search_tool_result_error',
                  error_code: 'unavailable',
                },
              },
            ],
            usage: { input_tokens: 10, output_tokens: 2, server_tool_use: { web_search_requests: 1 } },
          }),
          200,
          'application/json',
        );
      }
      return response(
        JSON.stringify({
          stop_reason: 'end_turn',
          content: [
            {
              type: 'web_search_tool_result',
              tool_use_id: 'srvtoolu_next',
              content: [{ type: 'web_search_result', url: `${OFFICIAL}/`, title: 'Visit' }],
            },
          ],
          usage: { input_tokens: 4, output_tokens: 1, server_tool_use: { web_search_requests: 1 } },
        }),
        200,
        'application/json',
      );
    }) as typeof fetch;
    const found = await discoverBriefingUrls({
      restaurant: RESTAURANT,
      apiKey: API_KEY,
      fetchImpl: fetchMock,
    });
    expect(calls).toHaveLength(2);
    const secondTools = calls[1]?.tools as Array<{ max_uses?: number }>;
    expect(secondTools[0]?.max_uses).toBe(2);
    expect(found.failure).toBeNull();
    expect(found.urls).toEqual([OFFICIAL]);
    expect(found.warnings).toEqual(['Anthropic web search was unavailable']);
    expect(found.units).toEqual({ input: 14, output: 3, web_search_requests: 2 });
    expect(estimateMicrodollars(found.units)).toBe(14 + 15 + 2 * WEB_SEARCH_MICRODOLLARS_PER_REQUEST);
  });
});

describe('researchOneRestaurant', () => {
  it('uses mocked fetch and a mocked model, then drops unsupported facts', async () => {
    const callModel: BriefingModelCaller = vi.fn(async () => ({
      text: MODEL_JSON,
      units: { input: 1000, output: 100 },
    }));
    const fetchMock = fetchImpl();
    const result = await researchOneRestaurant({
      restaurant: RESTAURANT,
      fetchImpl: fetchMock,
      callModel,
      apiKey: API_KEY,
    });
    expect(callModel).toHaveBeenCalledTimes(1);
    const prompt = vi.mocked(callModel).mock.calls[0]?.[0];
    expect(prompt?.system).toMatch(/Do not invent/);
    expect(prompt?.user).toContain(OFFICIAL);
    expect(prompt?.user).not.toContain('evil.example');
    expect(prompt?.user).not.toContain('example.com/random-blog');
    expect(result.fetchedUrls).toEqual([OFFICIAL, YELP]);
    expect(result.facts.map((fact) => fact.field)).toEqual(['parking']);
    expect(result.units).toEqual({ input: 1000, output: 100, web_search_requests: 1 });
    expect(result.estimatedMicrodollars).toBe(1500 + WEB_SEARCH_MICRODOLLARS_PER_REQUEST);
    expect(result.dropped.length).toBeGreaterThan(0);
    expect(vi.mocked(fetchMock).mock.calls.some((call) => String(call[0]).includes('duckduckgo'))).toBe(
      false,
    );
    const pageCall = vi.mocked(fetchMock).mock.calls.find((call) => String(call[0]) === OFFICIAL);
    const headers = pageCall?.[1]?.headers as Record<string, string>;
    expect(headers.accept).toContain('text/html');
    expect(headers['accept-language']).toBe('en-US,en;q=0.9');
    expect(headers['user-agent']).toBe(BRIEFING_USER_AGENT);
  });

  it('records the search failure and skips the fact model', async () => {
    const callModel: BriefingModelCaller = vi.fn(async () => ({
      text: MODEL_JSON,
      units: { input: 1000, output: 100 },
    }));
    const fetchMock = vi.fn(async () =>
      response(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'overloaded' } }), 529, 'application/json'),
    ) as typeof fetch;
    const result = await researchOneRestaurant({
      restaurant: RESTAURANT,
      fetchImpl: fetchMock,
      callModel,
      apiKey: API_KEY,
    });
    expect(callModel).not.toHaveBeenCalled();
    expect(result.facts).toEqual([]);
    expect(result.fetchedUrls).toEqual([]);
    expect(result.notes).toEqual(['Anthropic web search failed (HTTP 529: api_error: overloaded)']);
    expect(result.estimatedMicrodollars).toBe(0);
  });

  it('stops at the restaurant cap and the cost cap', async () => {
    const callModel: BriefingModelCaller = vi.fn(async () => ({
      text: '{"facts":[]}',
      units: { input: 2_000_000, output: 1 },
    }));
    const second = { ...RESTAURANT, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'The Yard' };
    const capped = await researchCatalog({
      restaurants: [RESTAURANT, second],
      fetchImpl: fetchImpl(),
      callModel,
      apiKey: API_KEY,
      now: new Date('2026-11-05T17:00:00.000Z'),
      restaurantCap: 1,
      costCapMicrodollars: 5_000_000,
    });
    expect(capped.restaurants).toHaveLength(1);
    expect(capped.stoppedBecause).toMatch(/restaurant cap/);

    const costly = await researchCatalog({
      restaurants: [RESTAURANT, second],
      fetchImpl: fetchImpl(),
      callModel,
      apiKey: API_KEY,
      now: new Date('2026-11-05T17:00:00.000Z'),
      restaurantCap: 25,
      costCapMicrodollars: 1_000,
    });
    expect(costly.restaurants).toHaveLength(1);
    expect(costly.stoppedBecause).toMatch(/cost cap/);
    expect(costly.restaurants[0]?.estimatedMicrodollars).toBeGreaterThan(1_000);
    const report = formatBriefingReport(costly);
    expect(report.markdown).toContain('Hutchins BBQ');
    expect(report.markdown).toContain('Web searches 1');
    expect(report.markdown).toContain('Reasons:');
    expect(report.markdown).toContain('no supported facts');
    expect(report.json).toContain('wanderbite.e06.briefing_research.v1');
    expect(report.json).toContain('web_search_requests');
    expect(report.json).toContain('"reasons"');
  });

  it('stops the next restaurant when web search spend reaches the cap', async () => {
    const callModel: BriefingModelCaller = vi.fn(async () => ({
      text: '{"facts":[]}',
      units: {},
    }));
    const second = { ...RESTAURANT, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'The Yard' };
    const run = await researchCatalog({
      restaurants: [RESTAURANT, second],
      fetchImpl: fetchImpl(),
      callModel,
      apiKey: API_KEY,
      now: new Date('2026-11-05T17:00:00.000Z'),
      restaurantCap: 25,
      costCapMicrodollars: WEB_SEARCH_MICRODOLLARS_PER_REQUEST,
    });
    expect(run.restaurants).toHaveLength(1);
    expect(run.restaurants[0]?.estimatedMicrodollars).toBe(WEB_SEARCH_MICRODOLLARS_PER_REQUEST);
    expect(run.stoppedBecause).toMatch(/cost cap/);
    expect(callModel).toHaveBeenCalledTimes(1);
  });
});

describe('callBriefingModel', () => {
  it('posts to the Haiku messages API and reads token usage', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.anthropic.com/v1/messages');
      const body = JSON.parse(String(init?.body)) as { model?: string; tools?: unknown };
      expect(body.model).toBe(BRIEFING_MODEL);
      expect(body.tools).toBeUndefined();
      return response(
        JSON.stringify({
          content: [{ type: 'text', text: '{"facts":[]}' }],
          usage: { input_tokens: 12, output_tokens: 3 },
        }),
        200,
        'application/json',
      );
    }) as typeof fetch;
    const result = await callBriefingModel({
      apiKey: 'test-key',
      system: 'system',
      user: 'user',
      fetchImpl,
    });
    expect(result.text).toBe('{"facts":[]}');
    expect(result.units).toEqual({ input: 12, output: 3 });
    expect(estimateMicrodollars(result.units)).toBe(27);
  });
});

const HOME = 'https://hutchinsbbq.com';
const YELP_SECOND = 'https://www.yelp.com/biz/hutchins-bbq-mckinney';
const OPENTABLE = 'https://www.opentable.com/r/hutchins-bbq';
const INFATUATION = 'https://www.theinfatuation.com/dallas/reviews/hutchins';
const TRIPADVISOR = 'https://www.tripadvisor.com/Restaurant_Review-hutchins';
const EATER = 'https://www.eater.com/hutchins';
const ABOUT = 'https://www.hutchinsbbq.com/about';
const HOURS = 'https://hutchinsbbq.com/hours';
const FAQ = 'https://hutchinsbbq.com/faq';
const PARKING_FACT = 'Valet parking is available beside the front door.';

function searchBody(urls: readonly string[]): string {
  return JSON.stringify({
    stop_reason: 'end_turn',
    content: [
      {
        type: 'web_search_tool_result',
        tool_use_id: 'srvtoolu_pages',
        content: urls.map((url) => ({ type: 'web_search_result', url, title: url })),
      },
    ],
    usage: { server_tool_use: { web_search_requests: 1 } },
  });
}

function emptyModel(): BriefingModelCaller {
  return vi.fn(async () => ({ text: '{"facts":[]}', units: { input: 1, output: 1 } }));
}

describe('official subpages, truncation, and robots skip', () => {
  it('discovers same-host first-visit links and ignores other hosts', () => {
    const html = [
      '<a href="/careers">Careers</a>',
      '<a href="https://evil.example/menu">Menu</a>',
      '<a href="https://order.hutchinsbbq.com/menu">Order</a>',
      '<a href="/menu?utm_source=home">Menu</a>',
      '<a href="https://www.hutchinsbbq.com/about">About us</a>',
      '<a href="/visit">Plan your visit</a>',
      '<a href="/faq">FAQ</a>',
      '<a href="/hours">Hours</a>',
      '<a href="/location">Location</a>',
      '<a href="/contact">Contact</a>',
      '<a href="/reservations">Reservations</a>',
      '<a href="/parking">Parking</a>',
      '<a href="/private-dining">Private dining</a>',
      '<a href="mailto:hi@hutchinsbbq.com">Email</a>',
      '<a href="/menu.jpg">Menu image</a>',
    ].join('');
    expect(discoverOfficialSubpages(html, `${HOME}/`, 4)).toEqual([HOME + '/menu', ABOUT, OFFICIAL, FAQ]);
    const all = discoverOfficialSubpages(html, `${HOME}/`);
    expect(all).toEqual([
      HOME + '/menu',
      ABOUT,
      OFFICIAL,
      FAQ,
      `${HOME}/hours`,
      `${HOME}/location`,
      `${HOME}/contact`,
      `${HOME}/reservations`,
      `${HOME}/parking`,
      `${HOME}/private-dining`,
    ]);
  });

  it('fetches up to four same-host subpages and skips a disallowed path', async () => {
    const homeHtml = [
      '<a href="/careers">Careers</a>',
      '<a href="https://evil.example/menu">Menu</a>',
      '<a href="https://order.hutchinsbbq.com/menu">Order online</a>',
      '<a href="/menu">Menu</a>',
      `<a href="${ABOUT}">About us</a>`,
      '<a href="/visit">Plan your visit</a>',
      '<a href="/faq">FAQ</a>',
      '<a href="/hours">Hours</a>',
      '<a href="/private-dining">Private dining</a>',
      '<a href="/contact">Contact</a>',
      '<p>Welcome.</p>',
    ].join('');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://api.anthropic.com/v1/messages') {
        return response(searchBody([`${HOME}/`, YELP, 'https://evil.example/menu']), 200, 'application/json');
      }
      if (url === `${HOME}/robots.txt`) {
        return response('User-agent: *\nDisallow: /menu\n', 200, 'text/plain');
      }
      if (url.endsWith('/robots.txt')) return response('missing', 404, 'text/plain');
      if (url === HOME || url === `${HOME}/`) return response(homeHtml);
      if (url === HOURS) return response(`<p>${PARKING_FACT}</p>`);
      if (url.startsWith(`${HOME}/`) || url.startsWith('https://www.hutchinsbbq.com/')) {
        return response('<p>A shorter note about the room.</p>');
      }
      if (url.startsWith(YELP)) return response('<p>Guests mention a line at the door.</p>');
      return response('missing', 404, 'text/plain');
    }) as typeof fetch;
    const callModel: BriefingModelCaller = vi.fn(async () => ({
      text: JSON.stringify({
        facts: [
          { field: 'parking', text: PARKING_FACT, source_url: HOURS },
          { field: 'attire', text: 'Black tie is required every night.', source_url: HOURS },
        ],
      }),
      units: { input: 20, output: 8 },
    }));
    const result = await researchOneRestaurant({
      restaurant: RESTAURANT,
      fetchImpl: fetchMock,
      callModel,
      apiKey: API_KEY,
    });
    expect(result.fetchedUrls).toEqual([`${HOME}/`, ABOUT, OFFICIAL, FAQ, HOURS, YELP]);
    expect(result.facts.map((fact) => fact.sourceUrl)).toEqual([HOURS]);
    expect(result.dropped.join('\n')).toMatch(/does not support/);
    expect(result.notes).toContain(`${HOME}/menu: robots.txt disallows the path`);
    const calls = vi.mocked(fetchMock).mock.calls.map((call) => String(call[0]));
    expect(calls.filter((url) => url === 'https://api.anthropic.com/v1/messages')).toHaveLength(1);
    expect(calls.filter((url) => url === `${HOME}/robots.txt`)).toHaveLength(1);
    expect(calls).not.toContain(`${HOME}/menu`);
    expect(calls).not.toContain(`${HOME}/private-dining`);
    expect(calls).not.toContain('https://order.hutchinsbbq.com/menu');
    expect(calls).not.toContain('https://evil.example/menu');
    expect(calls).not.toContain(`${HOME}/careers`);
    const prompt = vi.mocked(callModel).mock.calls[0]?.[0]?.user ?? '';
    expect(prompt).toContain(HOURS);
    expect(prompt).toContain(PARKING_FACT);
    expect(prompt.length).toBeLessThan(BRIEFING_PAGE_CHARS * result.fetchedUrls.length + 800);
    const report = formatBriefingReport({
      verifiedAt: '2026-11-05T17:00:00.000Z',
      restaurants: [result],
      stoppedBecause: null,
      totals: { input: result.units.input ?? 0, output: result.units.output ?? 0, estimatedMicrodollars: result.estimatedMicrodollars },
    });
    expect(report.markdown).toContain('Reasons:');
    expect(report.markdown).toContain(`${HOME}/menu: robots.txt disallows the path`);
    expect(report.markdown).toContain('kept 1 supported fact');
  });

  it('keeps a page above the old 400 KB cap when it is under 1.5 MB', async () => {
    const body = `<p>${PARKING_FACT}</p>${'y'.repeat(500_000)}`;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://api.anthropic.com/v1/messages') {
        return response(searchBody([OFFICIAL]), 200, 'application/json');
      }
      if (url.endsWith('/robots.txt')) return response('missing', 404, 'text/plain');
      if (url === OFFICIAL) return response(body);
      return response('missing', 404, 'text/plain');
    }) as typeof fetch;
    const callModel: BriefingModelCaller = vi.fn(async () => ({
      text: JSON.stringify({ facts: [{ field: 'parking', text: PARKING_FACT, source_url: OFFICIAL }] }),
      units: { input: 10, output: 4 },
    }));
    const result = await researchOneRestaurant({
      restaurant: RESTAURANT,
      fetchImpl: fetchMock,
      callModel,
      apiKey: API_KEY,
    });
    expect(result.fetchedUrls).toEqual([OFFICIAL]);
    expect(result.facts).toHaveLength(1);
    expect(result.notes.join('\n')).not.toMatch(/size cap|truncated/);
    const prompt = vi.mocked(callModel).mock.calls[0]?.[0]?.user ?? '';
    expect(prompt).toContain(PARKING_FACT);
    expect(prompt.length).toBeLessThan(BRIEFING_PAGE_CHARS + 800);
  });

  it('truncates HTML past 1.5 MB instead of dropping the page', async () => {
    const prefix = Buffer.from(`<p>${PARKING_FACT}</p>`);
    const filler = Buffer.alloc(64 * 1024, 0x79);
    const parts: Buffer[] = [prefix];
    let total = prefix.byteLength;
    while (total < BRIEFING_HTML_BYTE_CAP + 64) {
      parts.push(filler);
      total += filler.byteLength;
    }
    parts.push(Buffer.from('TAIL_MARKER'));
    const payload = Buffer.concat(parts);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://api.anthropic.com/v1/messages') {
        return response(searchBody([OFFICIAL]), 200, 'application/json');
      }
      if (url.endsWith('/robots.txt')) return response('missing', 404, 'text/plain');
      if (url === OFFICIAL) {
        return new Response(payload, { status: 200, headers: { 'content-type': 'text/html' } });
      }
      return response('missing', 404, 'text/plain');
    }) as typeof fetch;
    const callModel: BriefingModelCaller = vi.fn(async () => ({
      text: JSON.stringify({ facts: [{ field: 'parking', text: PARKING_FACT, source_url: OFFICIAL }] }),
      units: { input: 10, output: 4 },
    }));
    const result = await researchOneRestaurant({
      restaurant: RESTAURANT,
      fetchImpl: fetchMock,
      callModel,
      apiKey: API_KEY,
    });
    expect(result.fetchedUrls).toEqual([OFFICIAL]);
    expect(result.facts).toHaveLength(1);
    expect(result.notes).toContain(`${OFFICIAL}: truncated to the first ${BRIEFING_HTML_BYTE_CAP} bytes of HTML`);
    expect(result.notes.join('\n')).not.toMatch(/size cap/);
    const prompt = vi.mocked(callModel).mock.calls[0]?.[0]?.user ?? '';
    expect(prompt).toContain(PARKING_FACT);
    expect(prompt).not.toContain('TAIL_MARKER');
    expect(prompt.length).toBeLessThan(BRIEFING_PAGE_CHARS + 800);
  });

  it('skips robots-disallowed listing hosts without a page slot or another web search', async () => {
    const urls = [
      YELP,
      YELP_SECOND,
      OPENTABLE,
      INFATUATION,
      `${HOME}/`,
      TRIPADVISOR,
      EATER,
      'https://example.com/random-blog',
    ];
    const disallow = [
      'User-agent: WanderbiteBriefingResearchBot',
      'Disallow: /',
      '',
      'User-agent: *',
      'Allow: /',
      '',
    ].join('\n');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://api.anthropic.com/v1/messages') {
        return response(searchBody(urls), 200, 'application/json');
      }
      if (url === 'https://www.yelp.com/robots.txt' || url === 'https://www.opentable.com/robots.txt') {
        return response(disallow, 200, 'text/plain');
      }
      if (url.endsWith('/robots.txt')) return response('missing', 404, 'text/plain');
      if (
        url === HOME ||
        url === `${HOME}/` ||
        url.startsWith(INFATUATION) ||
        url.startsWith(TRIPADVISOR) ||
        url.startsWith(EATER)
      ) {
        return response('<p>Open tonight for dinner.</p>');
      }
      return response('missing', 404, 'text/plain');
    }) as typeof fetch;
    const callModel = emptyModel();
    const second = { ...RESTAURANT, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
    const run = await researchCatalog({
      restaurants: [RESTAURANT, second],
      fetchImpl: fetchMock,
      callModel,
      apiKey: API_KEY,
      now: new Date('2026-11-05T17:00:00.000Z'),
      restaurantCap: 25,
      costCapMicrodollars: 5_000_000,
    });
    expect(run.restaurants).toHaveLength(2);
    for (const restaurant of run.restaurants) {
      expect(restaurant.fetchedUrls).toEqual([`${HOME}/`, INFATUATION, TRIPADVISOR]);
      expect(restaurant.notes).toContain(`${YELP}: robots.txt disallows the path`);
      expect(restaurant.notes).toContain(`${YELP_SECOND}: robots.txt disallows the path`);
      expect(restaurant.notes).toContain(`${OPENTABLE}: robots.txt disallows the path`);
      expect(restaurant.units.web_search_requests).toBe(1);
    }
    const calls = vi.mocked(fetchMock).mock.calls.map((call) => String(call[0]));
    expect(calls.filter((url) => url === 'https://api.anthropic.com/v1/messages')).toHaveLength(2);
    expect(calls.filter((url) => url === 'https://www.yelp.com/robots.txt')).toHaveLength(1);
    expect(calls.filter((url) => url === 'https://www.opentable.com/robots.txt')).toHaveLength(1);
    expect(calls.some((url) => url.startsWith('https://www.yelp.com/biz'))).toBe(false);
    expect(calls.some((url) => url === OPENTABLE)).toBe(false);
    expect(calls.some((url) => url.includes('eater.com'))).toBe(false);
    expect(calls.some((url) => url.includes('example.com'))).toBe(false);
    const report = formatBriefingReport(run);
    expect(report.markdown).toContain(`## ${RESTAURANT.name}`);
    expect(report.markdown).toContain(`${YELP}: robots.txt disallows the path`);
    expect(report.json).toContain('"reasons"');
  });

  it('skips HTTP 403 per URL and still fills the page cap', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://api.anthropic.com/v1/messages') {
        return response(searchBody([OFFICIAL, YELP, OPENTABLE, TRIPADVISOR, EATER]), 200, 'application/json');
      }
      if (url.endsWith('/robots.txt')) return response('missing', 404, 'text/plain');
      if (url === OFFICIAL) return response('nope', 403, 'text/html');
      if (url.startsWith(YELP) || url.startsWith(OPENTABLE) || url.startsWith(TRIPADVISOR) || url.startsWith(EATER)) {
        return response('<p>Open tonight for dinner.</p>');
      }
      return response('missing', 404, 'text/plain');
    }) as typeof fetch;
    const callModel = emptyModel();
    const result = await researchOneRestaurant({
      restaurant: RESTAURANT,
      fetchImpl: fetchMock,
      callModel,
      apiKey: API_KEY,
    });
    expect(result.notes).toContain(`${OFFICIAL}: skipped HTTP 403`);
    expect(result.fetchedUrls).toEqual([YELP, OPENTABLE, TRIPADVISOR]);
    expect(callModel).toHaveBeenCalledTimes(1);
    const prompt = vi.mocked(callModel).mock.calls[0]?.[0]?.user ?? '';
    expect(prompt).toContain(YELP);
    expect(prompt).not.toContain(OFFICIAL);
    const calls = vi.mocked(fetchMock).mock.calls.map((call) => String(call[0]));
    expect(calls.filter((url) => url === 'https://api.anthropic.com/v1/messages')).toHaveLength(1);
    expect(calls.some((url) => url.startsWith(EATER))).toBe(false);
  });
});
