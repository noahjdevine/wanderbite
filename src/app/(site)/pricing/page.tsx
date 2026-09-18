import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { PricingClient } from '@/components/pricing/pricing-client';
import { launchAreaState } from '@/lib/launch-market';

export const dynamic = 'force-dynamic';

export default async function PricingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let userId: string | null = null;
  let email: string | null = null;
  let fullName: string | null = null;
  let subscriptionStatus: string | null = null;
  let areaState: ReturnType<typeof launchAreaState> | null = null;

  if (user) {
    const admin = getSupabaseAdmin();
    const { data: profile } = await admin
      .from('user_profiles')
      .select(
        'id, email, full_name, subscription_status, address_street, address_city, address_state, address_zip'
      )
      .eq('id', user.id)
      .maybeSingle();
    if (profile) {
      const p = profile as {
        id: string;
        email: string | null;
        full_name: string | null;
        subscription_status: string | null;
        address_street: string | null;
        address_city: string | null;
        address_state: string | null;
        address_zip: string | null;
      };
      userId = p.id;
      email = p.email;
      fullName = p.full_name;
      subscriptionStatus = p.subscription_status;
      areaState = launchAreaState({
        street: p.address_street,
        city: p.address_city,
        state: p.address_state,
        zip: p.address_zip,
      });
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
          areaState={areaState}
        />
      </div>
    </main>
  );
}
