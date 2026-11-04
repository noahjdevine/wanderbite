import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.hoisted(() => vi.fn());
const profileMaybeSingle = vi.hoisted(() => vi.fn());
const redemptionQuery = vi.hoisted(() => vi.fn());
const selects = vi.hoisted(() => [] as { table: string; columns: string; column: string; value: string }[]);

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser },
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: string) => {
          selects.push({ table, columns, column, value });
          if (table === 'user_profiles') {
            return { maybeSingle: () => profileMaybeSingle() };
          }
          return redemptionQuery();
        },
      }),
    }),
  }),
}));

import { GET } from '@/app/api/passport/share-image/route';

const MEMBER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('GET /api/passport/share-image', () => {
  beforeEach(() => {
    getUser.mockReset();
    profileMaybeSingle.mockReset();
    redemptionQuery.mockReset();
    selects.length = 0;
  });

  it('returns 401 and no image when signed out', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const response = await GET(
      new Request(`https://wanderbite.co/api/passport/share-image?userId=${OTHER}`),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('content-type') ?? '').not.toContain('image/png');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(selects).toEqual([]);
    const body = await response.text();
    expect(body).not.toContain(OTHER);
  });

  it('returns a private png of the signed-in member only', async () => {
    getUser.mockResolvedValue({ data: { user: { id: MEMBER } } });
    profileMaybeSingle.mockResolvedValue({ data: { full_name: 'Noah Devine' }, error: null });
    redemptionQuery.mockResolvedValue({
      data: [
        {
          status: 'verified',
          verified_at: '2026-11-01T04:30:00.000Z',
          restaurant_id: 'rest-1',
          restaurants: {
            name: 'Hutchins BBQ',
            cuisine_tags: ['bbq'],
            neighborhood: 'Downtown',
          },
        },
      ],
      error: null,
    });

    const response = await GET(
      new Request(
        `https://wanderbite.co/api/passport/share-image?userId=${OTHER}&memberId=${OTHER}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/png');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(selects.map((entry) => entry.value)).toEqual([MEMBER, MEMBER]);
    expect(selects.map((entry) => entry.value)).not.toContain(OTHER);
    const columns = selects.map((entry) => entry.columns).join(' ');
    expect(columns).not.toMatch(/email|note|encrypted_code|token_hash|code_iv|user_id/i);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes[0]).toBe(0x89);
    expect(bytes[1]).toBe(0x50);
    expect(bytes[2]).toBe(0x4e);
    expect(bytes[3]).toBe(0x47);
    const png = new TextDecoder().decode(bytes);
    expect(png).not.toContain(OTHER);
    expect(png).not.toContain(MEMBER);
  });
});
