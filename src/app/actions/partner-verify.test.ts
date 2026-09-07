import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PARTNER_SESSION_EXPIRED_MESSAGE } from '@/lib/partner-session';
import { hashRedemptionToken } from '@/lib/redemption-token-hash';
import {
  VERIFY_THROTTLED_MESSAGE,
  VERIFY_UNAVAILABLE_MESSAGE,
} from '@/lib/partner-verify-limit';

const ACTIVE_ID = '50000000-0000-4000-8000-000000000001';
const OTHER_ID = '50000000-0000-4000-8000-000000000002';
const USER_ID = '40000000-0000-4000-8000-000000000001';

const requirePartnerSession = vi.fn();
const enforcePartnerVerifyLimit = vi.fn();
const rpc = vi.fn();
const reportVerifyIntegrityError = vi.fn();
const from = vi.fn();

vi.mock('@/lib/require-partner-session', () => ({
  requirePartnerSession: (...args: unknown[]) => requirePartnerSession(...args),
}));

vi.mock('@/lib/partner-verify-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/partner-verify-limit')>(
    '@/lib/partner-verify-limit',
  );
  return {
    ...actual,
    enforcePartnerVerifyLimit: (...args: unknown[]) => enforcePartnerVerifyLimit(...args),
  };
});

vi.mock('@/lib/report-verify-integrity-error', () => ({
  reportVerifyIntegrityError: (...args: unknown[]) => reportVerifyIntegrityError(...args),
}));

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (header: string) => (header === 'x-forwarded-for' ? '203.0.113.10' : null),
  }),
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
  }),
}));

function issuedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'redemption-1',
    user_id: USER_ID,
    restaurant_id: ACTIVE_ID,
    status: 'issued',
    token_hash: hashRedemptionToken('WB-G6OK1'),
    verified_at: null,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    ...overrides,
  };
}

describe('verifyRedemptionTokenForPartner', () => {
  beforeEach(() => {
    requirePartnerSession.mockReset();
    enforcePartnerVerifyLimit.mockReset();
    rpc.mockReset();
    reportVerifyIntegrityError.mockReset();
    from.mockReset();
    requirePartnerSession.mockResolvedValue({
      ok: true,
      restaurantId: ACTIVE_ID,
      restaurantName: 'Active Grill',
      tokenHash: 'session-hash',
    });
    enforcePartnerVerifyLimit.mockResolvedValue('allow');
    rpc.mockResolvedValue({ data: [], error: null });
    from.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          maybeSingle: async () => ({ data: null, error: null }),
          in: async () => ({ data: [], error: null }),
          limit: async () => ({ data: [], error: null }),
        }),
      }),
    });
  });

  it('refuses verify when the partner session is missing', async () => {
    requirePartnerSession.mockResolvedValue({ ok: false });
    const { verifyRedemptionTokenForPartner } = await import('@/app/actions/partner-verify');
    await expect(verifyRedemptionTokenForPartner('WB-ANY')).resolves.toEqual({
      success: false,
      message: PARTNER_SESSION_EXPIRED_MESSAGE,
    });
    expect(enforcePartnerVerifyLimit).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not call the RPC when production Redis is unavailable', async () => {
    enforcePartnerVerifyLimit.mockResolvedValue('unavailable');
    const { verifyRedemptionTokenForPartner } = await import('@/app/actions/partner-verify');
    await expect(verifyRedemptionTokenForPartner('WB-ANY')).resolves.toEqual({
      success: false,
      message: VERIFY_UNAVAILABLE_MESSAGE,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not call the RPC when the limiter throttles', async () => {
    enforcePartnerVerifyLimit.mockResolvedValue('throttled');
    const { verifyRedemptionTokenForPartner } = await import('@/app/actions/partner-verify');
    await expect(verifyRedemptionTokenForPartner('WB-ANY')).resolves.toEqual({
      success: false,
      message: VERIFY_THROTTLED_MESSAGE,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not call the RPC when the limiter helper returns unavailable after a throw', async () => {
    enforcePartnerVerifyLimit.mockResolvedValue('unavailable');
    const { verifyRedemptionTokenForPartner } = await import('@/app/actions/partner-verify');
    await expect(verifyRedemptionTokenForPartner('WB-CODE')).resolves.toEqual({
      success: false,
      message: VERIFY_UNAVAILABLE_MESSAGE,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('maps a single claimed row to success', async () => {
    const now = new Date().toISOString();
    rpc.mockResolvedValue({
      data: [issuedRow({ status: 'verified', verified_at: now })],
      error: null,
    });
    from.mockImplementation((table: string) => {
      if (table === 'user_profiles') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { email: 'a@b.c' }, error: null }) }),
          }),
        };
      }
      if (table === 'restaurants') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { name: 'Active Grill' }, error: null }),
            }),
          }),
        };
      }
      if (table === 'redemptions') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ data: null, error: null, count: 1 }),
            }),
          }),
        };
      }
      if (table === 'user_badges') {
        return {
          select: () => ({
            eq: () => ({ in: async () => ({ data: [], error: null }) }),
          }),
          upsert: async () => ({ error: null }),
        };
      }
      return { select: () => ({}) };
    });
    const { verifyRedemptionTokenForPartner } = await import('@/app/actions/partner-verify');
    const result = await verifyRedemptionTokenForPartner('WB-G6OK1');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.redemptionDetails.email).toBe('a@b.c');
      expect(result.redemptionDetails.restaurantName).toBe('Active Grill');
    }
    expect(rpc).toHaveBeenCalledWith('verify_redemption', {
      p_token_hash: hashRedemptionToken('WB-G6OK1'),
      p_restaurant_id: ACTIVE_ID,
    });
  });

  it('treats a second empty RPC result as already used', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    from.mockImplementation((table: string) => {
      if (table !== 'redemptions') return { select: () => ({}) };
      return {
        select: () => ({
          eq: () => ({
            limit: async () => ({
              data: [
                issuedRow({
                  status: 'verified',
                  verified_at: '2026-01-01T12:00:00.000Z',
                }),
              ],
              error: null,
            }),
          }),
        }),
      };
    });
    const { verifyRedemptionTokenForPartner } = await import('@/app/actions/partner-verify');
    const result = await verifyRedemptionTokenForPartner('WB-G6OK1');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).toMatch(/already used/);
    }
  });

  it('does not award badges when the RPC returns two rows', async () => {
    rpc.mockResolvedValue({
      data: [
        issuedRow({ id: 'r1', user_id: USER_ID, status: 'verified' }),
        issuedRow({
          id: 'r2',
          user_id: '40000000-0000-4000-8000-000000000099',
          status: 'verified',
        }),
      ],
      error: null,
    });
    const { verifyRedemptionTokenForPartner } = await import('@/app/actions/partner-verify');
    await expect(verifyRedemptionTokenForPartner('WB-G6OK1')).resolves.toEqual({
      success: false,
      message: 'Verification failed. Please try again later.',
    });
    expect(reportVerifyIntegrityError).toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it('does not award badges when the RPC raises a duplicate-hash error', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'duplicate issued redemptions for token_hash', code: '23514' },
    });
    const { verifyRedemptionTokenForPartner } = await import('@/app/actions/partner-verify');
    await expect(verifyRedemptionTokenForPartner('WB-G6OK1')).resolves.toEqual({
      success: false,
      message: 'Verification failed. Please try again later.',
    });
    expect(reportVerifyIntegrityError).toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it('reports the wrong restaurant from a read-only lookup', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    from.mockImplementation((table: string) => {
      if (table !== 'redemptions') return { select: () => ({}) };
      return {
        select: () => ({
          eq: () => ({
            limit: async () => ({
              data: [issuedRow({ restaurant_id: OTHER_ID })],
              error: null,
            }),
          }),
        }),
      };
    });
    const { verifyRedemptionTokenForPartner } = await import('@/app/actions/partner-verify');
    await expect(verifyRedemptionTokenForPartner('WB-G6OK1')).resolves.toEqual({
      success: false,
      message: 'This code is not for your restaurant.',
    });
  });

  it('reports an expired issued code from a read-only lookup', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    from.mockImplementation((table: string) => {
      if (table !== 'redemptions') return { select: () => ({}) };
      return {
        select: () => ({
          eq: () => ({
            limit: async () => ({
              data: [
                issuedRow({
                  expires_at: new Date(Date.now() - 60_000).toISOString(),
                }),
              ],
              error: null,
            }),
          }),
        }),
      };
    });
    const { verifyRedemptionTokenForPartner } = await import('@/app/actions/partner-verify');
    await expect(verifyRedemptionTokenForPartner('WB-G6OK1')).resolves.toEqual({
      success: false,
      message: 'Code expired',
    });
  });
});
