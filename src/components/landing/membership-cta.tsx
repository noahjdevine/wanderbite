'use client';

import { CtaButton } from '@/components/wb/cta-button';
import { useSupabaseUser } from '@/hooks/use-supabase-user';

/** Signed-out visitors can create an account. That path does not start checkout. */
export function MembershipCta() {
  const { user } = useSupabaseUser();
  if (user) return null;
  return (
    <CtaButton href="/signup" variant="secondary-cream">
      Create a free account
    </CtaButton>
  );
}
