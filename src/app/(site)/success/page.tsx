import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function SuccessPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let firstName: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle();
    const fullName = (profile as { full_name?: string | null } | null)?.full_name;
    if (fullName?.trim()) {
      const first = fullName.trim().split(/\s+/)[0];
      if (first) firstName = first;
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl py-12 px-4 md:px-8">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          You&apos;re subscribed 🎉
        </h1>

        {firstName && (
          <p className="mt-2 text-muted-foreground">
            Thanks, {firstName}! Here&apos;s what you need to know.
          </p>
        )}

        <div className="mt-6 space-y-4 text-muted-foreground">
          <p>
            You&apos;re now on Wanderbite — $15/month, billed monthly and
            auto-renewing until canceled. Your plan includes 2 challenges per
            month and 1 swap per month (reset monthly).
          </p>
          <p>
            <strong className="text-foreground">Cancel anytime:</strong> Settings
            → Manage Subscription. Cancellation takes effect at the end of your
            current billing period. No partial refunds.
          </p>
          <p>
            <strong className="text-foreground">Discount rules:</strong> Unless
            otherwise stated, challenges include $10 off $40+ before tax/tip, not
            stackable, and require in-person confirmation at the restaurant.
          </p>
        </div>

        <ul className="mt-8 space-y-2 text-sm">
          <li>
            <Link
              href="/terms"
              className="text-primary underline hover:no-underline"
            >
              Terms of Service
            </Link>
          </li>
          <li>
            <Link
              href="/privacy"
              className="text-primary underline hover:no-underline"
            >
              Privacy Policy
            </Link>
          </li>
          <li>
            <Link
              href="/terms"
              className="text-primary underline hover:no-underline"
            >
              Discount & Challenge Rules
            </Link>
          </li>
        </ul>

        <div className="mt-10">
          <Link
            href="/challenges"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Go to Challenges
          </Link>
        </div>
      </div>
    </main>
  );
}
