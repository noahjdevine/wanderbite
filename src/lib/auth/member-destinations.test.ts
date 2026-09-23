import { describe, expect, it } from 'vitest';
import {
  ordinarySignInPath,
  profileGate,
  settleMemberPath,
} from '@/lib/auth/member-destinations';

const complete = {
  username: 'member',
  address_street: '1 Main St',
  address_city: 'McKinney',
  address_state: 'TX',
  address_zip: '75070',
};

const incomplete = {
  username: null,
  address_street: null,
  address_city: null,
  address_state: null,
  address_zip: null,
};

describe('member destination redirects', () => {
  it('sends an active incomplete admin to account from sign-in and direct visits', () => {
    const admin = profileGate({
      role: 'admin',
      subscription_status: 'active',
      ...incomplete,
    });

    expect(ordinarySignInPath(admin)).toBe('/account');
    for (const start of ['/signin', '/profile', '/account', '/challenges', '/onboarding']) {
      const path = start === '/signin' ? ordinarySignInPath(admin) : start;
      expect(settleMemberPath(path, admin)).toBe('/account');
    }
  });

  it('checks admin before the active-subscription hop on onboarding', () => {
    const admin = profileGate({
      role: 'admin',
      subscription_status: 'active',
      ...complete,
    });
    expect(settleMemberPath('/onboarding', admin)).toBe('/account');
  });

  it('keeps ordinary member destinations', () => {
    expect(ordinarySignInPath(profileGate(null))).toBe('/onboarding');

    const inactive = profileGate({
      role: 'subscriber',
      subscription_status: 'inactive',
      ...complete,
    });
    expect(ordinarySignInPath(inactive)).toBe('/pricing');
    expect(settleMemberPath('/challenges', inactive)).toBe('/pricing');

    const active = profileGate({
      role: 'subscriber',
      subscription_status: 'active',
      ...complete,
    });
    expect(ordinarySignInPath(active)).toBe('/challenges');
    expect(settleMemberPath('/challenges', active)).toBe('/challenges');
    expect(settleMemberPath('/onboarding', active)).toBe('/challenges');
    expect(settleMemberPath('/account', active)).toBe('/account');
    expect(settleMemberPath('/profile', active)).toBe('/account');
  });

  it('leaves the active incomplete member loop unchanged', () => {
    const member = profileGate({
      role: 'subscriber',
      subscription_status: 'active',
      ...incomplete,
    });
    expect(() => settleMemberPath('/challenges', member)).toThrow(/redirect loop/);
  });
});
