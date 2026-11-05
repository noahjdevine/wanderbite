import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OnboardingPage from './page';

const getUser = vi.hoisted(() => vi.fn());
const attestation = vi.hoisted(() => vi.fn());
const tables = vi.hoisted(() => ({
  current: {} as Record<string, { data: unknown; error: { message: string } | null }>,
}));
const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
);

vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirect(url),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser },
  }),
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () =>
          Promise.resolve(tables.current[table] ?? { data: null, error: null }),
      };
      return chain;
    },
  }),
}));

vi.mock('@/lib/legal-attestation-status', () => ({
  hasCurrentLegalAttestation: (...args: unknown[]) => attestation(...args),
}));

vi.mock('@/components/auth/account-changed-notice', () => ({
  useAccountChanged: () => 'ready',
  AccountChangedNotice: () => null,
}));

vi.mock('@/app/actions/check-username', () => ({
  checkUsername: vi.fn(async () => ({ ok: true, status: 'unchanged' as const })),
}));

function profile(overrides?: Record<string, unknown>) {
  return {
    id: 'user-1',
    email: 'member@example.com',
    role: 'subscriber',
    subscription_status: 'inactive',
    dietary_flags: [],
    distance_band: '15_mi',
    wants_cocktail_experience: false,
    username: 'member',
    address: null,
    address_street: '123 Main St',
    address_city: 'McKinney',
    address_state: 'TX',
    address_zip: '75071',
    ...overrides,
  };
}

beforeEach(() => {
  getUser.mockReset();
  attestation.mockReset();
  redirect.mockClear();
  tables.current = {};
  attestation.mockResolvedValue(false);
});

afterEach(() => cleanup());

describe('onboarding page gate', () => {
  it('sends a signed-out visitor to the existing sign-in redirect', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(OnboardingPage()).rejects.toThrow('REDIRECT:/signin?redirectTo=/onboarding');
  });

  it('sends an active member to /challenges, including with an unfinished profile', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'member@example.com' } } });
    tables.current = {
      user_profiles: {
        data: profile({
          subscription_status: 'active',
          username: '',
          address_street: '',
          address_city: '',
          address_state: '',
          address_zip: '',
        }),
        error: null,
      },
      user_preferences: { data: null, error: null },
    };
    await expect(OnboardingPage()).rejects.toThrow('REDIRECT:/challenges');
  });

  it('sends an admin with a profile to /account', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'member@example.com' } } });
    tables.current = {
      user_profiles: { data: profile({ role: 'admin' }), error: null },
      user_preferences: { data: null, error: null },
    };
    await expect(OnboardingPage()).rejects.toThrow('REDIRECT:/account');
  });

  it('renders step 1 for a signed-in member with no profile row', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'member@example.com' } } });
    tables.current = {
      user_profiles: { data: null, error: null },
      user_preferences: { data: null, error: null },
    };
    render(await OnboardingPage());
    expect(redirect).not.toHaveBeenCalled();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Tell us what you love' })).toBeTruthy();
  });

  it('keeps the load-error sentence', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'member@example.com' } } });
    tables.current = {
      user_profiles: { data: null, error: { message: 'db down' } },
    };
    render(await OnboardingPage());
    expect(screen.getByRole('alert').textContent).toBe(
      'Unable to load your profile right now. Please try again.',
    );
    expect(redirect).not.toHaveBeenCalled();
  });
});
