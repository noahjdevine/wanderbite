import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  BRIEFING_MODEL,
  briefingInsertRow,
  normalizeHttpsUrl,
  briefingModelMatchesDiscover,
  briefingResearchAllowed,
  callBriefingModel,
  estimateMicrodollars,
  filterSupportedFacts,
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

const SEARCH_HTML = `
<a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fhutchinsbbq.com%2Fvisit&amp;rut=1">Official</a>
<a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.yelp.com%2Fbiz%2Fhutchins-bbq&amp;rut=1">Yelp</a>
<a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Frandom-blog&amp;rut=1">Blog</a>
`;

function response(body: string, status = 200, contentType = 'text/html'): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

function fetchImpl(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('duckduckgo.com/html')) return response(SEARCH_HTML);
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
      },
      RESTAURANT.id,
      '2026-11-05T17:00:00.000Z',
    );
    expect(row.status).toBe('paused');
    expect(row.is_sample).toBe(false);
    expect(row.last_verified_at).toBe('2026-11-05T17:00:00.000Z');
  });
});

describe('researchOneRestaurant', () => {
  it('uses mocked fetch and a mocked model, then drops unsupported facts', async () => {
    const callModel: BriefingModelCaller = vi.fn(async () => ({
      text: MODEL_JSON,
      units: { input: 1000, output: 100 },
    }));
    const result = await researchOneRestaurant({
      restaurant: RESTAURANT,
      fetchImpl: fetchImpl(),
      callModel,
    });
    expect(callModel).toHaveBeenCalledTimes(1);
    const prompt = vi.mocked(callModel).mock.calls[0]?.[0];
    expect(prompt?.system).toMatch(/Do not invent/);
    expect(prompt?.user).toContain(OFFICIAL);
    expect(prompt?.user).not.toContain('evil.example');
    expect(result.fetchedUrls).toEqual([OFFICIAL, YELP]);
    expect(result.facts.map((fact) => fact.field)).toEqual(['parking']);
    expect(result.estimatedMicrodollars).toBe(1500);
    expect(result.dropped.length).toBeGreaterThan(0);
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
      now: new Date('2026-11-05T17:00:00.000Z'),
      restaurantCap: 25,
      costCapMicrodollars: 1_000,
    });
    expect(costly.restaurants).toHaveLength(1);
    expect(costly.stoppedBecause).toMatch(/cost cap/);
    const report = formatBriefingReport(costly);
    expect(report.markdown).toContain('Hutchins BBQ');
    expect(report.json).toContain('wanderbite.e06.briefing_research.v1');
  });
});

describe('callBriefingModel', () => {
  it('posts to the Haiku messages API and reads token usage', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.anthropic.com/v1/messages');
      const body = JSON.parse(String(init?.body)) as { model?: string };
      expect(body.model).toBe(BRIEFING_MODEL);
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
