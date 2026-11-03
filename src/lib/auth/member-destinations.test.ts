import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  nextMemberRedirect,
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

  it('sends incomplete admins from challenges and dashboard to account before subscription', () => {
    for (const subscriptionStatus of ['active', 'inactive']) {
      const admin = profileGate({
        role: 'admin',
        subscription_status: subscriptionStatus,
        ...incomplete,
      });
      expect(nextMemberRedirect('/challenges', admin)).toBe('/account');
      expect(nextMemberRedirect('/dashboard', admin)).toBe('/account');
      expect(settleMemberPath('/challenges', admin)).toBe('/account');
      expect(settleMemberPath('/dashboard', admin)).toBe('/account');
    }
  });

  it('loads role on challenges and dashboard and passes it to the gate', () => {
    const root = path.resolve(__dirname, '../../..');
    for (const rel of ['src/app/(site)/challenges/page.tsx', 'src/app/(site)/dashboard/page.tsx']) {
      const src = readFileSync(path.join(root, rel), 'utf8');
      expect(src, rel).toMatch(/\.select\([^)]*role/);
      expect(src, rel).toMatch(/profileGate\(\{[\s\S]*role:\s*typedProfile\.role/);
    }
  });

  it('checks admin before the active-subscription hop on onboarding', () => {
    const admin = profileGate({
      role: 'admin',
      subscription_status: 'active',
      ...complete,
    });
    expect(settleMemberPath('/onboarding', admin)).toBe('/account');
    expect(nextMemberRedirect('/challenges', admin)).toBeNull();
    expect(nextMemberRedirect('/dashboard', admin)).toBeNull();
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

    const inactiveIncomplete = profileGate({
      role: 'subscriber',
      subscription_status: 'inactive',
      ...incomplete,
    });
    expect(ordinarySignInPath(inactiveIncomplete)).toBe('/pricing');

    const active = profileGate({
      role: 'subscriber',
      subscription_status: 'active',
      ...complete,
    });
    expect(ordinarySignInPath(active)).toBe('/challenges');
    expect(settleMemberPath('/challenges', active)).toBe('/challenges');
    expect(settleMemberPath('/dashboard', active)).toBe('/dashboard');
    expect(settleMemberPath('/onboarding', active)).toBe('/challenges');
    expect(settleMemberPath('/account', active)).toBe('/account');
    expect(settleMemberPath('/profile', active)).toBe('/account');
  });

  it('sends an active incomplete member to challenges instead of onboarding', () => {
    const member = profileGate({
      role: 'subscriber',
      subscription_status: 'active',
      ...incomplete,
    });
    expect(ordinarySignInPath(member)).toBe('/challenges');
    for (const start of ['/signin', '/challenges', '/dashboard', '/onboarding']) {
      const path = start === '/signin' ? ordinarySignInPath(member) : start;
      expect(settleMemberPath(path, member)).toBe('/challenges');
    }
    // /account stays so the challenges notice can link here without a loop.
    expect(settleMemberPath('/account', member)).toBe('/account');
    expect(settleMemberPath('/profile', member)).toBe('/account');
    expect(nextMemberRedirect('/onboarding', member)).toBe('/challenges');
    expect(nextMemberRedirect('/challenges', member)).toBeNull();
  });

  it('treats a strict legacy address as complete when structured columns are blank', () => {
    const gate = profileGate({
      role: 'subscriber',
      subscription_status: 'active',
      username: 'member',
      address_street: null,
      address_city: null,
      address_state: null,
      address_zip: null,
      address: '111 Awesome St, Mckinney, TX 75071',
    });
    expect(gate.profileComplete).toBe(true);
    expect(ordinarySignInPath(gate)).toBe('/challenges');
  });

  it('sends an active member to challenges when username or address is missing', () => {
    const missingAddress = profileGate({
      role: 'subscriber',
      subscription_status: 'active',
      username: 'member',
      address_street: null,
      address_city: 'McKinney',
      address_state: 'TX',
      address_zip: '75070',
    });
    const missingUsername = profileGate({
      role: 'subscriber',
      subscription_status: 'active',
      ...complete,
      username: '   ',
    });
    expect(ordinarySignInPath(missingAddress)).toBe('/challenges');
    expect(settleMemberPath('/challenges', missingAddress)).toBe('/challenges');
    expect(settleMemberPath('/onboarding', missingAddress)).toBe('/challenges');
    expect(settleMemberPath('/account', missingAddress)).toBe('/account');
    expect(ordinarySignInPath(missingUsername)).toBe('/challenges');
    expect(settleMemberPath('/dashboard', missingUsername)).toBe('/challenges');
    expect(settleMemberPath('/onboarding', missingUsername)).toBe('/challenges');
  });
});
