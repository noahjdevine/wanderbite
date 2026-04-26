import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { PricingClient } from '@/components/pricing/pricing-client';

export const dynamic = 'force-dynamic';

export default async function PricingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let userId: string | null = null;
  let email: string | null = null;
  let fullName: string | null = null;
  let subscriptionStatus: string | null = null;

  if (user) {
    const admin = getSupabaseAdmin();
    const { data: profile } = await admin
      .from('user_profiles')
      .select('id, email, full_name, subscription_status')
      .eq('id', user.id)
      .maybeSingle();
    if (profile) {
      const p = profile as {
        id: string;
        email: string | null;
        full_name: string | null;
        subscription_status: string | null;
      };
      userId = p.id;
      email = p.email;
      fullName = p.full_name;
      subscriptionStatus = p.subscription_status;
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <PricingClient
          userId={userId}
          email={email}
          fullName={fullName}
          subscriptionStatus={subscriptionStatus}
        />
      </div>
    </main>
  );
}
