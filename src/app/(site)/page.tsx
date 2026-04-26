import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { LandingPage } from '@/components/landing/landing-page';
import { RouletteHero } from '@/components/roulette/roulette-hero';

export const dynamic = 'force-dynamic';

/**
 * Home: public marketing landing only.
 * Logged-in users are redirected to /challenges.
 */
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    // Only route active subscribers away from marketing home.
    // Inactive users should be able to browse and/or choose a plan without loops.
    const admin = getSupabaseAdmin();
    const { data: profile } = await admin
      .from('user_profiles')
      .select('subscription_status')
      .eq('id', user.id)
      .maybeSingle();
    const sub = (profile as { subscription_status: string | null } | null)?.subscription_status ?? null;
    if (sub === 'active') {
      redirect('/challenges');
    }
  }

  return (
    <>
      <RouletteHero />
      <LandingPage />
    </>
  );
}
