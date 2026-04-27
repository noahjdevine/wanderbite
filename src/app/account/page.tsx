import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { AccountClient } from '@/components/account/AccountClient';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/signin?redirectTo=/account');
  }

  const admin = getSupabaseAdmin();
  const { data: profile } = await admin
    .from('user_profiles')
    .select(
      'id, email, full_name, username, dietary_flags, cuisine_opt_out, distance_band, wants_cocktail_experience, address_street, address_city, address_state, address_zip, subscription_status, current_period_end'
    )
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) {
    redirect('/onboarding');
  }

  const p = profile as {
    id: string;
    email: string | null;
    full_name: string | null;
    username: string | null;
    dietary_flags: string[] | null;
    cuisine_opt_out: string[] | null;
    distance_band: string | null;
    wants_cocktail_experience: boolean | null;
    address_street: string | null;
    address_city: string | null;
    address_state: string | null;
    address_zip: string | null;
    subscription_status: string | null;
    current_period_end: string | null;
  };

  const hasProfile =
    Boolean(p.username?.trim()) &&
    Boolean(p.address_street?.trim()) &&
    Boolean(p.address_city?.trim()) &&
    Boolean(p.address_state?.trim()) &&
    Boolean(p.address_zip?.trim());

  if (!hasProfile) {
    redirect('/onboarding');
  }

  return (
    <main className="min-h-screen bg-background pb-20 pt-24 md:pt-28">
      <div className="mx-auto max-w-3xl space-y-8 px-4 sm:px-6">
        <header className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Your account</h1>
          <p className="text-muted-foreground">Manage your profile, preferences, and subscription.</p>
        </header>

        <AccountClient
          initial={{
            userId: p.id,
            email: p.email,
            fullName: p.full_name,
            subscriptionStatus: p.subscription_status,
            currentPeriodEnd: p.current_period_end,
            preferences: {
              dietary_flags: p.dietary_flags ?? [],
              vibe_tags: p.cuisine_opt_out ?? [],
              distance_band: p.distance_band ?? '15_mi',
              wants_cocktail_experience: Boolean(p.wants_cocktail_experience),
            },
            profile: {
              username: p.username ?? '',
              address: {
                street: p.address_street ?? '',
                city: p.address_city ?? '',
                state: p.address_state ?? '',
                zip: p.address_zip ?? '',
              },
            },
          }}
        />
      </div>
    </main>
  );
}

