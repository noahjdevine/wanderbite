import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));

vi.mock('@/hooks/use-supabase-user', () => ({
  useSupabaseUser: () => ({ user: auth.user, loading: false, signedIn: Boolean(auth.user) }),
}));

import { LAUNCH_HOLD_BODY, LAUNCH_HOLD_HEADING } from '@/components/launch-hold-notice';
import { MembershipSection } from '@/components/landing/membership-section';

describe('MembershipSection', () => {
  afterEach(() => {
    cleanup();
    auth.user = null;
  });

  it('does not state a price and sends a signed-out visitor to signup', () => {
    render(<MembershipSection />);
    const section = screen.getByRole('region', { name: 'Membership' });
    const text = section.textContent ?? '';
    expect(text).toContain(LAUNCH_HOLD_HEADING);
    expect(text).toContain(LAUNCH_HOLD_BODY);
    expect(text).toContain('McKinney, Texas');
    expect(text).toContain('does not start a paid plan');
    expect(text).not.toMatch(/\$\d+/);
    expect(screen.getByRole('link', { name: 'Create a free account' }).getAttribute('href')).toBe(
      '/signup',
    );
    expect(text).not.toMatch(/createCheckoutSession|Stripe/i);
  });

  it('hides the account link when a session is already present', () => {
    auth.user = { id: 'member' };
    render(<MembershipSection />);
    expect(screen.queryByRole('link', { name: 'Create a free account' })).toBeNull();
    expect(screen.getByText(LAUNCH_HOLD_HEADING)).toBeTruthy();
  });
});
