import { redirect } from 'next/navigation';
import { format } from 'date-fns';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import Link from 'next/link';
import { CreditCard } from 'lucide-react';
import { ManageSubscriptionButton } from './manage-subscription-button';

export default async function BillingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const admin = getSupabaseAdmin();
  const { data: profile, error: profileError } = await admin
    .from('user_profiles')
    .select('id, subscription_status, current_period_end')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-destructive">Failed to load billing: {profileError.message}</p>
      </main>
    );
  }

  if (!profile) {
    redirect('/onboarding');
  }

  const typedProfile = profile as {
    id: string;
    subscription_status: string | null;
    current_period_end: string | null;
  };
  const isActive = typedProfile.subscription_status === 'active';
  const nextBillingDate = typedProfile.current_period_end
    ? format(new Date(typedProfile.current_period_end), 'MMMM d, yyyy')
    : null;

  return (
    <main className="min-h-screen bg-background pb-20 pt-24 md:pt-28">
      <div className="mx-auto max-w-2xl px-4">
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-foreground">
          Billing & Subscription
        </h1>
        <p className="mb-8 text-muted-foreground">
          Manage your plan and payment methods.
        </p>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <CreditCard className="size-6" />
              </div>
              <div>
                <CardTitle>
                  {isActive ? 'Wanderbite Club Membership' : 'Free Account'}
                </CardTitle>
                <CardDescription>
                  {isActive
                    ? `Active plan • $15/month${nextBillingDate ? ` • Renews ${nextBillingDate}` : ''}`
                    : 'No active subscription'}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {isActive ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Update your payment method, view invoices, or cancel anytime in the Stripe portal.
                </p>
                <ManageSubscriptionButton userId={typedProfile.id} />
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  You’re not subscribed yet. Join the club to unlock monthly dining adventures, $10 off each spot, and member perks.
                </p>
                <Button asChild className="w-full">
                  <Link href="/pricing">Upgrade to Member ($15/mo)</Link>
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
