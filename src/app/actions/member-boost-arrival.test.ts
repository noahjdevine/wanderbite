import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireUser = vi.fn();
const openMemberBoostArrival = vi.fn();
const getSupabaseAdmin = vi.fn();

vi.mock('@/lib/auth/require-user', () => ({
  requireUser: (...args: unknown[]) => requireUser(...args),
}));

vi.mock('@/lib/boost/arrival-session', () => ({
  openMemberBoostArrival: (...args: unknown[]) => openMemberBoostArrival(...args),
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => getSupabaseAdmin(),
}));

const USER = '55555555-5555-4555-8555-555555555555';
const OTHER = '66666666-6666-4666-8666-666666666666';
const ITEM = '44444444-4444-4444-8444-444444444444';
const CYCLE = '77777777-7777-4777-8777-777777777777';
const RESTAURANT = '11111111-1111-4111-8111-111111111111';
const LAT = 33.1984333;
const LON = -96.6397333;

type Row = Record<string, unknown>;

function adminFrom(tables: Record<string, Row[]>) {
  return {
    from(name: string) {
      const filters: Array<[string, unknown]> = [];
      const api = {
        select() {
          return api;
        },
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return api;
        },
        maybeSingle() {
          const row =
            (tables[name] ?? []).find((candidate) =>
              filters.every(([column, value]) => candidate[column] === value),
            ) ?? null;
          return Promise.resolve({ data: row, error: null });
        },
      };
      return api;
    },
  };
}

function ownedTables(userId = USER): Record<string, Row[]> {
  return {
    challenge_items: [
      {
        id: ITEM,
        restaurant_id: RESTAURANT,
        status: 'assigned',
        offer_version_id: '33333333-3333-4333-8333-333333333333',
        cycle_id: CYCLE,
      },
    ],
    challenge_cycles: [{ id: CYCLE, user_id: userId }],
    restaurants: [{ id: RESTAURANT, lat: LAT, lon: LON }],
  };
}

function freshLocation(overrides: Record<string, unknown> = {}) {
  return {
    lat: LAT,
    lon: LON,
    accuracy: 20,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('member boost check-in action', () => {
  beforeEach(() => {
    vi.resetModules();
    requireUser.mockReset();
    openMemberBoostArrival.mockReset();
    getSupabaseAdmin.mockReset();
    delete process.env.E07_ARRIVAL_SESSIONS_ENABLED;
    requireUser.mockResolvedValue({ ok: true, userId: USER, email: 'member@example.com' });
    getSupabaseAdmin.mockReturnValue(adminFrom(ownedTables()));
    openMemberBoostArrival.mockResolvedValue({ ok: true, session: { id: 'session-1' }, quote: { id: 'quote-1' } });
  });

  it('returns disabled and does not read when the flag is unset', async () => {
    const { checkInMemberBoost } = await import('@/app/actions/member-boost-arrival');
    await expect(
      checkInMemberBoost({
        challengeItemId: ITEM,
        idempotencyKey: 'member-key',
        location: freshLocation(),
      }),
    ).resolves.toEqual({ ok: false, code: 'disabled' });
    expect(requireUser).not.toHaveBeenCalled();
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
    expect(openMemberBoostArrival).not.toHaveBeenCalled();
  });

  it('refuses another member and does not open a session', async () => {
    process.env.E07_ARRIVAL_SESSIONS_ENABLED = 'true';
    getSupabaseAdmin.mockReturnValue(adminFrom(ownedTables(OTHER)));
    const { checkInMemberBoost } = await import('@/app/actions/member-boost-arrival');
    await expect(
      checkInMemberBoost({
        challengeItemId: ITEM,
        idempotencyKey: 'member-key',
        location: freshLocation(),
      }),
    ).resolves.toEqual({ ok: false, code: 'forbidden' });
    expect(openMemberBoostArrival).not.toHaveBeenCalled();
  });

  it('refuses a stale or distant reading before opening', async () => {
    process.env.E07_ARRIVAL_SESSIONS_ENABLED = 'true';
    const { checkInMemberBoost } = await import('@/app/actions/member-boost-arrival');
    const stale = await checkInMemberBoost({
      challengeItemId: ITEM,
      idempotencyKey: 'member-key',
      location: freshLocation({ timestamp: Date.now() - 61_000 }),
    });
    expect(stale).toEqual({ ok: false, code: 'stale_location' });
    expect(JSON.stringify(stale)).not.toContain(String(LAT));

    const far = await checkInMemberBoost({
      challengeItemId: ITEM,
      idempotencyKey: 'member-key',
      location: freshLocation({ lat: LAT + 1 }),
    });
    expect(far).toEqual({ ok: false, code: 'out_of_radius' });
    expect(openMemberBoostArrival).not.toHaveBeenCalled();
  });

  it('opens with the restaurant on the owned item', async () => {
    process.env.E07_ARRIVAL_SESSIONS_ENABLED = 'true';
    const { checkInMemberBoost } = await import('@/app/actions/member-boost-arrival');
    const payload = {
      challengeItemId: ITEM,
      idempotencyKey: 'member-key',
      location: freshLocation(),
      restaurantId: '99999999-9999-4999-8999-999999999999',
    };
    const result = await checkInMemberBoost(payload);
    expect(result.ok).toBe(true);
    expect(openMemberBoostArrival).toHaveBeenCalledTimes(1);
    const [input, ctx] = openMemberBoostArrival.mock.calls[0] as [
      { challengeItemId: string; eligibleSubtotalCents?: number },
      { restaurantId: string; userId: string },
    ];
    expect(input.challengeItemId).toBe(ITEM);
    expect(input.eligibleSubtotalCents).toBeUndefined();
    expect(ctx.restaurantId).toBe(RESTAURANT);
    expect(ctx.userId).toBe(USER);
    expect(JSON.stringify(result)).not.toContain(String(LAT));
  });
});
