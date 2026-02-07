import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Suggest a restaurant: placeholder for user submissions.
 * Requires login.
 */
export default async function SuggestPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <main className="min-h-screen bg-background pb-20 pt-24 md:pt-28">
      <div className="mx-auto max-w-2xl px-4">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Suggest a Restaurant
        </h1>
        <p className="mt-2 text-muted-foreground">
          Have a spot you’d love to see in Wanderbite? We’re all ears. This feature is coming soon—for now, reach out to us at{' '}
          <a href="mailto:hello@wanderbite.com" className="text-primary underline hover:no-underline">
            hello@wanderbite.com
          </a>
          .
        </p>
      </div>
    </main>
  );
}
