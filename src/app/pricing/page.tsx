import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { PricingClient } from '@/components/pricing/pricing-client';

export default async function PricingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let userId: string | null = null;
  let email: string | null = null;

  if (user) {
    const admin = getSupabaseAdmin();
    const { data: profile } = await admin
      .from('user_profiles')
      .select('id, email')
      .eq('id', user.id)
      .maybeSingle();
    if (profile) {
      userId = (profile as { id: string }).id;
      email = (profile as { email: string | null }).email;
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <PricingClient userId={userId} email={email} />
      </div>
    </main>
  );
}
