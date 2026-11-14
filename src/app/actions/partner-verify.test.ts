import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PARTNER_SESSION_EXPIRED_MESSAGE } from '@/lib/partner-session';
import { hashRedemptionToken } from '@/lib/redemption-token-hash';
import { PARTNER_CODE_NOT_FOUND_MESSAGE } from '@/lib/partner-redemption-code';
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
const captureException = vi.fn();
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

vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureException(...args),
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

const ITEM = '44444444-4444-4444-8444-444444444444';
const SESSION = '55555555-5555-4555-8555-555555555555';
const QUOTE = '22222222-2222-4222-8222-222222222222';
const VERSION = '77777777-7777-4777-8777-777777777777';
const EXPIRES = '2026-11-08T22:00:00.000Z';
const VERIFIED_AT = '2026-11-08T18:05:00.000Z';

type QueryResult = { data: unknown; error: { message: string } | null; count?: number | null };

function issuedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'redemption-1',
    user_id: USER_ID,
    restaurant_id: ACTIVE_ID,
    status: 'issued',
    token_hash: hashRedemptionToken('WB-G6PK2'),
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
    captureException.mockReset();
    from.mockReset();
    delete process.env.E07_ARRIVAL_SESSIONS_ENABLED;
    delete process.env.E09_PROGRESSION_LEDGER_ENABLED;
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
    rpc.mockResolvedValue({
      data: [issuedRow({ status: 'verified', verified_at: '2026-11-14T15:14:00.000Z' })],
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
              maybeSingle: async () => ({ data: null, error: null }),
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
    const result = await verifyRedemptionTokenForPartner('WB-G6PK2');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.redemptionDetails.email).toBe('a@b.c');
      expect(result.redemptionDetails.restaurantName).toBe('Active Grill');
      expect(result.redemptionDetails.verifiedAt).toContain('9:14 AM CT');
      expect(result.hideDiscountAmount).toBe(false);
    }
    expect(rpc).toHaveBeenCalledWith('verify_redemption', {
      p_token_hash: hashRedemptionToken('WB-G6PK2'),
      p_restaurant_id: ACTIVE_ID,
    });
  });

  it('still verifies a version-bound item and hides the dollar amount', async () => {
    rpc.mockResolvedValue({
      data: [issuedRow({ status: 'verified', challenge_item_id: 'item-1' })],
      error: null,
    });
    from.mockImplementation((table: string) => {
      if (table === 'challenge_items') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { offer_version_id: 'version-1' }, error: null }),
            }),
          }),
        };
      }
      if (table === 'offer_versions') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { tiers: [{ threshold_cents: 4000, discount_cents: 1500 }] },
                error: null,
              }),
            }),
          }),
        };
      }
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
            eq: () => ({ maybeSingle: async () => ({ data: { name: 'Active Grill' }, error: null }) }),
          }),
        };
      }
      if (table === 'redemptions') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { challenge_item_id: 'item-1' },
                error: null,
              }),
              eq: () => ({ data: null, error: null, count: 1 }),
            }),
          }),
        };
      }
      if (table === 'user_badges') {
        return {
          select: () => ({ eq: () => ({ in: async () => ({ data: [], error: null }) }) }),
          upsert: async () => ({ error: null }),
        };
      }
      return { select: () => ({}) };
    });
    const { verifyRedemptionTokenForPartner } = await import('@/app/actions/partner-verify');
    const result = await verifyRedemptionTokenForPartner('WB-G6PK2');
    expect(rpc).toHaveBeenCalledWith('verify_redemption_and_settle', {
      p_token_hash: hashRedemptionToken('WB-G6PK2'),
      p_restaurant_id: ACTIVE_ID,
    });
    expect(result).toMatchObject({
      success: true,
      hideDiscountAmount: true,
      sealedDiscountCents: 1500,
      sealedMinSpendCents: 4000,
      confirmedTotalDiscountCents: null,
      needsSubtotal: false,
    });
    expect(from.mock.calls.map((call) => call[0])).not.toContain('boost_arrival_sessions');
    expect(from.mock.calls.map((call) => call[0])).not.toContain('boost_quotes');
    expect(rpc.mock.calls.map((call) => call[0])).not.toContain('record_boost_settlement');
  });

  it('treats a second empty RPC result as already used', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    from.mockImplementation((table: string) => {
      if (table !== 'redemptions') return { select: () => ({}) };
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
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
    const result = await verifyRedemptionTokenForPartner('WB-G6PK2');
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
    await expect(verifyRedemptionTokenForPartner('WB-G6PK2')).resolves.toEqual({
      success: false,
      message: 'Verification failed. Please try again later.',
    });
    expect(reportVerifyIntegrityError).toHaveBeenCalled();
    expect(from.mock.calls.map((call) => call[0])).not.toContain('user_badges');
  });

  it('does not award badges when the RPC raises a duplicate-hash error', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'duplicate issued redemptions for token_hash', code: '23514' },
    });
    const { verifyRedemptionTokenForPartner } = await import('@/app/actions/partner-verify');
    await expect(verifyRedemptionTokenForPartner('WB-G6PK2')).resolves.toEqual({
      success: false,
      message: 'Verification failed. Please try again later.',
    });
    expect(reportVerifyIntegrityError).toHaveBeenCalled();
    expect(from.mock.calls.map((call) => call[0])).not.toContain('user_badges');
  });

  it('reports the wrong restaurant from a read-only lookup', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    from.mockImplementation((table: string) => {
      if (table !== 'redemptions') return { select: () => ({}) };
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
            limit: async () => ({
              data: [issuedRow({ restaurant_id: OTHER_ID })],
              error: null,
            }),
          }),
        }),
      };
    });
    const { verifyRedemptionTokenForPartner } = await import('@/app/actions/partner-verify');
    await expect(verifyRedemptionTokenForPartner('WB-G6PK2')).resolves.toEqual({
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
            maybeSingle: async () => ({ data: null, error: null }),
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
    await expect(verifyRedemptionTokenForPartner('WB-G6PK2')).resolves.toEqual({
      success: false,
      message: 'Code expired',
    });
  });

  it('reports a row already marked expired', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    from.mockImplementation((table: string) => {
      if (table !== 'redemptions') return { select: () => ({}) };
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
            limit: async () => ({
              data: [issuedRow({ status: 'expired' })],
              error: null,
            }),
          }),
        }),
      };
    });
    const { verifyRedemptionTokenForPartner } = await import('@/app/actions/partner-verify');
    await expect(verifyRedemptionTokenForPartner('WB-G6PK2')).resolves.toEqual({
      success: false,
      message: 'Code expired',
    });
    expect(rpc).toHaveBeenCalled();
  });

  it('rejects a rotated token that no longer matches a redemption', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    from.mockImplementation((table: string) => {
      if (table !== 'redemptions') return { select: () => ({}) };
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
            limit: async () => ({ data: [], error: null }),
          }),
        }),
      };
    });
    const { verifyRedemptionTokenForPartner } = await import('@/app/actions/partner-verify');
    await expect(verifyRedemptionTokenForPartner('WB-ZZZZZ')).resolves.toEqual({
      success: false,
      message: PARTNER_CODE_NOT_FOUND_MESSAGE,
    });
  });

  it('hashes the canonical code after the rate limit, and rejects a bad shape before lookup', async () => {
    const { verifyRedemptionTokenForPartner } = await import('@/app/actions/partner-verify');
    await verifyRedemptionTokenForPartner(' wb abcde ');
    expect(enforcePartnerVerifyLimit).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('verify_redemption', {
      p_token_hash: hashRedemptionToken('WB-ABCDE'),
      p_restaurant_id: ACTIVE_ID,
    });
    const limitOrder = enforcePartnerVerifyLimit.mock.invocationCallOrder[0] ?? 0;
    const rpcOrder = rpc.mock.invocationCallOrder[0] ?? 0;
    expect(limitOrder).toBeGreaterThan(0);
    expect(limitOrder).toBeLessThan(rpcOrder);

    rpc.mockClear();
    from.mockClear();
    enforcePartnerVerifyLimit.mockClear();
    for (const junk of ['WB-AB0DE', 'WB-ABODE', 'WB-AB1DE', 'WB-ABIDE', 'ABC', 'WB-ABCDEF']) {
      await expect(verifyRedemptionTokenForPartner(junk)).resolves.toEqual({
        success: false,
        message: PARTNER_CODE_NOT_FOUND_MESSAGE,
      });
    }
    expect(enforcePartnerVerifyLimit).toHaveBeenCalledTimes(6);
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();

    enforcePartnerVerifyLimit.mockResolvedValue('throttled');
    await expect(verifyRedemptionTokenForPartner('0OOOO')).resolves.toEqual({
      success: false,
      message: VERIFY_THROTTLED_MESSAGE,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not settle when the arrival flag is off, even if a quote exists', async () => {
    installVisit({});
    const { verifyRedemptionTokenForPartner } = await import('@/app/actions/partner-verify');
    const result = await verifyRedemptionTokenForPartner('WB-G6PK2');
    expect(result).toMatchObject({
      success: true,
      hideDiscountAmount: true,
      sealedDiscountCents: 1500,
      sealedMinSpendCents: 4000,
      confirmedTotalDiscountCents: null,
      needsSubtotal: false,
    });
    expect(from.mock.calls.map((call) => call[0])).not.toContain('boost_arrival_sessions');
    expect(from.mock.calls.map((call) => call[0])).not.toContain('boost_quotes');
    expect(rpc.mock.calls.map((call) => call[0])).toEqual(['verify_redemption_and_settle']);
  });

  it('writes the consume_quote snapshot once and shows its parts', async () => {
    vi.stubEnv('E07_ARRIVAL_SESSIONS_ENABLED', 'true');
    const installed = installVisit({});
    const { verifyRedemptionTokenForPartner } = await import('@/app/actions/partner-verify');
    const result = await verifyRedemptionTokenForPartner('WB-G6PK2');
    expect(result).toMatchObject({
      success: true,
      hideDiscountAmount: false,
      sealedDiscountCents: 1500,
      sealedMinSpendCents: 4000,
      confirmedTotalDiscountCents: 2500,
      confirmedBaseDiscountCents: 2000,
      confirmedBoostDiscountCents: 500,
      needsSubtotal: false,
      newBadgesEarned: ['First Bite'],
    });
    const record = rpc.mock.calls.find((call) => call[0] === 'record_boost_settlement');
    expect(record?.[1]).toMatchObject({
      p_settlement_kind: 'consume_quote',
      p_settled_at: VERIFIED_AT,
      p_total_discount_cents: 2500,
      p_base_discount_cents: 2000,
      p_boost_discount_cents: 500,
      p_locked_boost_id: 'boost-5',
      p_quote_id: QUOTE,
    });
    expect(installed.events.indexOf('badges')).toBeGreaterThanOrEqual(0);
    expect(installed.events.indexOf('badges')).toBeLessThan(installed.events.indexOf('record'));
    expect(installed.filters).toContainEqual({
      table: 'boost_arrival_sessions',
      column: 'challenge_item_id',
      value: ITEM,
    });
    expect(installed.filters).toContainEqual({
      table: 'boost_arrival_sessions',
      column: 'status',
      value: 'open',
    });
    expect(installed.filters).toContainEqual({
      table: 'boost_quotes',
      column: 'superseded_at',
      value: null,
    });
  });

  it('keeps the first snapshot when the redemption is already settled', async () => {
    vi.stubEnv('E07_ARRIVAL_SESSIONS_ENABLED', 'true');
    installVisit({
      settlementRow: {
        settlement_kind: 'consume_quote',
        settled_at: VERIFIED_AT,
        quote_id: QUOTE,
        quote_version: 2,
        base_discount_cents: 2000,
        boost_discount_cents: 500,
        total_discount_cents: 2500,
        eligible_subtotal_cents: 8200,
        below_minimum: false,
        tier_id: 'threshold:8000',
        boost_id: 'boost-5',
        locked_boost_id: 'boost-5',
        quote_expires_at: EXPIRES,
        sealed_discount_amount_cents: null,
        sealed_min_spend_cents: null,
      },
      quote: quoteRow({ total_discount_cents: 1800, base_discount_cents: 1800, boost_discount_cents: 0 }),
    });
    const { verifyRedemptionTokenForPartner } = await import('@/app/actions/partner-verify');
    const result = await verifyRedemptionTokenForPartner('WB-G6PK2');
    expect(result).toMatchObject({
      success: true,
      confirmedTotalDiscountCents: 2500,
      confirmedBaseDiscountCents: 2000,
      confirmedBoostDiscountCents: 500,
      hideDiscountAmount: false,
    });
    expect(rpc.mock.calls.map((call) => call[0])).not.toContain('record_boost_settlement');
  });

  it('verifies a placeholder quote without writing or showing $0', async () => {
    vi.stubEnv('E07_ARRIVAL_SESSIONS_ENABLED', 'true');
    installVisit({ quote: quoteRow({
      base_discount_cents: 0,
      boost_discount_cents: 0,
      total_discount_cents: 0,
      eligible_subtotal_cents: 0,
      below_minimum: true,
      reasons: ['below_minimum'],
      tier_id: null,
      boost_id: null,
    }) });
    const { verifyRedemptionTokenForPartner } = await import('@/app/actions/partner-verify');
    const result = await verifyRedemptionTokenForPartner('WB-G6PK2');
    expect(result).toMatchObject({
      success: true,
      hideDiscountAmount: true,
      needsSubtotal: true,
      confirmedTotalDiscountCents: null,
      sealedDiscountCents: 1500,
    });
    expect(rpc.mock.calls.map((call) => call[0])).not.toContain('record_boost_settlement');
  });

  it('verifies a past deadline without writing a snapshot', async () => {
    vi.stubEnv('E07_ARRIVAL_SESSIONS_ENABLED', 'true');
    installVisit({ deadline: '2020-01-01T00:00:00.000Z' });
    const { verifyRedemptionTokenForPartner } = await import('@/app/actions/partner-verify');
    const result = await verifyRedemptionTokenForPartner('WB-G6PK2');
    expect(result).toMatchObject({
      success: true,
      hideDiscountAmount: true,
      needsSubtotal: false,
      confirmedTotalDiscountCents: null,
    });
    expect(rpc.mock.calls.map((call) => call[0])).not.toContain('record_boost_settlement');
  });

  it('stores a sealed snapshot and still hides the amount when there is no session', async () => {
    vi.stubEnv('E07_ARRIVAL_SESSIONS_ENABLED', 'true');
    installVisit({ session: null });
    const { verifyRedemptionTokenForPartner } = await import('@/app/actions/partner-verify');
    const result = await verifyRedemptionTokenForPartner('WB-G6PK2');
    expect(result).toMatchObject({
      success: true,
      hideDiscountAmount: true,
      confirmedTotalDiscountCents: null,
      sealedDiscountCents: 1500,
      sealedMinSpendCents: 4000,
    });
    const record = rpc.mock.calls.find((call) => call[0] === 'record_boost_settlement');
    expect(record?.[1]).toMatchObject({
      p_settlement_kind: 'use_sealed_base',
      p_sealed_discount_amount_cents: 1500,
      p_sealed_min_spend_cents: 4000,
    });
  });

  it('still verifies and keeps awarded badges when settlement persistence is unavailable', async () => {
    vi.stubEnv('E07_ARRIVAL_SESSIONS_ENABLED', 'true');
    const installed = installVisit({ recordError: true });
    const { verifyRedemptionTokenForPartner } = await import('@/app/actions/partner-verify');
    const result = await verifyRedemptionTokenForPartner('WB-G6PK2');
    expect(result).toMatchObject({
      success: true,
      newBadgesEarned: ['First Bite'],
      hideDiscountAmount: true,
      confirmedTotalDiscountCents: null,
    });
    expect(installed.events).toEqual(['badges', 'record']);
  });

  it('does not call the ledger when the flag is unset or any value other than true', async () => {
    const { verifyRedemptionTokenForPartner } = await import('@/app/actions/partner-verify');
    installClaimed();
    const baseline = await verifyRedemptionTokenForPartner('WB-G6PK2');
    expect(ledgerCalls()).toEqual([]);

    for (const value of ['', 'TRUE', 'True', '1']) {
      rpc.mockClear();
      process.env.E09_PROGRESSION_LEDGER_ENABLED = value;
      installClaimed();
      await expect(verifyRedemptionTokenForPartner('WB-G6PK2')).resolves.toEqual(baseline);
      expect(ledgerCalls()).toEqual([]);
    }
  });

  it('records one inserted visit after badges and leaves the verify response unchanged', async () => {
    const { verifyRedemptionTokenForPartner } = await import('@/app/actions/partner-verify');
    installClaimed();
    const baseline = await verifyRedemptionTokenForPartner('WB-G6PK2');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      rpc.mockClear();
      captureException.mockClear();
      process.env.E09_PROGRESSION_LEDGER_ENABLED = 'true';
      const installed = installClaimed({ ledger: 'recorded' });
      await expect(verifyRedemptionTokenForPartner('WB-G6PK2')).resolves.toEqual(baseline);
      expect(ledgerCalls()).toEqual([
        ['record_verified_visit_progress', { p_redemption_id: 'redemption-1' }],
      ]);
      expect(installed.order.indexOf('badges')).toBeGreaterThanOrEqual(0);
      expect(installed.order.indexOf('badges')).toBeLessThan(installed.order.indexOf('ledger'));
      expect(errorSpy).not.toHaveBeenCalled();
      expect(captureException).not.toHaveBeenCalled();
      expect(Object.keys(baseline).sort()).toEqual([
        'confirmedBaseDiscountCents',
        'confirmedBoostDiscountCents',
        'confirmedTotalDiscountCents',
        'hideDiscountAmount',
        'needsSubtotal',
        'newBadgesEarned',
        'redemptionDetails',
        'sealedDiscountCents',
        'sealedMinSpendCents',
        'success',
      ]);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('treats an empty ledger payload as a replay and does nothing else', async () => {
    const { verifyRedemptionTokenForPartner } = await import('@/app/actions/partner-verify');
    installClaimed();
    const baseline = await verifyRedemptionTokenForPartner('WB-G6PK2');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      rpc.mockClear();
      process.env.E09_PROGRESSION_LEDGER_ENABLED = 'true';
      installClaimed({ ledger: 'replay' });
      await expect(verifyRedemptionTokenForPartner('WB-G6PK2')).resolves.toEqual(baseline);
      expect(ledgerCalls()).toHaveLength(1);
      expect(errorSpy).not.toHaveBeenCalled();
      expect(captureException).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('keeps the verify response when the ledger errors, throws, returns null, or is malformed', async () => {
    const { verifyRedemptionTokenForPartner } = await import('@/app/actions/partner-verify');
    installClaimed();
    const baseline = await verifyRedemptionTokenForPartner('WB-G6PK2');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      process.env.E09_PROGRESSION_LEDGER_ENABLED = 'true';
      for (const mode of ['error', 'throw', 'null', 'malformed'] as const) {
        rpc.mockClear();
        captureException.mockClear();
        errorSpy.mockClear();
        installClaimed({ ledger: mode });
        await expect(verifyRedemptionTokenForPartner('WB-G6PK2')).resolves.toEqual(baseline);
        expect(ledgerCalls()).toHaveLength(1);
        expect(errorSpy.mock.calls).toEqual([['progression ledger record failed']]);
        expect(captureException).toHaveBeenCalledTimes(1);
        const reported = captureException.mock.calls[0]?.[0];
        expect(reported).toBeInstanceOf(Error);
        expect((reported as Error).message).toBe('progression ledger record failed');
        const logged = JSON.stringify(errorSpy.mock.calls) + (reported as Error).message;
        expect(logged).not.toContain(USER_ID);
        expect(logged).not.toContain('WB-G6PK2');
        expect(logged).not.toContain('a@b.c');
        expect(logged).not.toContain('redemption-1');
      }
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('does not record progress when verify fails or claims no row', async () => {
    process.env.E09_PROGRESSION_LEDGER_ENABLED = 'true';
    const { verifyRedemptionTokenForPartner } = await import('@/app/actions/partner-verify');

    requirePartnerSession.mockResolvedValue({ ok: false });
    await verifyRedemptionTokenForPartner('WB-G6PK2');
    expect(ledgerCalls()).toEqual([]);

    requirePartnerSession.mockResolvedValue({
      ok: true,
      restaurantId: ACTIVE_ID,
      restaurantName: 'Active Grill',
      tokenHash: 'session-hash',
    });
    enforcePartnerVerifyLimit.mockResolvedValue('throttled');
    await verifyRedemptionTokenForPartner('WB-G6PK2');
    expect(ledgerCalls()).toEqual([]);

    enforcePartnerVerifyLimit.mockResolvedValue('unavailable');
    await verifyRedemptionTokenForPartner('WB-G6PK2');
    expect(ledgerCalls()).toEqual([]);

    enforcePartnerVerifyLimit.mockResolvedValue('allow');
    await verifyRedemptionTokenForPartner('   ');
    expect(ledgerCalls()).toEqual([]);

    rpc.mockResolvedValue({
      data: null,
      error: { message: 'duplicate issued redemptions for token_hash', code: '23514' },
    });
    await verifyRedemptionTokenForPartner('WB-G6PK2');
    expect(ledgerCalls()).toEqual([]);

    rpc.mockResolvedValue({ data: null, error: { message: 'connection reset' } });
    await verifyRedemptionTokenForPartner('WB-G6PK2');
    expect(ledgerCalls()).toEqual([]);

    rpc.mockResolvedValue({
      data: [
        issuedRow({ id: 'r1', user_id: USER_ID, status: 'verified' }),
        issuedRow({ id: 'r2', user_id: USER_ID, status: 'verified' }),
      ],
      error: null,
    });
    await verifyRedemptionTokenForPartner('WB-G6PK2');
    expect(ledgerCalls()).toEqual([]);

    installClaimed({ userId: null });
    await expect(verifyRedemptionTokenForPartner('WB-G6PK2')).resolves.toEqual({
      success: false,
      message: 'Verification failed. Please try again later.',
    });
    expect(ledgerCalls()).toEqual([]);

    installClaimed({ id: '' });
    const missingId = await verifyRedemptionTokenForPartner('WB-G6PK2');
    expect(missingId.success).toBe(true);
    expect(ledgerCalls()).toEqual([]);

    rpc.mockResolvedValue({ data: [], error: null });
    from.mockImplementation((table: string) => {
      if (table !== 'redemptions') return { select: () => ({}) };
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
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
    const alreadyUsed = await verifyRedemptionTokenForPartner('WB-G6PK2');
    expect(alreadyUsed.success).toBe(false);
    expect(ledgerCalls()).toEqual([]);

    from.mockImplementation((table: string) => {
      if (table !== 'redemptions') return { select: () => ({}) };
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
            limit: async () => ({
              data: [issuedRow({ restaurant_id: OTHER_ID })],
              error: null,
            }),
          }),
        }),
      };
    });
    await verifyRedemptionTokenForPartner('WB-G6PK2');
    expect(ledgerCalls()).toEqual([]);

    from.mockImplementation((table: string) => {
      if (table !== 'redemptions') return { select: () => ({}) };
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
            limit: async () => ({
              data: [issuedRow({ status: 'expired' })],
              error: null,
            }),
          }),
        }),
      };
    });
    await verifyRedemptionTokenForPartner('WB-G6PK2');
    expect(ledgerCalls()).toEqual([]);

    from.mockImplementation((table: string) => {
      if (table !== 'redemptions') return { select: () => ({}) };
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
            limit: async () => ({ data: [], error: null }),
          }),
        }),
      };
    });
    await verifyRedemptionTokenForPartner('WB-G6PK2');
    expect(ledgerCalls()).toEqual([]);
  });

  it('settles Boost before recording the visit and keeps that response', async () => {
    const { verifyRedemptionTokenForPartner } = await import('@/app/actions/partner-verify');
    vi.stubEnv('E07_ARRIVAL_SESSIONS_ENABLED', 'true');
    installVisit({});
    const baseline = await verifyRedemptionTokenForPartner('WB-G6PK2');
    rpc.mockClear();
    vi.stubEnv('E09_PROGRESSION_LEDGER_ENABLED', 'true');
    const installed = installVisit({ ledger: 'recorded' });
    await expect(verifyRedemptionTokenForPartner('WB-G6PK2')).resolves.toEqual(baseline);
    expect(installed.events).toEqual(['badges', 'record', 'ledger']);
    expect(ledgerCalls()).toEqual([
      ['record_verified_visit_progress', { p_redemption_id: 'redemption-1' }],
    ]);
  });
});

function quoteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: QUOTE,
    session_id: SESSION,
    quote_version: 2,
    offer_version_id: VERSION,
    tier_id: 'threshold:8000',
    base_discount_cents: 2000,
    boost_id: 'boost-5',
    boost_discount_cents: 500,
    total_discount_cents: 2500,
    eligible_subtotal_cents: 8200,
    below_minimum: false,
    reasons: ['quoted', 'boost_applied'],
    expires_at: EXPIRES,
    superseded_at: null,
    ...overrides,
  };
}

function sessionRow() {
  return {
    id: SESSION,
    restaurant_id: ACTIVE_ID,
    challenge_item_id: ITEM,
    offer_version_id: VERSION,
    redemption_id: null,
    locked_boost_id: 'boost-5',
    arrival_at: '2026-11-08T17:00:00.000Z',
    expires_at: EXPIRES,
    idempotency_key: `e07-member-geo:${ITEM}`,
    status: 'open',
  };
}

function chain(table: string, result: QueryResult, filters: Array<{ table: string; column: string; value: unknown }>) {
  const builder = {
    select() {
      return builder;
    },
    eq(column: string, value: unknown) {
      filters.push({ table, column, value });
      return builder;
    },
    is(column: string, value: unknown) {
      filters.push({ table, column, value });
      return builder;
    },
    in() {
      return Promise.resolve(result);
    },
    limit() {
      return Promise.resolve(result);
    },
    maybeSingle() {
      return Promise.resolve(result);
    },
    then(resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return builder;
}

type LedgerMode = 'recorded' | 'replay' | 'null' | 'malformed' | 'error' | 'throw';

function ledgerCalls(): unknown[][] {
  return rpc.mock.calls.filter((call) => call[0] === 'record_verified_visit_progress');
}

function ledgerResponse(mode: LedgerMode = 'recorded') {
  if (mode === 'throw') return Promise.reject(new Error(`timeout ${USER_ID} WB-G6PK2 a@b.c`));
  if (mode === 'error') {
    return Promise.resolve({
      data: null,
      error: { message: `missing function ${USER_ID} WB-G6PK2 a@b.c redemption-1` },
    });
  }
  if (mode === 'null') return Promise.resolve({ data: null, error: null });
  if (mode === 'malformed') return Promise.resolve({ data: { events: [] }, error: null });
  if (mode === 'replay') {
    return Promise.resolve({ data: { events: [], milestones: [], entries: [] }, error: null });
  }
  return Promise.resolve({
    data: {
      events: [{ id: 'event-1' }],
      milestones: [{ id: 'milestone-1' }],
      entries: [{ id: 'entry-1' }],
    },
    error: null,
  });
}

function installClaimed(options: { ledger?: LedgerMode; id?: string; userId?: string | null } = {}) {
  const order: string[] = [];
  const row = issuedRow({
    status: 'verified',
    verified_at: VERIFIED_AT,
    id: options.id === undefined ? 'redemption-1' : options.id,
    user_id: options.userId === undefined ? USER_ID : options.userId,
  });
  rpc.mockImplementation((fn: string) => {
    if (fn === 'record_verified_visit_progress') {
      order.push('ledger');
      return ledgerResponse(options.ledger);
    }
    order.push(fn);
    return Promise.resolve({ data: [row], error: null });
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
            maybeSingle: async () => ({ data: null, error: null }),
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
        upsert: async () => {
          order.push('badges');
          return { error: null };
        },
      };
    }
    return { select: () => ({}) };
  });
  return { order };
}

function installVisit(options: {
  throwOnArrival?: boolean;
  session?: Record<string, unknown> | null;
  quote?: Record<string, unknown> | null;
  settlementRow?: Record<string, unknown> | null;
  recordError?: boolean;
  deadline?: string;
  ledger?: LedgerMode;
}) {
  const filters: Array<{ table: string; column: string; value: unknown }> = [];
  const events: string[] = [];
  const deadline = options.deadline ?? '2026-12-31T00:00:00.000Z';
  const item = {
    id: ITEM,
    restaurant_id: ACTIVE_ID,
    status: 'assigned',
    offer_version_id: VERSION,
    redemption_deadline: deadline,
  };
  rpc.mockImplementation((fn: string, args: Record<string, unknown>) => {
    if (fn === 'record_verified_visit_progress') {
      events.push('ledger');
      return ledgerResponse(options.ledger);
    }
    if (fn === 'record_boost_settlement') {
      events.push('record');
      if (options.recordError) return Promise.resolve({ data: null, error: { message: 'missing function' } });
      return Promise.resolve({
        data: {
          status: 'created',
          snapshot: {
            settlement_kind: args.p_settlement_kind,
            settled_at: args.p_settled_at,
            quote_id: args.p_quote_id,
            quote_version: args.p_quote_version,
            base_discount_cents: args.p_base_discount_cents,
            boost_discount_cents: args.p_boost_discount_cents,
            total_discount_cents: args.p_total_discount_cents,
            eligible_subtotal_cents: args.p_eligible_subtotal_cents,
            below_minimum: args.p_below_minimum,
            tier_id: args.p_tier_id,
            boost_id: args.p_boost_id,
            locked_boost_id: args.p_locked_boost_id,
            quote_expires_at: args.p_quote_expires_at,
            sealed_discount_amount_cents: args.p_sealed_discount_amount_cents,
            sealed_min_spend_cents: args.p_sealed_min_spend_cents,
          },
        },
        error: null,
      });
    }
    return Promise.resolve({
      data: [issuedRow({ status: 'verified', verified_at: VERIFIED_AT, challenge_item_id: ITEM, id: 'redemption-1' })],
      error: null,
    });
  });
  from.mockImplementation((table: string) => {
    if (options.throwOnArrival && (table === 'boost_arrival_sessions' || table === 'boost_quotes')) {
      throw new Error(`unexpected ${table}`);
    }
    const resultFor = (): QueryResult => {
      if (table === 'challenge_items') return { data: item, error: null };
      if (table === 'offer_versions') {
        return { data: { tiers: [{ threshold_cents: 4000, discount_cents: 1500 }] }, error: null };
      }
      if (table === 'user_profiles') return { data: { email: 'a@b.c' }, error: null };
      if (table === 'restaurants') return { data: { name: 'Active Grill' }, error: null };
      if (table === 'boost_arrival_sessions') {
        return { data: options.session === undefined ? sessionRow() : options.session, error: null };
      }
      if (table === 'boost_quotes') return { data: options.quote === undefined ? quoteRow() : options.quote, error: null };
      return { data: null, error: null };
    };
    if (table === 'user_badges') {
      return {
        select: () => chain(table, { data: [], error: null }, filters),
        upsert: async () => {
          events.push('badges');
          return { error: null };
        },
      };
    }
    if (table === 'redemptions') {
      return {
        select: (columns: string) => {
          if (columns === '*') return chain(table, { data: null, error: null, count: 1 }, filters);
          if (columns.includes('settlement_kind')) {
            return chain(table, { data: options.settlementRow ?? null, error: null }, filters);
          }
          return chain(table, { data: { challenge_item_id: ITEM }, error: null }, filters);
        },
      };
    }
    return { select: () => chain(table, resultFor(), filters) };
  });
  return { filters, events };
}
