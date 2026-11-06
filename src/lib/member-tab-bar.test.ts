import { describe, expect, it } from 'vitest';
import {
  CHALLENGES_TAB_HREF,
  DISCOVER_TAB_HREF,
  PASSPORT_TAB_HREF,
  PROGRESS_TAB_HREF,
  resolveMemberTabHref,
  shouldShowMemberTabBar,
} from '@/lib/member-tab-bar';

describe('resolveMemberTabHref', () => {
  it('matches each tab on its exact route', () => {
    expect(resolveMemberTabHref('/roulette')).toBe(DISCOVER_TAB_HREF);
    expect(resolveMemberTabHref('/challenges')).toBe(CHALLENGES_TAB_HREF);
    expect(resolveMemberTabHref('/journey')).toBe(PROGRESS_TAB_HREF);
    expect(resolveMemberTabHref('/journey', 'view=passport')).toBe(PASSPORT_TAB_HREF);
    expect(resolveMemberTabHref('/journey', '?view=passport')).toBe(PASSPORT_TAB_HREF);
  });

  it('lights the parent tab on sub-routes', () => {
    expect(resolveMemberTabHref('/roulette/history')).toBe(DISCOVER_TAB_HREF);
    expect(resolveMemberTabHref('/challenges/extra')).toBe(CHALLENGES_TAB_HREF);
    expect(resolveMemberTabHref('/journey/memories')).toBe(PROGRESS_TAB_HREF);
    expect(resolveMemberTabHref('/journey/', '')).toBe(PROGRESS_TAB_HREF);
    expect(resolveMemberTabHref('/journey', 'view=map')).toBe(PASSPORT_TAB_HREF);
    expect(resolveMemberTabHref('/passport')).toBe(PASSPORT_TAB_HREF);
    expect(resolveMemberTabHref('/passport/share')).toBe(PASSPORT_TAB_HREF);
  });

  it('leaves an unknown path with no active tab', () => {
    expect(resolveMemberTabHref('/restaurants')).toBeNull();
    expect(resolveMemberTabHref('/account')).toBeNull();
    expect(resolveMemberTabHref('/')).toBeNull();
    expect(resolveMemberTabHref('/billing')).toBeNull();
    expect(resolveMemberTabHref('/no-such-page')).toBeNull();
    expect(resolveMemberTabHref('/journey', 'view=nope')).toBe(PROGRESS_TAB_HREF);
    expect(resolveMemberTabHref('/journey', 'view=journal')).toBeNull();
    expect(resolveMemberTabHref('/journey', 'view=journal&page=2')).toBeNull();
    expect(resolveMemberTabHref('/journal')).toBeNull();
    expect(resolveMemberTabHref('/journal/notes/red-1')).toBeNull();
  });
});

describe('shouldShowMemberTabBar', () => {
  it('shows only for a signed-in member off the excluded routes', () => {
    expect(shouldShowMemberTabBar('/roulette', true)).toBe(true);
    expect(shouldShowMemberTabBar('/challenges', true)).toBe(true);
    expect(shouldShowMemberTabBar('/journey', true)).toBe(true);
    expect(shouldShowMemberTabBar('/account', true)).toBe(true);
    expect(shouldShowMemberTabBar('/restaurants', true)).toBe(true);
    expect(shouldShowMemberTabBar('/pricing', true)).toBe(true);

    expect(shouldShowMemberTabBar('/roulette', false)).toBe(false);
    expect(shouldShowMemberTabBar('/challenges', false)).toBe(false);

    for (const path of [
      '/partner',
      '/partner/yard',
      '/partner/yard/redeem',
      '/admin',
      '/admin/content',
      '/onboarding',
      '/signin',
      '/signup',
      '/signup/check-email',
      '/login',
      '/forgot-password',
      '/reset-password',
      '/auth/callback',
      '/contact',
      '/privacy',
      '/terms',
      '/rules',
      '/checkout',
      '/checkout/success',
      '/challenges/show',
      '/challenges/show/red-1',
      '/dev/components',
      '/dev/screens',
    ]) {
      expect(shouldShowMemberTabBar(path, true)).toBe(false);
    }
  });
});
