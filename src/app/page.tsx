import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { LandingPage } from '@/components/landing/landing-page';

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
    redirect('/challenges');
  }

  return <LandingPage />;
}
