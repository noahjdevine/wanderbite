import { describe, expect, it } from 'vitest';
import {
  resolveSignInDestination,
  SIGN_IN_PROFILE_ERROR,
  signInFieldErrors,
} from '@/lib/auth/sign-in-destination';

const complete = {
  role: 'member',
  subscription_status: 'active',
  username: 'member',
  address_street: '1 Main St',
  address_city: 'McKinney',
  address_state: 'TX',
  address_zip: '75070',
};

const incompleteAdmin = {
  role: 'admin',
  subscription_status: 'active',
  username: null,
  address_street: null,
  address_city: null,
  address_state: null,
  address_zip: null,
};

describe('resolveSignInDestination', () => {
  it('rechecks an explicit redirect and ignores the profile gate', () => {
    expect(
      resolveSignInDestination({
        redirectTo: '/challenges',
        profileError: false,
        profile: null,
      }),
    ).toEqual({ ok: true, path: '/challenges' });
  });

  it('sends an unsafe explicit redirect to /dashboard', () => {
    expect(
      resolveSignInDestination({
        redirectTo: 'https://evil.example/phish',
        profileError: true,
        profile: null,
      }),
    ).toEqual({ ok: true, path: '/dashboard' });
  });

  it('uses the profile gate when redirectTo is absent', () => {
    expect(
      resolveSignInDestination({
        redirectTo: null,
        profileError: false,
        profile: null,
      }),
    ).toEqual({ ok: true, path: '/onboarding' });
    expect(
      resolveSignInDestination({
        redirectTo: '   ',
        profileError: false,
        profile: incompleteAdmin,
      }),
    ).toEqual({ ok: true, path: '/account' });
    expect(
      resolveSignInDestination({
        redirectTo: null,
        profileError: false,
        profile: complete,
      }),
    ).toEqual({ ok: true, path: '/challenges' });
    expect(
      resolveSignInDestination({
        redirectTo: null,
        profileError: false,
        profile: { ...complete, subscription_status: 'inactive' },
      }),
    ).toEqual({ ok: true, path: '/pricing' });
  });

  it('stays on the page when the profile read fails and no redirect was submitted', () => {
    expect(
      resolveSignInDestination({
        redirectTo: null,
        profileError: true,
        profile: null,
      }),
    ).toEqual({ ok: false, error: SIGN_IN_PROFILE_ERROR });
  });
});

describe('signInFieldErrors', () => {
  it('requires an email and a password', () => {
    expect(signInFieldErrors('', '')).toEqual({
      email: 'Enter your email.',
      password: 'Enter your password.',
    });
    expect(signInFieldErrors('not-an-email', 'secret')).toEqual({
      email: "That doesn't look like a valid email.",
    });
    expect(signInFieldErrors('user@example.com', 'secret')).toBeNull();
  });
});
