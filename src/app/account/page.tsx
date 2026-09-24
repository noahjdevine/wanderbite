import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { AccountClient } from '@/components/account/AccountClient';
import { normalizeCuisineIds } from '@/lib/cuisines';
import { nextMemberRedirect, profileGate } from '@/lib/auth/member-destinations';
import type { UserPreferencesRow } from '@/types/user-preferences';
import { hasCurrentLegalAttestation } from '@/lib/legal-attestation-status';

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
  const [profileResult, prefsResult, reminderPrefResult, hasCurrentAttestation] = await Promise.all([
    admin
      .from('user_profiles')
      .select(
        'id, email, role, full_name, username, dietary_flags, distance_band, wants_cocktail_experience, address_street, address_city, address_state, address_zip, subscription_status, current_period_end'
      )
      .eq('id', user.id)
      .maybeSingle(),
    admin.from('user_preferences').select('excluded_cuisines').eq('user_id', user.id).maybeSingle(),
    admin
      .from('email_topic_preferences')
      .select('opted_out')
      .eq('user_id', user.id)
      .eq('topic', 'adventure_reminders')
      .maybeSingle(),
    hasCurrentLegalAttestation(supabase, user.id),
  ]);

  if (profileResult.error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6 pt-24">
        <p className="text-sm text-destructive">Unable to load your profile right now. Please try again.</p>
      </main>
    );
  }

  const profile = profileResult.data;
  const prefs = prefsResult.data;
  const gate = profileGate(
    profile as {
      role: string | null;
      subscription_status: string | null;
      username: string | null;
      address_street: string | null;
      address_city: string | null;
      address_state: string | null;
      address_zip: string | null;
    } | null,
  );
  const next = nextMemberRedirect('/account', gate);
  if (next) redirect(next);

  const p = profile as {
    id: string;
    email: string | null;
    full_name: string | null;
    username: string | null;
    dietary_flags: string[] | null;
    distance_band: string | null;
    wants_cocktail_experience: boolean | null;
    address_street: string | null;
    address_city: string | null;
    address_state: string | null;
    address_zip: string | null;
    role: string | null;
    subscription_status: string | null;
    current_period_end: string | null;
  };

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
              excluded_cuisines: normalizeCuisineIds(
                (prefs as UserPreferencesRow | null)?.excluded_cuisines ?? []
              ),
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
            adventureRemindersOptedOut: reminderPrefResult.data?.opted_out === true,
            adventureRemindersUnavailable: Boolean(reminderPrefResult.error),
            hasCurrentAttestation,
          }}
        />
      </div>
    </main>
  );
}

