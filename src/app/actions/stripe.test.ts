import { describe, it, expect, vi, beforeEach } from 'vitest';

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

  it.each(['false', '1', 'TRUE', 'true '])(
    'refuses when CHECKOUT_ENABLED is %j',
    async (value) => {
      vi.stubEnv('CHECKOUT_ENABLED', value);
      const { createCheckoutSession } = await import('./stripe');
      const result = await createCheckoutSession();
      expect(result).toEqual({ ok: false, error: 'Checkout is unavailable.' });
      expect(requireUser).not.toHaveBeenCalled();
      expect(checkoutSessionsCreate).not.toHaveBeenCalled();
    },
  );

  it('creates a session only when CHECKOUT_ENABLED is exactly true', async () => {
    vi.stubEnv('CHECKOUT_ENABLED', 'true');
    requireUser.mockResolvedValue({
      ok: true,
      userId: 'user-1',
      email: 'member@example.com',
    });
    checkoutSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/test' });
    const { createCheckoutSession } = await import('./stripe');
    const result = await createCheckoutSession();
    expect(result).toEqual({ ok: true, url: 'https://checkout.stripe.com/test' });
    expect(checkoutSessionsCreate).toHaveBeenCalledTimes(1);
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
