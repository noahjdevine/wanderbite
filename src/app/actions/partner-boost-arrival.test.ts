import { beforeEach, describe, expect, it, vi } from 'vitest';

const requirePartnerSession = vi.fn();
const openBoostArrival = vi.fn();
const supersedeBoostArrival = vi.fn();
const getSupabaseAdmin = vi.fn();

vi.mock('@/lib/require-partner-session', () => ({
  requirePartnerSession: (...args: unknown[]) => requirePartnerSession(...args),
}));

vi.mock('@/lib/boost/arrival-session', () => ({
  openBoostArrival: (...args: unknown[]) => openBoostArrival(...args),
  supersedeBoostArrival: (...args: unknown[]) => supersedeBoostArrival(...args),
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => getSupabaseAdmin(),
}));

const RESTAURANT = '11111111-1111-4111-8111-111111111111';
const HASH = 'ab'.repeat(32);

describe('partner arrival actions', () => {
  beforeEach(() => {
    vi.resetModules();
    requirePartnerSession.mockReset();
    openBoostArrival.mockReset();
    supersedeBoostArrival.mockReset();
    getSupabaseAdmin.mockReset();
    delete process.env.E07_ARRIVAL_SESSIONS_ENABLED;
    requirePartnerSession.mockResolvedValue({
      ok: true,
      restaurantId: RESTAURANT,
      restaurantName: 'Grill',
      tokenHash: HASH,
    });
    getSupabaseAdmin.mockReturnValue({ from: vi.fn(), rpc: vi.fn() });
  });

  it('does not query when the flag is unset', async () => {
    const { createBoostArrivalSession, supersedeBoostArrivalQuote } = await import(
      '@/app/actions/partner-boost-arrival'
    );
    await expect(
      createBoostArrivalSession({
        challengeItemId: '44444444-4444-4444-8444-444444444444',
        idempotencyKey: 'k',
        eligibleSubtotalCents: 8200,
      }),
    ).resolves.toEqual({ ok: false, code: 'disabled' });
    await expect(
      supersedeBoostArrivalQuote({
        sessionId: '55555555-5555-4555-8555-555555555555',
        eligibleSubtotalCents: 9000,
      }),
    ).resolves.toEqual({ ok: false, code: 'disabled' });
    expect(requirePartnerSession).not.toHaveBeenCalled();
    expect(openBoostArrival).not.toHaveBeenCalled();
    expect(supersedeBoostArrival).not.toHaveBeenCalled();
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it('refuses an admin or signed-out caller and uses only the partner restaurant', async () => {
    process.env.E07_ARRIVAL_SESSIONS_ENABLED = 'true';
    requirePartnerSession.mockResolvedValue({ ok: false });
    const { createBoostArrivalSession } = await import('@/app/actions/partner-boost-arrival');
    await expect(
      createBoostArrivalSession({
        challengeItemId: '44444444-4444-4444-8444-444444444444',
        idempotencyKey: 'k',
        eligibleSubtotalCents: 8200,
      }),
    ).resolves.toEqual({ ok: false, code: 'forbidden' });
    expect(openBoostArrival).not.toHaveBeenCalled();
    expect(getSupabaseAdmin).not.toHaveBeenCalled();

    requirePartnerSession.mockResolvedValue({
      ok: true,
      restaurantId: RESTAURANT,
      restaurantName: 'Grill',
      tokenHash: HASH,
    });
    openBoostArrival.mockResolvedValue({ ok: true });
    await createBoostArrivalSession({
      challengeItemId: '44444444-4444-4444-8444-444444444444',
      idempotencyKey: 'k',
      eligibleSubtotalCents: 8200,
    });
    expect(openBoostArrival).toHaveBeenCalledWith(
      expect.objectContaining({ challengeItemId: '44444444-4444-4444-8444-444444444444' }),
      expect.objectContaining({ restaurantId: RESTAURANT, tokenHash: HASH }),
    );
    const ctx = openBoostArrival.mock.calls[0]?.[1] as { restaurantId: string };
    expect(ctx.restaurantId).toBe(RESTAURANT);
    expect(getSupabaseAdmin).toHaveBeenCalledTimes(1);
  });
});
