import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptRedemptionCode } from '@/lib/redemption-crypto';

const getUser = vi.fn();
const maybeSingle = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle }),
      }),
    }),
  }),
}));

const KEY = Buffer.alloc(32, 7).toString('base64');

describe('getRedemptionCode', () => {
  beforeEach(() => {
    getUser.mockReset();
    maybeSingle.mockReset();
    vi.stubEnv('REDEMPTION_CODE_ENCRYPTION_KEY', KEY);
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  });

  it('returns an issued code only while expires_at is still ahead', async () => {
    const sealed = encryptRedemptionCode('WB-LIVE1');
    maybeSingle.mockResolvedValue({
      data: {
        status: 'issued',
        encrypted_code: sealed.encrypted,
        code_iv: sealed.iv,
        user_id: 'user-1',
        expires_at: new Date(Date.now() + 14 * 60 * 1000).toISOString(),
      },
      error: null,
    });
    const { getRedemptionCode } = await import('@/app/actions/get-redemption-code');
    await expect(getRedemptionCode('red-1')).resolves.toMatchObject({
      state: 'issued',
      code: 'WB-LIVE1',
    });
  });

  it('returns the expired result for an issued code past expires_at', async () => {
    const sealed = encryptRedemptionCode('WB-OLD1');
    const expiresAt = new Date(Date.now() - 60_000).toISOString();
    maybeSingle.mockResolvedValue({
      data: {
        status: 'issued',
        encrypted_code: sealed.encrypted,
        code_iv: sealed.iv,
        user_id: 'user-1',
        expires_at: expiresAt,
      },
      error: null,
    });
    const { getRedemptionCode } = await import('@/app/actions/get-redemption-code');
    await expect(getRedemptionCode('red-1')).resolves.toEqual({
      state: 'expired',
      expiresAt,
    });
  });

  it('returns the expired result when the row is already expired', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        status: 'expired',
        encrypted_code: 'cipher',
        code_iv: 'iv',
        user_id: 'user-1',
        expires_at: '2026-11-05T01:00:00.000Z',
      },
      error: null,
    });
    const { getRedemptionCode } = await import('@/app/actions/get-redemption-code');
    await expect(getRedemptionCode('red-1')).resolves.toEqual({
      state: 'expired',
      expiresAt: '2026-11-05T01:00:00.000Z',
    });
  });

  it('does not return a code for a verified redemption', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        status: 'verified',
        encrypted_code: 'cipher',
        code_iv: 'iv',
        user_id: 'user-1',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
      error: null,
    });
    const { getRedemptionCode } = await import('@/app/actions/get-redemption-code');
    await expect(getRedemptionCode('red-1')).resolves.toEqual({ state: 'unavailable' });
  });
});
