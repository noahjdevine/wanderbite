import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LEGAL_ATTESTATION_REQUIRED_MESSAGE } from '@/lib/legal-attestation';

const requireUser = vi.fn();
const checkoutSessionsCreate = vi.fn();
const billingPortalSessionsCreate = vi.fn();
const from = vi.fn();

vi.mock('@/lib/auth/require-user', () => ({
  requireUser: (...args: unknown[]) => requireUser(...args),
}));

vi.mock('@/lib/stripe', () => ({
  getStripe: () => ({
    checkout: { sessions: { create: checkoutSessionsCreate } },
    billingPortal: { sessions: { create: billingPortalSessionsCreate } },
  }),
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ from }),
}));

function stubCheckoutEnv() {
  vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://wanderbite.com');
  vi.stubEnv('STRIPE_PRICE_ID', 'price_dummy');
}

function queryResult(data: unknown, error: { message: string } | null = null) {
  const node = {
    eq: () => node,
    maybeSingle: async () => ({ data, error }),
  };
  return { select: () => node };
}

function mockCheckoutTables(options: {
  profile: unknown;
  attestation?: unknown;
  attestationError?: { message: string } | null;
}) {
  from.mockImplementation((table: string) => {
    if (table === 'user_profiles') return queryResult(options.profile);
    if (table === 'legal_attestations') {
      return queryResult(options.attestation ?? null, options.attestationError ?? null);
    }
    throw new Error(`unexpected table ${table}`);
  });
}

describe('createCheckoutSession (G0 freeze)', () => {
  beforeEach(() => {
    vi.resetModules();
    requireUser.mockReset();
    checkoutSessionsCreate.mockReset();
    billingPortalSessionsCreate.mockReset();
    from.mockReset();
    stubCheckoutEnv();
    vi.stubEnv('CHECKOUT_ENABLED', '');
    delete process.env.CHECKOUT_ENABLED;
  });

  it('refuses when CHECKOUT_ENABLED is unset', async () => {
    vi.stubEnv('CHECKOUT_ENABLED', '');
    delete process.env.CHECKOUT_ENABLED;
    expect(process.env.CHECKOUT_ENABLED).toBeUndefined();

    const { createCheckoutSession } = await import('./stripe');
    const result = await createCheckoutSession();
    expect(result).toEqual({ ok: false, error: 'Checkout is unavailable.' });
    expect(requireUser).not.toHaveBeenCalled();
    expect(checkoutSessionsCreate).not.toHaveBeenCalled();
  });

  it.each(['', 'false', '1', 'TRUE', 'true '])(
    'refuses when CHECKOUT_ENABLED is %j, even if an attestation row would exist',
    async (value) => {
      vi.stubEnv('CHECKOUT_ENABLED', value);
      from.mockImplementation(() => {
        throw new Error('checkout must not read the database while the flag is off');
      });
      const { createCheckoutSession } = await import('./stripe');
      const result = await createCheckoutSession();
      expect(result).toEqual({ ok: false, error: 'Checkout is unavailable.' });
      expect(requireUser).not.toHaveBeenCalled();
      expect(from).not.toHaveBeenCalled();
      expect(checkoutSessionsCreate).not.toHaveBeenCalled();
    },
  );

  it('creates a session only when CHECKOUT_ENABLED is exactly true, the address is in the launch area, and the current attestation exists', async () => {
    vi.stubEnv('CHECKOUT_ENABLED', 'true');
    requireUser.mockResolvedValue({
      ok: true,
      userId: 'user-1',
      email: 'member@example.com',
    });
    mockCheckoutTables({
      profile: { address_state: 'TX', address_zip: '75070' },
      attestation: { user_id: 'user-1' },
    });
    checkoutSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/test' });
    const { createCheckoutSession } = await import('./stripe');
    const result = await createCheckoutSession();
    expect(result).toEqual({ ok: true, url: 'https://checkout.stripe.com/test' });
    expect(from.mock.calls.map((call) => call[0])).toEqual([
      'user_profiles',
      'legal_attestations',
    ]);
    expect(checkoutSessionsCreate).toHaveBeenCalledTimes(1);
    expect(checkoutSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        client_reference_id: 'user-1',
        metadata: { userId: 'user-1' },
        subscription_data: { metadata: { userId: 'user-1' } },
      }),
    );
  });

  it('refuses ineligible addresses before calling Stripe or reading attestation', async () => {
    vi.stubEnv('CHECKOUT_ENABLED', 'true');
    requireUser.mockResolvedValue({
      ok: true,
      userId: 'user-1',
      email: 'member@example.com',
    });
    mockCheckoutTables({
      profile: { address_state: 'TX', address_zip: '78731' },
      attestation: { user_id: 'user-1' },
    });
    const { createCheckoutSession } = await import('./stripe');
    const result = await createCheckoutSession();
    expect(result).toEqual({
      ok: false,
      error: 'Wanderbite is not available at this address yet.',
    });
    expect(from.mock.calls.map((call) => call[0])).toEqual(['user_profiles']);
    expect(checkoutSessionsCreate).not.toHaveBeenCalled();
  });

  it('does not call Stripe when the current attestation row is missing', async () => {
    vi.stubEnv('CHECKOUT_ENABLED', 'true');
    requireUser.mockResolvedValue({
      ok: true,
      userId: 'user-1',
      email: 'member@example.com',
    });
    mockCheckoutTables({
      profile: { address_state: 'TX', address_zip: '75070' },
      attestation: null,
    });
    const { createCheckoutSession } = await import('./stripe');
    const result = await createCheckoutSession();
    expect(result).toEqual({ ok: false, error: LEGAL_ATTESTATION_REQUIRED_MESSAGE });
    expect(checkoutSessionsCreate).not.toHaveBeenCalled();
  });

  it('does not call Stripe when the attestation lookup errors', async () => {
    vi.stubEnv('CHECKOUT_ENABLED', 'true');
    requireUser.mockResolvedValue({
      ok: true,
      userId: 'user-1',
      email: 'member@example.com',
    });
    mockCheckoutTables({
      profile: { address_state: 'TX', address_zip: '75070' },
      attestationError: { message: 'connection refused' },
    });
    const { createCheckoutSession } = await import('./stripe');
    const result = await createCheckoutSession();
    expect(result).toEqual({ ok: false, error: LEGAL_ATTESTATION_REQUIRED_MESSAGE });
    expect(checkoutSessionsCreate).not.toHaveBeenCalled();
  });
});

describe('createBillingPortalSession (G0 freeze)', () => {
  beforeEach(() => {
    vi.resetModules();
    requireUser.mockReset();
    billingPortalSessionsCreate.mockReset();
    from.mockReset();
    stubCheckoutEnv();
    vi.stubEnv('CHECKOUT_ENABLED', '');
    delete process.env.CHECKOUT_ENABLED;
  });

  it('still opens the Customer Portal when checkout is frozen', async () => {
    requireUser.mockResolvedValue({
      ok: true,
      userId: 'user-1',
      email: 'member@example.com',
    });
    from.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { stripe_customer_id: 'cus_test' },
            error: null,
          }),
        }),
      }),
    });
    billingPortalSessionsCreate.mockResolvedValue({
      url: 'https://billing.stripe.com/test',
    });

    const { createBillingPortalSession } = await import('./stripe');
    const result = await createBillingPortalSession();
    expect(result).toEqual({ ok: true, url: 'https://billing.stripe.com/test' });
    expect(billingPortalSessionsCreate).toHaveBeenCalledTimes(1);
  });
});
