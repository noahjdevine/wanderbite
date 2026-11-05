import { describe, expect, it, vi } from 'vitest';
import { proposeRestaurantWebsite } from '@/lib/briefings/official-website';
import { PLACES_DETAILS_ENTERPRISE_MICRODOLLARS } from '@/lib/briefings/places';

const RESTAURANT = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  name: "Bob's",
  address: '100 Main St, McKinney, TX 75069',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('proposeRestaurantWebsite', () => {
  it('proposes the Places website and does not call Anthropic when that URL is usable', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).not.toContain('places-test-key');
      if (url.endsWith(':searchText')) {
        const headers = init?.headers as Record<string, string>;
        expect(headers['X-Goog-FieldMask']).toBe('places.id');
        return jsonResponse({ places: [{ id: 'ChIJtestplace01' }] });
      }
      return jsonResponse({
        id: 'ChIJtestplace01',
        displayName: { text: "Bob's Burgers" },
        formattedAddress: '100 Main St, McKinney, TX',
        websiteUri: 'https://bobs.example.com',
      });
    }) as typeof fetch;
    const proposal = await proposeRestaurantWebsite({
      restaurant: RESTAURANT,
      placesKey: 'places-test-key',
      anthropicKey: 'anthropic-test-key',
      fetchImpl,
      outboundDisabled: false,
    });
    expect(proposal.kind).toBe('places');
    expect(proposal.proposed).toBe('https://bobs.example.com/');
    expect(proposal.placeIdToStore).toBe('ChIJtestplace01');
    expect(proposal.estimatedMicrodollars).toBe(PLACES_DETAILS_ENTERPRISE_MICRODOLLARS);
    expect(vi.mocked(fetchImpl).mock.calls.some((call) => String(call[0]).includes('anthropic.com'))).toBe(false);
  });

  it('falls back to web search and skips listing hosts when Places has no website', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(':searchText')) return jsonResponse({ places: [{ id: 'ChIJtestplace01' }] });
      if (url.includes('places.googleapis.com')) {
        return jsonResponse({
          id: 'ChIJtestplace01',
          displayName: { text: "Bob's Burgers" },
          formattedAddress: '100 Main St, McKinney, TX',
          websiteUri: 'https://www.yelp.com/biz/bobs',
        });
      }
      return jsonResponse({
        stop_reason: 'end_turn',
        content: [
          {
            type: 'web_search_tool_result',
            content: [
              { type: 'web_search_result', url: 'https://www.yelp.com/biz/bobs', title: 'Yelp' },
              { type: 'web_search_result', url: 'https://eat.example.net/bobs', title: 'Menu' },
            ],
          },
        ],
        usage: { server_tool_use: { web_search_requests: 1 } },
      });
    }) as typeof fetch;
    const proposal = await proposeRestaurantWebsite({
      restaurant: RESTAURANT,
      placesKey: 'places-test-key',
      anthropicKey: 'anthropic-test-key',
      fetchImpl,
      outboundDisabled: false,
    });
    expect(proposal.proposed).toBe('https://eat.example.net/bobs');
    expect(proposal.kind).toBe('unclassified');
    expect(proposal.notes.join('\n')).toMatch(/yelp\.com/);
  });
});
