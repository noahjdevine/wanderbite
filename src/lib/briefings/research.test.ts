// @vitest-environment node
// Node's fetch keeps Set-Cookie. happy-dom strips it, so this file cannot use the default environment.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  BRIEFING_HTML_BYTE_CAP,
  BRIEFING_MODEL,
  BRIEFING_PAGE_CHARS,
  BRIEFING_REDIRECT_HOP_CAP,
  BRIEFING_USER_AGENT,
  DROPPED_FACT_TEXT_CAP,
  WEAK_AGGREGATOR_HOSTS,
  BRIEFING_WEB_SEARCH_MAX_USES,
  BRIEFING_WEB_SEARCH_TOOL,
  WEB_SEARCH_MICRODOLLARS_PER_REQUEST,
  briefingFieldOutcomeCounts,
  briefingInsertRow,
  briefingMaintenanceSystemPrompt,
  briefingSystemPrompt,
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
  isStorableOfficialWebsite,
  proposeOfficialFromUrls,
  rankBriefingUrls,
  htmlToText,
  partitionBriefingRestaurants,
  researchCatalog,
  researchOneRestaurant,
  testRestaurantSkipReason,
  weakAggregatorLabel,
  type BriefingModelCaller,
  type BriefingRestaurant,
} from '@/lib/briefings/research';
import { PLACES_DETAILS_ATMOSPHERE_MICRODOLLARS } from '@/lib/briefings/places';
import { restaurantFactsGuideForPrompt, renderRestaurantFactsGuideModule } from '@/lib/briefings/facts-guide-module';
import { RESTAURANT_FACTS_GUIDE } from '@/lib/briefings/restaurant-facts-guide.generated';
import { MEMBER_BRIEFING_FIELDS, RESEARCH_BRIEFING_FIELDS } from '@/lib/briefings/types';

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
    expect(filtered.dropped.join('\n')).toMatch(/no support passage/);
    expect(filtered.dropped.join('\n')).toMatch(/unknown field/);
    const attire = filtered.droppedFacts.find((fact) => fact.field === 'attire');
    expect(attire).toMatchObject({
      field: 'attire',
      text: 'Black tie is required every night.',
      sourceUrl: OFFICIAL,
      reason: 'no support passage',
    });
    const arrival = filtered.droppedFacts.find((fact) => fact.field === 'arrival');
    expect(arrival?.reason).toBe('not fetched in this run');
    expect(arrival?.sourceUrl).toBe('https://evil.example/not-fetched');
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
    expect(estimateMicrodollars({ input: 1000, output: 100 })).toBe(150);
    expect(estimateMicrodollars({ web_search_requests: 1 })).toBe(WEB_SEARCH_MICRODOLLARS_PER_REQUEST);
    expect(estimateMicrodollars({ input: 1000, output: 100, web_search_requests: 2 })).toBe(
      150 + 2 * WEB_SEARCH_MICRODOLLARS_PER_REQUEST,
    );
    expect(BRIEFING_WEB_SEARCH_TOOL).toBe('web_search_20260318');
    expect(BRIEFING_WEB_SEARCH_MAX_USES).toBe(5);
    expect(briefingModelMatchesDiscover()).toBe(true);
    const sql = readFileSync(
      path.resolve(process.cwd(), 'supabase/migrations/20261124144427_haiku_5_5_price.sql'),
      'utf8',
    );
    expect(sql).toContain(`'anthropic', '${BRIEFING_MODEL}', 'input', 100000`);
    expect(sql).toContain(`'anthropic', '${BRIEFING_MODEL}', 'output', 500000`);
    expect(sql).toContain(`'anthropic', '${BRIEFING_MODEL}', 'cache_read', 10000`);
    expect(sql).toContain(`'anthropic', '${BRIEFING_MODEL}', 'cache_write_5m', 125000`);
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
    expect(parseBriefingArgs([]).includeTest).toBe(false);
    expect(parseBriefingArgs(['--include-test']).includeTest).toBe(true);
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
    if (!passage) throw new Error('missing support passage');
    const filtered = filterSupportedFacts({
      raw: {
        facts: [{ field: 'parking', text: fact, source_url: OFFICIAL }],
      },
      pages: [{ url: OFFICIAL, text: page }],
    });
    expect(filtered.kept).toEqual([]);
    expect(filtered.droppedFacts[0]?.reason).toBe('blocked detail (hours)');
    expect(filtered.droppedFacts[0]?.text).toBe(fact);
    const report = formatBriefingReport({
      verifiedAt: '2026-11-05T17:00:00.000Z',
      restaurants: [
        {
          restaurantId: RESTAURANT.id,
          restaurantName: RESTAURANT.name,
          fetchedUrls: [OFFICIAL],
          facts: [
            {
              field: 'parking',
              text: 'Valet parking sits beside the front door.',
              sourceUrl: OFFICIAL,
              supportPassage: passage,
            },
          ],
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
    expect(filtered.dropped.join('\n')).toMatch(/no support passage/);
  });

  it('keeps the original six on the generic support check', () => {
    const fact = 'Valet parking sits beside the front door after 5 pm.';
    expect(findSupportPassage(fact, page, 'parking')).toBe(
      'Valet parking is available beside the front door after 5 pm.',
    );
    expect(findSupportPassage('Street parking is available.', page, 'arrival')).toBeNull();
    expect(findSupportPassage('Most dinners last about 45 minutes.', page, 'duration')).toBeNull();
    expect(MEMBER_BRIEFING_FIELDS).toEqual([
      'parking',
      'arrival',
      'what_to_expect',
      'duration',
      'attire',
      'accessibility',
    ]);
    expect(RESEARCH_BRIEFING_FIELDS.slice(0, MEMBER_BRIEFING_FIELDS.length)).toEqual([
      ...MEMBER_BRIEFING_FIELDS,
    ]);
  });

  it('drops a fact whose number is not the number in the passage', () => {
    const fact = 'Most dinners last about 45 minutes.';
    expect(findSupportPassage(fact, page)).toBeNull();
    expect(findSupportPassage('Most dinners last about 90 minutes.', page)).toBe(
      'Most dinners last about 90 minutes.',
    );
  });
});

describe('new briefing fields', () => {
  const cases: Array<{
    field: 'vibe' | 'known_for' | 'good_for' | 'seating' | 'reservations';
    page: string;
    supported: string;
    invented: string;
  }> = [
    {
      field: 'vibe',
      page: 'The room is cozy and candlelit, with a lively bar.',
      supported: 'Cozy and candlelit.',
      invented: 'A loud nightclub.',
    },
    {
      field: 'known_for',
      page: 'Known for smoked brisket and house ribs.',
      supported: 'Known for brisket and ribs.',
      invented: 'Known for lobster thermidor.',
    },
    {
      field: 'good_for',
      page: 'Kids are welcome, and the room works for date night.',
      supported: 'Good for kids.',
      invented: 'Good for watching sports.',
    },
    {
      field: 'seating',
      page: 'Dogs are welcome on the patio.',
      supported: 'Dog-friendly patio.',
      invented: 'Private rooftop seating.',
    },
    {
      field: 'reservations',
      page: 'Walk-ins are welcome. Reservations are not required.',
      supported: 'Walk-ins are welcome.',
      invented: 'A waitlist is required.',
    },
  ];

  it.each(cases)('keeps a supported $field fact and drops an invented one', ({ field, page, supported, invented }) => {
    const kept = filterSupportedFacts({
      raw: { facts: [{ field, text: supported, source_url: OFFICIAL }] },
      pages: [{ url: OFFICIAL, text: page }],
    });
    expect(kept.kept.map((fact) => fact.text)).toEqual([supported]);
    expect(kept.kept[0]?.supportPassage.length).toBeGreaterThan(0);
    const dropped = filterSupportedFacts({
      raw: { facts: [{ field, text: invented, source_url: OFFICIAL }] },
      pages: [{ url: OFFICIAL, text: page }],
    });
    expect(dropped.kept).toEqual([]);
    expect(dropped.dropped.join('\n')).toMatch(/failed field cue check/);
  });

  it('requires the short cue the generic word share would miss or invent', () => {
    expect(findSupportPassage('Good for kids.', 'Kids are welcome.')).toBeNull();
    expect(findSupportPassage('Good for kids.', 'Kids are welcome.', 'good_for')).not.toBeNull();
    expect(findSupportPassage('Good for date night.', 'Open late at night for dinner.')).not.toBeNull();
    expect(findSupportPassage('Good for date night.', 'Open late at night for dinner.', 'good_for')).toBeNull();
    expect(findSupportPassage('Walk-ins are welcome.', 'Guests are welcome.')).not.toBeNull();
    expect(findSupportPassage('Walk-ins are welcome.', 'Guests are welcome.', 'reservations')).toBeNull();
    expect(findSupportPassage('Dog-friendly patio.', 'Dogs are welcome on the patio.')).toBeNull();
    expect(findSupportPassage('Dog-friendly patio.', 'Dogs are welcome on the patio.', 'seating')).not.toBeNull();
    expect(findSupportPassage('Known for brisket and ribs.', 'Known for smoked brisket.')).not.toBeNull();
    expect(findSupportPassage('Known for brisket and ribs.', 'Known for smoked brisket.', 'known_for')).toBeNull();
    expect(findSupportPassage('Reservations are not accepted.', 'Reservations are accepted.', 'reservations')).toBeNull();
  });
});

describe('loose list support and blocked details', () => {
  const gap = 'The dining room welcomes guests from town for a long visit. '.repeat(8);

  function spread(parts: readonly string[]): string {
    return parts.join(` ${gap}`);
  }

  function filterField(field: string, text: string, page: string) {
    return filterSupportedFacts({
      raw: { facts: [{ field, text, source_url: OFFICIAL }] },
      pages: [{ url: OFFICIAL, text: page }],
    });
  }

  const spreadCases: Array<{ field: string; text: string; parts: string[] }> = [
    {
      field: 'known_for',
      text: 'Brisket, ribs, sausage, pulled pork, and the Texas Twinkie, a bacon-wrapped brisket-stuffed jalapeño.',
      parts: [
        'The pit smokes brisket all day.',
        'House ribs are cut to order.',
        'Sausage is ground in the kitchen.',
        'Pulled pork comes off the pit.',
        'Order the Texas Twinkie, a bacon-wrapped brisket-stuffed jalapeño.',
      ],
    },
    {
      field: 'known_for',
      text: 'House-made pasta rolled daily, premium seafood, aged meats, and seasonal American dishes with Italian influence.',
      parts: [
        'Fresh housemade pastas are rolled daily.',
        'The counter displays premium seafood.',
        'Aged meats are carved to order.',
        'Seasonal American dishes show an Italian influence.',
      ],
    },
    {
      field: 'good_for',
      text: 'Date night, groups, families, corporate events, rehearsal dinners, and milestone celebrations.',
      parts: [
        'Couples book a date night.',
        'Large groups share one table.',
        'The family table sits by the window.',
        'Host a corporate event in the library.',
        'Rehearsal dinners start in the parlor.',
        'Milestone celebrations fill the calendar.',
      ],
    },
    {
      field: 'reservations',
      text: 'Walk-ins are welcome. Reservations are not taken.',
      parts: ['Walk-ins are welcome any evening.', 'Reservations are not taken for parties.'],
    },
    {
      field: 'vibe',
      text: 'Fun, hip, and casual. Historic 1920s building with old brick interior.',
      parts: [
        'The night is fun.',
        'The crowd feels hip.',
        'Dress is casual.',
        'The historic 1920s building keeps an old brick interior.',
      ],
    },
    {
      field: 'good_for',
      text: 'Groups, families with kids, live music, lawn games, and private events.',
      parts: [
        'Groups gather outside.',
        'Families bring their children.',
        'Live music plays after dinner.',
        'Lawn games sit on the grass.',
        'Private events use the barn.',
      ],
    },
    {
      field: 'good_for',
      text: 'Good for weddings, rehearsal dinners, corporate meetings, and social events.',
      parts: [
        'Weddings are held in the garden.',
        'Rehearsal dinners use the long table.',
        'Corporate meetings book the board room.',
        'Social events fill the weekend.',
      ],
    },
    {
      field: 'reservations',
      text: 'Reservations are available and recommended.',
      parts: ['Reservations are available most nights.', 'Reservations are recommended for weekends.'],
    },
  ];

  it.each(spreadCases)('keeps a spread $field fact when each item is on the page', ({ field, text, parts }) => {
    const filtered = filterField(field, text, spread(parts));
    expect(filtered.kept.map((fact) => fact.text)).toEqual([text]);
    expect(filtered.droppedFacts.map((fact) => fact.reason)).not.toContain('failed field cue check');
  });

  it('trims a known_for item that is not on the page and keeps the rest', () => {
    const filtered = filterField(
      'known_for',
      'Brisket, ribs, sausage, pulled pork, and lobster thermidor.',
      spread([
        'The pit smokes brisket all day.',
        'House ribs are cut to order.',
        'Sausage is ground in the kitchen.',
        'Pulled pork comes off the pit.',
      ]),
    );
    expect(filtered.kept.map((fact) => fact.text)).toEqual(['Brisket, ribs, sausage, and pulled pork.']);
    expect(filtered.droppedFacts).toEqual([
      expect.objectContaining({ text: 'lobster thermidor', reason: 'item not on page' }),
    ]);
  });

  it('drops a two-item known_for fact when only one item is on the page', () => {
    const filtered = filterField('known_for', 'Known for brisket and ribs.', 'Known for smoked brisket.');
    expect(filtered.kept).toEqual([]);
    expect(filtered.droppedFacts[0]?.reason).toBe('failed field cue check');
  });

  it('strips a phone clause and keeps the reservation claim', () => {
    const filtered = filterField(
      'reservations',
      'Walk-ins are welcome. Call (214) 726-0251.',
      'Walk-ins are welcome any evening.',
    );
    expect(filtered.kept.map((fact) => fact.text)).toEqual(['Walk-ins are welcome.']);
    expect(filtered.droppedFacts).toEqual([
      expect.objectContaining({ reason: 'blocked detail (phone)', text: expect.stringContaining('726-0251') }),
    ]);
    const dashed = filterField(
      'reservations',
      'Reservations are available. Call 214-548-5815.',
      'Reservations are available most nights.',
    );
    expect(dashed.kept.map((fact) => fact.text)).toEqual(['Reservations are available.']);
    expect(dashed.droppedFacts[0]?.reason).toBe('blocked detail (phone)');
  });

  it('drops a whole clause that states a clock time or a day schedule', () => {
    const required = filterField(
      'reservations',
      'Reservations are required after 5 pm.',
      'Reservations are required after 5 pm.',
    );
    expect(required.kept).toEqual([]);
    expect(required.droppedFacts[0]?.reason).toBe('blocked detail (hours)');
    const mixed = filterField(
      'reservations',
      'Walk-ins welcome, reservations required on Fridays.',
      'Walk-ins welcome any evening.',
    );
    expect(mixed.kept.map((fact) => fact.text)).toEqual(['Walk-ins welcome.']);
    expect(mixed.droppedFacts).toEqual([
      expect.objectContaining({
        reason: 'blocked detail (hours)',
        text: expect.stringContaining('Fridays'),
      }),
    ]);
    const patio = filterField('seating', 'Patio seating on Saturdays.', 'Patio seating on Saturdays.');
    expect(patio.kept).toEqual([]);
    expect(patio.droppedFacts[0]?.reason).toBe('blocked detail (hours)');
    const weekend = filterField(
      'seating',
      'The patio is dog-friendly. Closed on weekends.',
      'Dogs are welcome on the patio.',
    );
    expect(weekend.kept.map((fact) => fact.text)).toEqual(['The patio is dog-friendly.']);
    expect(weekend.droppedFacts[0]?.reason).toBe('blocked detail (hours)');
    const daily = filterField('seating', 'The patio is open daily.', 'The patio is open daily.');
    expect(daily.kept.map((fact) => fact.text)).toEqual(['The patio is open daily.']);
    const minutes = filterField(
      'duration',
      'Most dinners last about 90 minutes.',
      'Most dinners last about 90 minutes.',
    );
    expect(minutes.kept.map((fact) => fact.text)).toEqual(['Most dinners last about 90 minutes.']);
    const parking = filterField('parking', 'A free parking lot is listed.', 'A free parking lot is listed.');
    expect(parking.kept.map((fact) => fact.text)).toEqual(['A free parking lot is listed.']);
  });

  it('strips a day schedule and drops a fact that is only a schedule', () => {
    const stripped = filterField(
      'seating',
      'The patio is dog-friendly. Open Tuesday through Saturday.',
      'Dogs are welcome on the patio.',
    );
    expect(stripped.kept.map((fact) => fact.text)).toEqual(['The patio is dog-friendly.']);
    expect(stripped.droppedFacts).toEqual([
      expect.objectContaining({
        reason: 'blocked detail (hours)',
        text: expect.stringContaining('Tuesday through Saturday'),
      }),
    ]);
    const onlyHours = filterField('reservations', 'Open Tuesday through Saturday.', 'Open Tuesday through Saturday.');
    expect(onlyHours.kept).toEqual([]);
    expect(onlyHours.droppedFacts[0]?.reason).toBe('blocked detail (hours)');
  });

  it('drops promo, price, email, url, and source commentary', () => {
    const promo = filterField('good_for', 'Kids eat free on Sundays.', 'Kids eat free on Sundays.');
    expect(promo.kept).toEqual([]);
    expect(promo.droppedFacts[0]?.reason).toBe('blocked detail (promo)');
    const meta = filterField('reservations', 'Walk-ins are not mentioned.', 'Walk-ins are welcome.');
    expect(meta.kept).toEqual([]);
    expect(meta.droppedFacts[0]?.reason).toBe('blocked detail (meta)');
    const price = filterField(
      'known_for',
      'Brisket is smoked daily. It is $18 a pound.',
      'Brisket is smoked daily over oak.',
    );
    expect(price.kept.map((fact) => fact.text)).toEqual(['Brisket is smoked daily.']);
    expect(price.droppedFacts[0]?.reason).toBe('blocked detail (price)');
    const email = filterField('arrival', 'Email the pit at pit@example.com.', 'Use the side door.');
    expect(email.kept).toEqual([]);
    expect(email.droppedFacts[0]?.reason).toBe('blocked detail (email)');
    const url = filterField('known_for', 'See https://hutchinsbbq.com/menu.', 'Brisket is smoked daily.');
    expect(url.kept).toEqual([]);
    expect(url.droppedFacts[0]?.reason).toBe('blocked detail (url)');
  });

  it('drops a dangling fragment only after a strip changes the sentence', () => {
    const phone = filterField(
      'reservations',
      'Reservations are available. For parties of seven or more guests, call (214) 726-0251.',
      'Reservations are available most nights.',
    );
    expect(phone.kept.map((fact) => fact.text)).toEqual(['Reservations are available.']);
    expect(phone.droppedFacts.map((fact) => fact.reason)).toEqual([
      'blocked detail (phone)',
      'fragment after strip',
    ]);
    const callForParking = filterField(
      'parking',
      'Call 555-123-4567 for parking.',
      'Call 555-123-4567 for parking. Free parking in the rear lot.',
    );
    expect(callForParking.kept).toEqual([]);
    expect(callForParking.droppedFacts[0]?.reason).toBe('blocked detail (phone)');
    const unchanged = filterField(
      'vibe',
      "Music. Chef Dre's dining room on the second floor is elegant.",
      "Music plays in the dining room. Chef Dre's dining room on the second floor is elegant.",
    );
    expect(unchanged.kept.map((fact) => fact.text)).toEqual([
      "Music. Chef Dre's dining room on the second floor is elegant.",
    ]);
    expect(unchanged.droppedFacts.map((fact) => fact.reason)).not.toContain('fragment after strip');
  });

  it('keeps verbless member facts when the page supports them', () => {
    const cases: Array<{ field: string; text: string; page: string }> = [
      { field: 'attire', text: 'Casual attire.', page: 'Dress code is casual attire.' },
      { field: 'parking', text: 'Street parking only.', page: 'Street parking only, along the curb.' },
      { field: 'duration', text: 'About 90 minutes.', page: 'Plan on about 90 minutes for dinner.' },
      { field: 'parking', text: 'Free parking in the rear lot.', page: 'Free parking in the rear lot behind the kitchen.' },
    ];
    for (const sample of cases) {
      const filtered = filterField(sample.field, sample.text, sample.page);
      expect(filtered.kept.map((fact) => fact.text)).toEqual([sample.text]);
      expect(filtered.droppedFacts.map((fact) => fact.reason)).not.toContain('fragment after strip');
    }
  });

  it('keeps a paired dish name whole when the page has that phrase', () => {
    const whole = filterField(
      'known_for',
      'Known for mac and cheese.',
      'The kitchen is known for mac and cheese.',
    );
    expect(whole.kept.map((fact) => fact.text)).toEqual(['Known for mac and cheese.']);
  });

  it.each([
    'mac and cheese',
    'fish and chips',
    'chips and salsa',
    'biscuits and gravy',
    'shrimp and grits',
  ])('keeps %s together when another known_for item is trimmed', (dish) => {
    const filtered = filterField(
      'known_for',
      `Brisket, ${dish}, and lobster thermidor.`,
      spread(['The pit smokes brisket all day.', `The kitchen serves ${dish}.`]),
    );
    expect(filtered.kept.map((fact) => fact.text)).toEqual([`Brisket and ${dish}.`]);
    expect(filtered.droppedFacts).toEqual([
      expect.objectContaining({ text: 'lobster thermidor', reason: 'item not on page' }),
    ]);
  });

  it('drops a good_for fact that is only meal periods', () => {
    const meals = filterField(
      'good_for',
      'Lunch, brunch, and dinner.',
      'Lunch, brunch, and dinner are served.',
    );
    expect(meals.kept).toEqual([]);
    expect(meals.droppedFacts[0]?.reason).toBe('failed field cue check');
    const withOccasion = filterField(
      'good_for',
      'Good for families and brunch.',
      'Families gather for brunch on the lawn.',
    );
    expect(withOccasion.kept.map((fact) => fact.text)).toEqual(['Good for families and brunch.']);
  });

  it('drops a vibe fact whose adjectives are not on the page', () => {
    const filtered = filterField('vibe', 'Quiet and formal.', 'The night is fun. The crowd feels hip.');
    expect(filtered.kept).toEqual([]);
    expect(filtered.droppedFacts[0]?.reason).toBe('failed field cue check');
  });

  it('drops a reservation polarity flip and does not invent recommended', () => {
    const flipped = filterField('reservations', 'Reservations are not taken.', 'Reservations are recommended.');
    expect(flipped.kept).toEqual([]);
    expect(flipped.droppedFacts[0]?.reason).toBe('failed field cue check');
    const invented = filterField(
      'reservations',
      'Reservations are available and recommended.',
      'Reservations are available most nights.',
    );
    expect(invented.kept.map((fact) => fact.text)).toEqual(['Reservations are available.']);
    expect(invented.droppedFacts).toEqual([
      expect.objectContaining({ text: 'recommended', reason: 'item not on page' }),
    ]);
  });

  it('counts drop reasons in the dry-run report header', () => {
    const report = formatBriefingReport({
      verifiedAt: '2026-11-05T17:00:00.000Z',
      restaurants: [
        {
          restaurantId: RESTAURANT.id,
          restaurantName: RESTAURANT.name,
          fetchedUrls: [OFFICIAL],
          facts: [],
          dropped: [
            'dropped known_for because item not on page',
            'dropped reservations because blocked detail (phone)',
            'model JSON has no facts array',
          ],
          droppedFacts: [
            { field: 'known_for', text: 'lobster thermidor', sourceUrl: OFFICIAL, reason: 'item not on page' },
            {
              field: 'reservations',
              text: 'Call (214) 726-0251.',
              sourceUrl: OFFICIAL,
              reason: 'blocked detail (phone)',
            },
          ],
          units: { input: 1, output: 1 },
          estimatedMicrodollars: 1,
          notes: [],
        },
      ],
      stoppedBecause: null,
      totals: { input: 1, output: 1, estimatedMicrodollars: 1 },
    });
    expect(report.markdown).toContain('Drop reasons:');
    expect(report.markdown).toContain('- item not on page: 1');
    expect(report.markdown).toContain('- blocked detail (phone): 1');
    expect(report.markdown).toContain('- model JSON has no facts array: 1');
    expect(report.json).toContain('"dropReasonCounts"');
    expect(report.json).toContain('"item not on page": 1');
    const empty = formatBriefingReport({
      verifiedAt: '2026-11-05T17:00:00.000Z',
      restaurants: [],
      stoppedBecause: null,
      totals: { input: 0, output: 0, estimatedMicrodollars: 0 },
    });
    expect(empty.markdown).toContain('Drop reasons: none');
  });
});

describe('research guide prompt', () => {
  const guidePath = path.resolve(process.cwd(), 'Docs/research/restaurant-facts-guide.md');
  const generatedPath = path.resolve(process.cwd(), 'src/lib/briefings/restaurant-facts-guide.generated.ts');

  it('builds the extraction prompt from the markdown guide', () => {
    const markdown = readFileSync(guidePath, 'utf8');
    expect(readFileSync(generatedPath, 'utf8')).toBe(renderRestaurantFactsGuideModule(markdown));
    expect(RESTAURANT_FACTS_GUIDE).toBe(markdown);
    const prompt = briefingSystemPrompt();
    const guide = restaurantFactsGuideForPrompt(markdown);
    expect(prompt).toContain(guide);
    expect(prompt).toContain('Return JSON only');
    expect(prompt).toContain('source_url must be copied exactly');
    expect(prompt).toMatch(/Do not invent/);
    expect(prompt).toContain('Tuesday through Saturday');
    expect(prompt).toContain('not mentioned');
    expect(prompt).toContain('phone numbers');
    expect(prompt).toContain('Say recommended only when the page says recommended');
    for (const field of RESEARCH_BRIEFING_FIELDS) {
      expect(prompt).toContain(`### ${field}`);
      expect(prompt).toContain('What counts:');
      expect(prompt).toContain('What does not count:');
    }
    const maintenance = briefingMaintenanceSystemPrompt();
    expect(maintenance).toContain(prompt);
    expect(maintenance).toContain('change_summary');
    expect(maintenance).toContain('160');
    expect(maintenance).toContain('Do not add a second object.');
  });
});

describe('field counts', () => {
  it('tallies kept and dropped facts for each field in the dry-run report', () => {
    const counts = briefingFieldOutcomeCounts(
      [{ field: 'parking' }, { field: 'vibe' }],
      [
        'dropped good_for because the page text does not support it',
        'dropped duplicate parking',
        'dropped Places seating because a page fact is already kept',
        'dropped unknown field offer',
        'dropped a fact that was not an object',
      ],
    );
    expect(counts.parking).toEqual({ kept: 1, dropped: 1 });
    expect(counts.vibe).toEqual({ kept: 1, dropped: 0 });
    expect(counts.good_for).toEqual({ kept: 0, dropped: 1 });
    expect(counts.seating).toEqual({ kept: 0, dropped: 1 });
    expect(counts.reservations).toEqual({ kept: 0, dropped: 0 });
    const report = formatBriefingReport({
      verifiedAt: '2026-11-05T17:00:00.000Z',
      restaurants: [
        {
          restaurantId: RESTAURANT.id,
          restaurantName: RESTAURANT.name,
          fetchedUrls: [OFFICIAL],
          facts: [
            {
              field: 'parking',
              text: 'Valet parking is available beside the front door.',
              sourceUrl: OFFICIAL,
              supportPassage: 'Valet parking is available beside the front door.',
            },
          ],
          dropped: ['dropped vibe because the page text does not support it'],
          units: { input: 10, output: 4 },
          estimatedMicrodollars: 30,
          notes: [],
        },
      ],
      stoppedBecause: null,
      totals: { input: 10, output: 4, estimatedMicrodollars: 30 },
    });
    expect(report.markdown).toContain('Field counts:');
    expect(report.markdown).toContain('Drop reasons:');
    expect(report.markdown).toContain('- parking: kept 1, dropped 0');
    expect(report.markdown).toContain('- vibe: kept 0, dropped 1');
    expect(report.json).toContain('"fieldCountTotals"');
    expect(report.json).toContain('"fieldCounts"');
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
      temperature?: number;
      thinking?: { type?: string };
      tools?: Array<Record<string, unknown>>;
      messages?: Array<{ content?: string }>;
    };
    expect(body.model).toBe(BRIEFING_MODEL);
    expect(body.temperature).toBeUndefined();
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.tools).toEqual([
      {
        type: 'web_search_20260318',
        name: 'web_search',
        max_uses: 5,
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
    expect(body.messages?.[0]?.content).toContain('official website');
    expect(body.messages?.[0]?.content).toContain('menu, about, and FAQ');
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
    expect(secondTools[0]?.max_uses).toBe(4);
    expect(found.failure).toBeNull();
    expect(found.urls).toEqual([OFFICIAL]);
    expect(found.warnings).toEqual(['Anthropic web search was unavailable']);
    expect(found.units).toEqual({ input: 14, output: 3, web_search_requests: 2 });
    expect(estimateMicrodollars(found.units)).toBe(1 + 2 + 2 * WEB_SEARCH_MICRODOLLARS_PER_REQUEST);
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
    expect(result.estimatedMicrodollars).toBe(150 + WEB_SEARCH_MICRODOLLARS_PER_REQUEST);
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
      const body = JSON.parse(String(init?.body)) as {
        model?: string;
        max_tokens?: number;
        temperature?: number;
        thinking?: { type?: string };
        tools?: unknown;
      };
      expect(body.model).toBe(BRIEFING_MODEL);
      expect(body.max_tokens).toBe(2048);
      expect(body.temperature).toBeUndefined();
      expect(body.thinking).toEqual({ type: 'disabled' });
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
    expect(estimateMicrodollars(result.units)).toBe(3);
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
    expect(result.dropped.join('\n')).toMatch(/no support passage/);
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

describe('stored official site and Places facts', () => {
  it('prices a Place Details atmosphere call inside the same estimate as Haiku', () => {
    expect(estimateMicrodollars({ places_details_atmosphere: 1, places_text_search_ids_only: 1 })).toBe(
      PLACES_DETAILS_ATMOSPHERE_MICRODOLLARS,
    );
    expect(estimateMicrodollars({ places_details_enterprise: 2 })).toBe(40_000);
  });

  it('treats a stored host as official even when the hostname has no name token', () => {
    const stored = 'https://bbq.example.net/start';
    expect(rankBriefingUrls([stored, YELP], 'Hutchins BBQ')).toEqual([YELP]);
    expect(rankBriefingUrls([YELP, stored], 'Hutchins BBQ', ['bbq.example.net'])).toEqual([stored, YELP]);
    expect(proposeOfficialFromUrls([YELP, 'https://www.opentable.com/hutchins', stored], "Bob's")).toEqual({
      url: stored,
      kind: 'unclassified',
    });
    expect(proposeOfficialFromUrls([YELP], 'Hutchins BBQ')).toEqual({ url: null, kind: 'none' });
  });

  it('follows a stored official URL onto another domain and refuses that hop for a search hit', async () => {
    const stored = 'https://bbq.example.net/start';
    const landed = 'https://order.other-domain.test/menu';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://api.anthropic.com/v1/messages') return response(searchPayload());
      if (url.endsWith('/robots.txt')) return response('missing', 404, 'text/plain');
      if (url === stored) {
        return new Response(null, { status: 301, headers: { location: landed } });
      }
      if (url === landed) return response(PAGE);
      if (url === OFFICIAL) {
        return new Response(null, { status: 302, headers: { location: 'https://evil.example/phish' } });
      }
      if (url.startsWith(YELP)) return response('<p>Guests mention a line at the door.</p>');
      return response('missing', 404, 'text/plain');
    }) as typeof fetch;
    const callModel: BriefingModelCaller = vi.fn(async () => ({
      text: JSON.stringify({
        facts: [
          {
            field: 'parking',
            text: 'Valet parking is available beside the front door.',
            source_url: landed,
          },
        ],
      }),
      units: { input: 10, output: 4 },
    }));
    const result = await researchOneRestaurant({
      restaurant: { ...RESTAURANT, officialWebsite: stored },
      fetchImpl: fetchMock,
      callModel,
      apiKey: API_KEY,
    });
    expect(result.fetchedUrls[0]).toBe(landed);
    expect(result.fetchedUrls).not.toContain('https://evil.example/phish');
    expect(result.facts.map((fact) => fact.sourceUrl)).toEqual([landed]);
    expect(result.notes.join('\n')).toMatch(/redirect left the site/);
    expect(vi.mocked(fetchMock).mock.calls.some((call) => String(call[0]) === 'https://evil.example/phish')).toBe(
      false,
    );
  });

  it('keeps Places sentences when search fails and does not ask the model to invent them', async () => {
    const callModel: BriefingModelCaller = vi.fn(async () => ({
      text: '{"facts":[]}',
      units: { input: 1, output: 1 },
    }));
    const fetchMock = vi.fn(async () =>
      response(
        JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'overloaded' } }),
        529,
        'application/json',
      ),
    ) as typeof fetch;
    const result = await researchOneRestaurant({
      restaurant: RESTAURANT,
      fetchImpl: fetchMock,
      callModel,
      apiKey: API_KEY,
      placesLookup: async () => ({
        placeId: 'ChIJtestplace01',
        placeIdToStore: 'ChIJtestplace01',
        officialWebsite: null,
        facts: [
          {
            field: 'parking',
            text: 'A free parking lot is listed.',
            sourceUrl: 'https://maps.google.com/?cid=99',
            supportPassage: 'parkingOptions.freeParkingLot=true',
          },
        ],
        units: { places_details_atmosphere: 1, places_text_search_ids_only: 1 },
        notes: [],
      }),
    });
    expect(callModel).not.toHaveBeenCalled();
    expect(result.facts).toEqual([
      {
        field: 'parking',
        text: 'A free parking lot is listed.',
        sourceUrl: 'https://maps.google.com/?cid=99',
        supportPassage: 'parkingOptions.freeParkingLot=true',
      },
    ]);
    expect(result.placeIdToStore).toBe('ChIJtestplace01');
    expect(result.estimatedMicrodollars).toBe(PLACES_DETAILS_ATMOSPHERE_MICRODOLLARS);
    const report = formatBriefingReport({
      verifiedAt: '2026-11-05T17:00:00.000Z',
      restaurants: [result],
      stoppedBecause: null,
      totals: { input: 0, output: 0, estimatedMicrodollars: result.estimatedMicrodollars },
    });
    expect(report.markdown).toContain('Label: Google Maps');
    expect(report.markdown).toContain('Place Details Enterprise + Atmosphere x1');
    expect(report.markdown).toContain('parkingOptions.freeParkingLot=true');
  });

  it('keeps a verbless Places attire fact', async () => {
    const callModel: BriefingModelCaller = vi.fn(async () => ({
      text: '{"facts":[]}',
      units: { input: 1, output: 1 },
    }));
    const fetchMock = vi.fn(async () =>
      response(
        JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'overloaded' } }),
        529,
        'application/json',
      ),
    ) as typeof fetch;
    const result = await researchOneRestaurant({
      restaurant: RESTAURANT,
      fetchImpl: fetchMock,
      callModel,
      apiKey: API_KEY,
      placesLookup: async () => ({
        placeId: 'ChIJtestplace01',
        placeIdToStore: null,
        officialWebsite: null,
        facts: [
          {
            field: 'attire',
            text: 'Casual attire.',
            sourceUrl: 'https://maps.google.com/?cid=99',
            supportPassage: 'Casual attire.',
          },
        ],
        units: { places_details_atmosphere: 1 },
        notes: [],
      }),
    });
    expect(result.facts).toEqual([
      {
        field: 'attire',
        text: 'Casual attire.',
        sourceUrl: 'https://maps.google.com/?cid=99',
        supportPassage: 'Casual attire.',
      },
    ]);
    expect(result.droppedFacts?.map((fact) => fact.reason) ?? []).not.toContain('fragment after strip');
  });

  it('counts Places spend toward the cost cap before the next restaurant', async () => {
    const callModel: BriefingModelCaller = vi.fn(async () => ({
      text: '{"facts":[]}',
      units: {},
    }));
    const second = { ...RESTAURANT, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'The Yard' };
    let lookups = 0;
    const run = await researchCatalog({
      restaurants: [RESTAURANT, second],
      fetchImpl: fetchImpl(),
      callModel,
      apiKey: API_KEY,
      now: new Date('2026-11-05T17:00:00.000Z'),
      restaurantCap: 25,
      costCapMicrodollars: PLACES_DETAILS_ATMOSPHERE_MICRODOLLARS,
      placesLookup: async () => {
        lookups += 1;
        return {
          placeId: null,
          placeIdToStore: null,
          officialWebsite: null,
          facts: [],
          units: { places_details_atmosphere: 1 },
          notes: [],
        };
      },
    });
    expect(lookups).toBe(1);
    expect(run.restaurants).toHaveLength(1);
    expect(run.stoppedBecause).toMatch(/cost cap/);
    expect(run.restaurants[0]?.estimatedMicrodollars).toBeGreaterThanOrEqual(PLACES_DETAILS_ATMOSPHERE_MICRODOLLARS);
  });

  it('leaves the official website migration https-only and unapplied', () => {
    const sql = readFileSync(
      path.resolve(process.cwd(), 'supabase/migrations/20261105202512_e06_a2_restaurant_official_website.sql'),
      'utf8',
    );
    expect(sql).toMatch(/NOT applied to hosted/);
    expect(sql).toMatch(/official_website text/);
    expect(sql).toMatch(/restaurants_official_website_https_check/);
    expect(sql).toMatch(/revoke select \(official_website\)/i);
  });
});

const MCKINNEY_ADDRESS = '100 Main St, McKinney, TX 75069';

describe('official website host rules', () => {
  it('does not treat a city token in the restaurant name as a host match', () => {
    expect(
      proposeOfficialFromUrls(
        ['https://bestmckinney.com/food', 'https://mckinneygrill.com/gallery'],
        'McKinney Grill',
        MCKINNEY_ADDRESS,
      ),
    ).toEqual({ url: 'https://mckinneygrill.com/', kind: 'official' });
    expect(
      proposeOfficialFromUrls(['https://bestmckinney.com/food'], 'McKinney Grill', MCKINNEY_ADDRESS),
    ).toEqual({ url: 'https://bestmckinney.com/food', kind: 'unclassified' });
    expect(
      proposeOfficialFromUrls(
        ['https://visitfrisco.com/eat', 'https://friscotacos.com/menu'],
        'Frisco Tacos',
        '10 Oak St, Frisco, TX 75034',
      ),
    ).toEqual({ url: 'https://friscotacos.com/', kind: 'official' });
    expect(
      proposeOfficialFromUrls(
        ['https://visittexas.com/eat', 'https://texasroadhouse.com/visit'],
        'Texas Roadhouse',
        MCKINNEY_ADDRESS,
      ),
    ).toEqual({ url: 'https://texasroadhouse.com/', kind: 'official' });
  });

  it('never proposes a listing or skipped host, and keeps scanning for the restaurant domain', () => {
    const rejected = [
      'https://visitmckinney.com/restaurants/grill',
      'https://www.visitmckinney.com/',
      'https://order.toasttab.com/online/grill',
      'https://toasttab.com/grill',
      'https://nextdoor.com/pages/grill',
      'https://www.nextdoor.com/pages/grill',
      'https://maps.roadtrippers.com/us/mckinney/food/grill',
      'https://roadtrippers.com/grill',
      'https://mindtrip.ai/restaurant/grill',
      'https://www.mindtrip.ai/restaurant/grill',
      'https://joe.coffee/grill',
      'https://www.joe.coffee/grill',
    ];
    for (const url of rejected) {
      expect(isStorableOfficialWebsite(url, 'McKinney Grill', MCKINNEY_ADDRESS)).toBe(false);
      expect(proposeOfficialFromUrls([url], 'McKinney Grill', MCKINNEY_ADDRESS)).toEqual({
        url: null,
        kind: 'none',
      });
    }
    expect(
      proposeOfficialFromUrls([...rejected, 'https://mckinneygrill.com/visit'], 'McKinney Grill', MCKINNEY_ADDRESS),
    ).toEqual({ url: 'https://mckinneygrill.com/', kind: 'official' });
    expect(
      rankBriefingUrls(
        [
          'https://visitmckinney.com/restaurants/grill',
          'https://nextdoor.com/pages/grill',
          'https://order.toasttab.com/online/grill',
          'https://mckinneygrill.com/gallery',
        ],
        'McKinney Grill',
        [],
        MCKINNEY_ADDRESS,
      ),
    ).toEqual([
      'https://mckinneygrill.com/gallery',
      'https://visitmckinney.com/restaurants/grill',
      'https://order.toasttab.com/online/grill',
    ]);
  });

  it('stores the site root for a content path and keeps a chain location page', () => {
    expect(
      proposeOfficialFromUrls(['https://hutchinsbbq.com/gallery'], 'Hutchins BBQ McKinney', MCKINNEY_ADDRESS),
    ).toEqual({ url: 'https://hutchinsbbq.com/', kind: 'official' });
    expect(
      proposeOfficialFromUrls(['https://hutchinsbbq.com/visit?utm_source=google'], 'Hutchins BBQ', MCKINNEY_ADDRESS),
    ).toEqual({ url: 'https://hutchinsbbq.com/', kind: 'official' });
    expect(
      proposeOfficialFromUrls(
        ['https://www.chuys.com/locations/mckinney/gallery?utm_source=google'],
        "Chuy's McKinney",
        MCKINNEY_ADDRESS,
      ),
    ).toEqual({ url: 'https://www.chuys.com/locations/mckinney', kind: 'official' });
    expect(proposeOfficialFromUrls(['https://www.chuys.com/mckinney'], "Chuy's", MCKINNEY_ADDRESS)).toEqual({
      url: 'https://www.chuys.com/mckinney',
      kind: 'official',
    });
    expect(proposeOfficialFromUrls(['https://www.chuys.com/locations'], "Chuy's", MCKINNEY_ADDRESS)).toEqual({
      url: 'https://www.chuys.com/',
      kind: 'official',
    });
  });

  it('searches again after a rejected host and then proposes the restaurant domain', async () => {
    const restaurant = { ...RESTAURANT, name: 'Hutchins BBQ McKinney' };
    const calls: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push(body);
      if (calls.length === 1) {
        return response(
          JSON.stringify({
            stop_reason: 'end_turn',
            content: [
              {
                type: 'web_search_tool_result',
                content: [
                  { type: 'web_search_result', url: 'https://visitmckinney.com/restaurants/hutchins', title: 'Guide' },
                  { type: 'web_search_result', url: 'https://order.toasttab.com/hutchins', title: 'Toast' },
                  { type: 'web_search_result', url: 'https://nextdoor.com/pages/hutchins', title: 'Nextdoor' },
                ],
              },
            ],
            usage: { server_tool_use: { web_search_requests: 1 } },
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
              content: [{ type: 'web_search_result', url: 'https://hutchinsbbq.com/visit', title: 'Visit' }],
            },
          ],
          usage: { server_tool_use: { web_search_requests: 1 } },
        }),
        200,
        'application/json',
      );
    }) as typeof fetch;
    const found = await discoverBriefingUrls({
      restaurant,
      apiKey: API_KEY,
      fetchImpl: fetchMock,
    });
    expect(calls).toHaveLength(2);
    const secondTools = calls[1]?.tools as Array<{ max_uses?: number }>;
    expect(secondTools[0]?.max_uses).toBe(4);
    const secondMessages = calls[1]?.messages as Array<{ content?: string }>;
    expect(secondMessages.at(-1)?.content).toMatch(/own website/);
    expect(found.urls).toEqual([
      'https://visitmckinney.com/restaurants/hutchins',
      'https://order.toasttab.com/hutchins',
      'https://nextdoor.com/pages/hutchins',
      'https://hutchinsbbq.com/visit',
    ]);
    expect(found.warnings).toEqual(['Search continued after a listing or skipped host.']);
    expect(proposeOfficialFromUrls(found.urls, restaurant.name, restaurant.address)).toEqual({
      url: 'https://hutchinsbbq.com/',
      kind: 'official',
    });
  });

  it('does not propose a listing when further searches also miss the restaurant domain', async () => {
    const restaurant = { ...RESTAURANT, name: 'Hutchins BBQ McKinney' };
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return response(
        JSON.stringify({
          stop_reason: 'end_turn',
          content: [
            {
              type: 'web_search_tool_result',
              content: [
                { type: 'web_search_result', url: 'https://www.visitmckinney.com/food', title: 'Guide' },
                { type: 'web_search_result', url: 'https://maps.roadtrippers.com/hutchins', title: 'Roadtrip' },
                { type: 'web_search_result', url: 'https://joe.coffee/hutchins', title: 'Joe' },
              ],
            },
          ],
          usage: { server_tool_use: { web_search_requests: 1 } },
        }),
        200,
        'application/json',
      );
    }) as typeof fetch;
    const found = await discoverBriefingUrls({
      restaurant,
      apiKey: API_KEY,
      fetchImpl: fetchMock,
    });
    expect(calls).toBe(3);
    expect(found.units.web_search_requests).toBe(3);
    expect(proposeOfficialFromUrls(found.urls, restaurant.name, restaurant.address)).toEqual({
      url: null,
      kind: 'none',
    });
  });
});

function redirectResponse(location: string, setCookie?: string): Response {
  const headers = new Headers({ location });
  if (setCookie) headers.append('set-cookie', setCookie);
  return new Response(null, { status: 302, headers });
}

function cookieOn(init?: RequestInit): string | null {
  const headers = init?.headers;
  if (!headers || headers instanceof Headers || Array.isArray(headers)) return null;
  const record = headers as Record<string, string>;
  return record.cookie ?? record.Cookie ?? null;
}

describe('redirect hops, cookies, and loops', () => {
  function chainFetch(redirects: number): { fetchImpl: typeof fetch; calls: string[] } {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === 'https://api.anthropic.com/v1/messages') {
        return response(searchBody(['https://hutchinsbbq.com/hop/0']), 200, 'application/json');
      }
      if (url.endsWith('/robots.txt')) return response('missing', 404, 'text/plain');
      const hop = /^https:\/\/hutchinsbbq\.com\/hop\/(\d+)$/.exec(url);
      if (!hop) return response('missing', 404, 'text/plain');
      const index = Number(hop[1]);
      if (index < redirects) return redirectResponse(`https://hutchinsbbq.com/hop/${index + 1}`);
      return response(PAGE);
    }) as typeof fetch;
    return { fetchImpl, calls };
  }

  it('follows 10 redirects and then reads the page', async () => {
    expect(BRIEFING_REDIRECT_HOP_CAP).toBe(10);
    const { fetchImpl, calls } = chainFetch(BRIEFING_REDIRECT_HOP_CAP);
    const result = await researchOneRestaurant({
      restaurant: { ...RESTAURANT, officialWebsite: 'https://hutchinsbbq.com/hop/0' },
      fetchImpl,
      callModel: emptyModel(),
      apiKey: API_KEY,
    });
    expect(result.notes.join('\n')).not.toMatch(/too many redirects|redirect loop/);
    expect(result.fetchedUrls).toContain('https://hutchinsbbq.com/hop/10');
    expect(calls).toContain('https://hutchinsbbq.com/hop/10');
  });

  it('reports too many redirects one hop past the cap and does not request the next URL', async () => {
    const { fetchImpl, calls } = chainFetch(BRIEFING_REDIRECT_HOP_CAP + 1);
    const result = await researchOneRestaurant({
      restaurant: { ...RESTAURANT, officialWebsite: 'https://hutchinsbbq.com/hop/0' },
      fetchImpl,
      callModel: emptyModel(),
      apiKey: API_KEY,
    });
    expect(result.notes).toContain('https://hutchinsbbq.com/hop/0: too many redirects');
    expect(calls).not.toContain(`https://hutchinsbbq.com/hop/${BRIEFING_REDIRECT_HOP_CAP + 1}`);
  });

  it('carries Set-Cookie across hops in one fetch, including www, and not onto another host', async () => {
    const start = 'https://hutchinsbbq.com/visit';
    const slashed = 'https://hutchinsbbq.com/visit/';
    const wwwLand = 'https://www.hutchinsbbq.com/land';
    const headersByUrl = new Map<string, string | null>();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      headersByUrl.set(url, cookieOn(init));
      if (url === 'https://api.anthropic.com/v1/messages') {
        return response(searchBody([start]), 200, 'application/json');
      }
      if (url.endsWith('/robots.txt')) return response('missing', 404, 'text/plain');
      if (url === start) {
        return redirectResponse(slashed, 'gate=abc; Domain=hutchinsbbq.com; Path=/');
      }
      if (url === slashed) return redirectResponse(wwwLand);
      if (url === wwwLand) return response(PAGE);
      return response('missing', 404, 'text/plain');
    }) as typeof fetch;
    const result = await researchOneRestaurant({
      restaurant: RESTAURANT,
      fetchImpl,
      callModel: emptyModel(),
      apiKey: API_KEY,
    });
    expect(result.notes.join('\n')).not.toMatch(/redirect left the site|redirect loop/);
    expect(headersByUrl.get(slashed)).toBe('gate=abc');
    expect(headersByUrl.get(wwwLand)).toBe('gate=abc');
    expect(result.fetchedUrls).toContain(wwwLand);
    expect(result.notes.join('\n')).not.toContain('gate=abc');
  });

  it('does not send a host-only cookie to www or to another host', async () => {
    const start = 'https://bbq.example.net/gate';
    const wwwLand = 'https://www.bbq.example.net/land';
    const other = 'https://order.other-domain.test/menu';
    const headersByUrl = new Map<string, string | null>();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      headersByUrl.set(url, cookieOn(init));
      if (url === 'https://api.anthropic.com/v1/messages') {
        return response(searchBody([start]), 200, 'application/json');
      }
      if (url.endsWith('/robots.txt')) return response('missing', 404, 'text/plain');
      if (url === start) return redirectResponse(wwwLand, 'gate=abc; Path=/');
      if (url === wwwLand) return redirectResponse(other, 'gate=abc; Path=/');
      if (url === other) return response(PAGE);
      return response('missing', 404, 'text/plain');
    }) as typeof fetch;
    const result = await researchOneRestaurant({
      restaurant: { ...RESTAURANT, officialWebsite: start },
      fetchImpl,
      callModel: emptyModel(),
      apiKey: API_KEY,
    });
    expect(headersByUrl.get(wwwLand)).toBeNull();
    expect(headersByUrl.get(other)).toBeNull();
    expect(result.fetchedUrls[0]).toBe(other);
    expect(result.notes.join('\n')).not.toContain('gate=abc');
  });

  it('reports a redirect loop when the same URL is seen twice', async () => {
    const first = 'https://hutchinsbbq.com/a';
    const second = 'https://hutchinsbbq.com/b';
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === 'https://api.anthropic.com/v1/messages') {
        return response(searchBody([first]), 200, 'application/json');
      }
      if (url.endsWith('/robots.txt')) return response('missing', 404, 'text/plain');
      if (url === first) return redirectResponse(second);
      if (url === second) return redirectResponse(first);
      return response(PAGE);
    }) as typeof fetch;
    const result = await researchOneRestaurant({
      restaurant: RESTAURANT,
      fetchImpl,
      callModel: emptyModel(),
      apiKey: API_KEY,
    });
    expect(result.notes).toContain(`${first}: redirect loop`);
    expect(calls.filter((url) => url === first)).toHaveLength(1);
    expect(calls.filter((url) => url === second)).toHaveLength(1);
  });

  it('refuses an http redirect', async () => {
    const start = 'https://hutchinsbbq.com/visit';
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === 'https://api.anthropic.com/v1/messages') {
        return response(searchBody([start]), 200, 'application/json');
      }
      if (url.endsWith('/robots.txt')) return response('missing', 404, 'text/plain');
      if (url === start) return redirectResponse('http://hutchinsbbq.com/visit');
      return response(PAGE);
    }) as typeof fetch;
    const result = await researchOneRestaurant({
      restaurant: RESTAURANT,
      fetchImpl,
      callModel: emptyModel(),
      apiKey: API_KEY,
    });
    expect(result.notes).toContain(`${start}: redirect was not https`);
    expect(calls.some((url) => url.startsWith('http://'))).toBe(false);
  });
});

describe('robots.txt allow and skip cases', () => {
  const page = 'https://bobs.example/menu';
  const robotsUrl = 'https://bobs.example/robots.txt';

  async function runWithRobots(robots: Response | 'fail') {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === 'https://api.anthropic.com/v1/messages') {
        return response(searchBody([page]), 200, 'application/json');
      }
      if (url === robotsUrl) {
        if (robots === 'fail') throw new Error('network down');
        return robots;
      }
      if (url === page) return response(`<p>${PARKING_FACT}</p>`);
      return response('missing', 404, 'text/plain');
    }) as typeof fetch;
    const result = await researchOneRestaurant({
      restaurant: { ...RESTAURANT, name: 'Bobs Steak', address: '1 Main St, McKinney, TX 75069' },
      fetchImpl,
      callModel: emptyModel(),
      apiKey: API_KEY,
    });
    return { result, calls };
  }

  it('treats robots.txt 401 and 403 as no rules and still fetches the page', async () => {
    for (const status of [401, 403]) {
      const { result, calls } = await runWithRobots(response('nope', status, 'text/plain'));
      expect(result.notes).toContain(`${robotsUrl}: status ${status}, treated as no rules (allowed)`);
      expect(result.fetchedUrls).toContain(page);
      expect(calls).toContain(page);
    }
  });

  it('treats a non-200 2xx robots.txt response as no rules', async () => {
    const { result, calls } = await runWithRobots(response('', 202, 'text/plain'));
    expect(result.notes).toContain(`${robotsUrl}: status 202, treated as no rules (allowed)`);
    expect(result.fetchedUrls).toContain(page);
    expect(calls).toContain(page);
  });

  it('treats an HTML or unreadable robots.txt body as no rules', async () => {
    const html = await runWithRobots(
      response('<!doctype html><html><body>missing</body></html>', 200, 'text/html'),
    );
    expect(html.result.notes).toContain(`${robotsUrl}: HTML body, treated as no rules (allowed)`);
    expect(html.result.fetchedUrls).toContain(page);
    const unreadable = await runWithRobots(response('{"no":"rules"}', 200, 'application/json'));
    expect(unreadable.result.notes).toContain(`${robotsUrl}: unreadable body, treated as no rules (allowed)`);
    expect(unreadable.result.fetchedUrls).toContain(page);
  });

  it('skips the page when robots.txt is a 5xx or the fetch fails', async () => {
    const server = await runWithRobots(response('down', 503, 'text/plain'));
    expect(server.result.notes).toContain(`${page}: robots.txt status 503, skipped (server error)`);
    expect(server.result.fetchedUrls).not.toContain(page);
    expect(server.calls).not.toContain(page);
    const network = await runWithRobots('fail');
    expect(network.result.notes).toContain(`${page}: robots.txt fetch failed, skipped (network failure)`);
    expect(network.calls).not.toContain(page);
  });

  it('still skips a path an explicit Disallow matches', async () => {
    const { result, calls } = await runWithRobots(
      response('User-agent: *\nDisallow: /\n', 200, 'text/plain'),
    );
    expect(result.notes).toContain(`${page}: robots.txt disallows the path`);
    expect(calls).not.toContain(page);
  });
});

describe('dropped facts in the dry-run report', () => {
  it('lists field, text, source, and reason, and truncates long text', () => {
    const long = `Patio seating ${'word '.repeat(60)}endmarker`;
    expect(long.length).toBeGreaterThan(DROPPED_FACT_TEXT_CAP);
    const droppedFacts = [
      {
        field: 'seating',
        text: long,
        sourceUrl: TRIPADVISOR,
        reason: 'review-only source',
      },
      {
        field: 'parking',
        text: 'There is a multi-storey car park.',
        sourceUrl: 'https://urban-grill.hey-rest.com/place',
        reason: 'no support passage',
      },
    ];
    const report = formatBriefingReport({
      verifiedAt: '2026-11-05T17:00:00.000Z',
      restaurants: [
        {
          restaurantId: RESTAURANT.id,
          restaurantName: RESTAURANT.name,
          fetchedUrls: [OFFICIAL],
          facts: [
            {
              field: 'parking',
              text: PARKING_FACT,
              sourceUrl: OFFICIAL,
              supportPassage: PARKING_FACT,
            },
          ],
          dropped: [
            'dropped seating because review-only source',
            'dropped parking because no support passage',
          ],
          droppedFacts,
          units: { input: 1, output: 1 },
          estimatedMicrodollars: 1,
          notes: [],
        },
      ],
      stoppedBecause: null,
      totals: { input: 1, output: 1, estimatedMicrodollars: 1 },
      skippedTestRestaurants: [{ name: 'QA Kitchen', reason: 'name starts with "QA "' }],
    });
    expect(report.markdown).toContain(`- parking: ${PARKING_FACT}`);
    expect(report.markdown).toContain('Source: ' + OFFICIAL);
    expect(report.markdown).toContain('Dropped facts:');
    expect(report.markdown).toContain('Reason: review-only source');
    expect(report.markdown).toContain('Reason: no support passage');
    expect(report.markdown).toContain(`Source: ${TRIPADVISOR}`);
    expect(report.markdown).toContain('There is a multi-storey car park.');
    expect(report.markdown).not.toContain('endmarker');
    expect(report.markdown).toContain('QA Kitchen: name starts with "QA "');
    expect(report.json).toContain('"reason": "review-only source"');
    expect(report.json).toContain('"reason": "no support passage"');
    expect(report.json).not.toContain('endmarker');
    const included = formatBriefingReport({
      verifiedAt: '2026-11-05T17:00:00.000Z',
      restaurants: [],
      stoppedBecause: null,
      totals: { input: 0, output: 0, estimatedMicrodollars: 0 },
      skippedTestRestaurants: [],
      includeTestRestaurants: true,
    });
    expect(included.markdown).toContain('Skipped test restaurants: none (--include-test)');
  });

  it('drops a physical fact supported only by a review and keeps listing amenities', () => {
    const html = [
      '<div class="details">Outdoor seating on the patio. Valet parking is available beside the front door.</div>',
      '<div class="review-body">The patio was windy and the lot was a multi-storey car park.</div>',
      '<span itemprop="reviewBody">We sat outside under a heater.</span>',
    ].join('');
    const filtered = filterSupportedFacts({
      raw: {
        facts: [
          { field: 'seating', text: 'Outdoor seating on the patio.', source_url: TRIPADVISOR },
          { field: 'seating', text: 'The patio was windy.', source_url: TRIPADVISOR },
          { field: 'parking', text: 'Valet parking is available beside the front door.', source_url: TRIPADVISOR },
          { field: 'parking', text: 'The lot was a multi-storey car park.', source_url: TRIPADVISOR },
          { field: 'seating', text: 'The room is lovely tonight.', source_url: OFFICIAL },
        ],
      },
      pages: [
        { url: TRIPADVISOR, text: htmlToText(html), html },
        { url: OFFICIAL, text: 'The room is lovely tonight.' },
      ],
    });
    expect(filtered.kept.map((fact) => fact.text)).toEqual([
      'Valet parking is available beside the front door.',
      'Outdoor seating on the patio.',
    ]);
    expect(filtered.droppedFacts.find((fact) => fact.text === 'The patio was windy.')?.reason).toBe(
      'review-only source',
    );
    expect(filtered.droppedFacts.find((fact) => fact.text?.includes('multi-storey'))?.reason).toBe(
      'review-only source',
    );
    expect(filtered.droppedFacts.find((fact) => fact.text === 'The room is lovely tonight.')?.reason).toBe(
      'failed field cue check',
    );
  });
});

describe('weak aggregator hosts', () => {
  it('matches hey-rest style hosts and the other thin directories', () => {
    expect(weakAggregatorLabel('urban-grill-and-wine-bar-mckinney.hey-rest.com')).toBe('hey-rest');
    expect(weakAggregatorLabel('urban-grill-and-wine-bar-mckinney.hey-restaurants.com')).toBe('hey-rest');
    expect(weakAggregatorLabel('hey-restaurants.com')).toBe('hey-rest');
    expect(weakAggregatorLabel('menu.hey-restaurants.co.uk')).toBe('hey-rest');
    expect(weakAggregatorLabel('cdn.hey-rest.io')).toBe('hey-rest');
    expect(weakAggregatorLabel('www.restaurantji.com')).toBe('restaurantji.com');
    expect(weakAggregatorLabel('sluurp.com')).toBe('sluurp.com');
    expect(weakAggregatorLabel('hey-restaurant.com')).toBeNull();
    expect(weakAggregatorLabel('www.yelp.com')).toBeNull();
    const heyRestaurants = 'https://urban-grill-and-wine-bar-mckinney.hey-restaurants.com/place';
    expect(rankBriefingUrls([heyRestaurants, OFFICIAL], 'Hutchins BBQ')).toEqual([OFFICIAL]);
    expect(WEAK_AGGREGATOR_HOSTS.map((entry) => entry.id)).toEqual([
      'hey-rest',
      'restaurantji.com',
      'sluurp.com',
    ]);
    expect(rankBriefingUrls(['https://urban-grill.hey-rest.com/place', OFFICIAL], 'Hutchins BBQ')).toEqual([
      OFFICIAL,
    ]);
  });

  it('skips aggregator pages before fetch and does not search again when they are the only hits', async () => {
    const hey = 'https://urban-grill-and-wine-bar-mckinney.hey-rest.com/place';
    const ji = 'https://www.restaurantji.com/tx/mckinney/urban-grill';
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === 'https://api.anthropic.com/v1/messages') {
        return response(searchBody([hey, ji]), 200, 'application/json');
      }
      return response(PAGE);
    }) as typeof fetch;
    const result = await researchOneRestaurant({
      restaurant: { ...RESTAURANT, name: 'Urban Grill' },
      fetchImpl,
      callModel: emptyModel(),
      apiKey: API_KEY,
    });
    expect(result.units.web_search_requests).toBe(1);
    expect(result.fetchedUrls).toEqual([]);
    expect(result.notes).toContain(`${hey}: skipped weak aggregator host (hey-rest)`);
    expect(result.notes).toContain(`${ji}: skipped weak aggregator host (restaurantji.com)`);
    expect(calls.some((url) => url.includes('hey-rest') || url.includes('restaurantji'))).toBe(false);
    const report = formatBriefingReport({
      verifiedAt: '2026-11-05T17:00:00.000Z',
      restaurants: [result],
      stoppedBecause: null,
      totals: { input: 0, output: 0, estimatedMicrodollars: result.estimatedMicrodollars },
    });
    expect(report.markdown).toContain('skipped weak aggregator host (hey-rest)');
  });

  it('does not spend a page slot on an aggregator when real pages are also returned', async () => {
    const hey = 'https://urban-grill.hey-rest.com/place';
    const sluurp = 'https://sluurp.com/urban-grill';
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === 'https://api.anthropic.com/v1/messages') {
        return response(searchBody([hey, sluurp, OFFICIAL, YELP, OPENTABLE, TRIPADVISOR]), 200, 'application/json');
      }
      if (url.endsWith('/robots.txt')) return response('missing', 404, 'text/plain');
      return response('<p>Open tonight for dinner.</p>');
    }) as typeof fetch;
    const result = await researchOneRestaurant({
      restaurant: RESTAURANT,
      fetchImpl,
      callModel: emptyModel(),
      apiKey: API_KEY,
    });
    expect(result.units.web_search_requests).toBe(1);
    expect(result.fetchedUrls[0]).toBe(OFFICIAL);
    expect(result.fetchedUrls).not.toContain(hey);
    expect(result.fetchedUrls).not.toContain(sluurp);
    expect(calls.some((url) => url.includes('hey-rest') || url.includes('sluurp.com'))).toBe(false);
    expect(result.notes.join('\n')).toMatch(/skipped weak aggregator host \(sluurp.com\)/);
  });

  it('does not fetch a stored official website on a weak aggregator host', async () => {
    const hey = 'https://urban-grill.hey-rest.com/place';
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === 'https://api.anthropic.com/v1/messages') {
        return response(searchBody([OFFICIAL]), 200, 'application/json');
      }
      if (url.endsWith('/robots.txt')) return response('missing', 404, 'text/plain');
      return response(PAGE);
    }) as typeof fetch;
    const result = await researchOneRestaurant({
      restaurant: { ...RESTAURANT, officialWebsite: hey },
      fetchImpl,
      callModel: emptyModel(),
      apiKey: API_KEY,
    });
    expect(result.notes).toContain(`${hey}: skipped weak aggregator host (hey-rest)`);
    expect(calls.some((url) => url.includes('hey-rest'))).toBe(false);
    expect(result.fetchedUrls).toContain(OFFICIAL);
  });

  it('skips a hey-restaurants.com search result and drops a fact that cites it', async () => {
    const hey = 'https://urban-grill-and-wine-bar-mckinney.hey-restaurants.com/place';
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === 'https://api.anthropic.com/v1/messages') {
        return response(searchBody([hey, OFFICIAL]), 200, 'application/json');
      }
      if (url.endsWith('/robots.txt')) return response('missing', 404, 'text/plain');
      return response(PAGE);
    }) as typeof fetch;
    const result = await researchOneRestaurant({
      restaurant: RESTAURANT,
      fetchImpl,
      callModel: async () => ({
        text: JSON.stringify({
          facts: [
            {
              field: 'parking',
              text: 'Valet parking is available beside the front door.',
              source_url: hey,
            },
            {
              field: 'parking',
              text: 'Valet parking is available beside the front door.',
              source_url: OFFICIAL,
            },
          ],
        }),
        units: { input: 1, output: 1 },
      }),
      apiKey: API_KEY,
    });
    expect(result.notes).toContain(`${hey}: skipped weak aggregator host (hey-rest)`);
    expect(calls.some((url) => url.includes('hey-restaurants.com'))).toBe(false);
    expect(result.fetchedUrls).toContain(OFFICIAL);
    expect(result.facts.map((fact) => fact.sourceUrl)).toEqual([OFFICIAL]);
    expect(result.droppedFacts).toEqual([
      expect.objectContaining({
        sourceUrl: hey,
        reason: 'skipped weak aggregator host (hey-rest)',
      }),
    ]);
  });
});

describe('test restaurant skip', () => {
  it('skips fixture names and a market or partner marked test unless --include-test is set', () => {
    const real: BriefingRestaurant = { ...RESTAURANT };
    expect(testRestaurantSkipReason(real)).toBeNull();
    expect(testRestaurantSkipReason({ ...real, name: 'Quality Grill' })).toBeNull();
    expect(testRestaurantSkipReason({ ...real, name: 'Greatest BBQ' })).toBeNull();
    expect(testRestaurantSkipReason({ ...real, name: 'Testaccio' })).toBeNull();
    expect(testRestaurantSkipReason({ ...real, name: "Bob's (not real)" })).toBe('name contains "(not real)"');
    expect(testRestaurantSkipReason({ ...real, name: 'QA Kitchen' })).toBe('name starts with "QA "');
    expect(testRestaurantSkipReason({ ...real, name: 'Test Smokehouse' })).toBe('name starts with "Test "');
    expect(testRestaurantSkipReason({ ...real, marketName: 'Test Market' })).toBe(
      'market "Test Market" is marked test',
    );
    expect(testRestaurantSkipReason({ ...real, marketSlug: 'g1-test-market' })).toBe(
      'market "g1-test-market" is marked test',
    );
    expect(testRestaurantSkipReason({ ...real, orgName: 'Fixture Partner' })).toBe(
      'partner "Fixture Partner" is marked test',
    );
    const partitioned = partitionBriefingRestaurants(
      [
        real,
        { ...real, id: '11111111-1111-4111-8111-111111111111', name: 'QA Kitchen' },
        { ...real, id: '22222222-2222-4222-8222-222222222222', name: 'Hutchins (not real)' },
      ],
      false,
    );
    expect(partitioned.selected.map((item) => item.name)).toEqual([real.name]);
    expect(partitioned.skippedTestRestaurants).toEqual([
      { name: 'QA Kitchen', reason: 'name starts with "QA "' },
      { name: 'Hutchins (not real)', reason: 'name contains "(not real)"' },
    ]);
    const included = partitionBriefingRestaurants(
      [real, { ...real, name: 'QA Kitchen' }],
      true,
    );
    expect(included.selected).toHaveLength(2);
    expect(included.skippedTestRestaurants).toEqual([]);
  });
});
