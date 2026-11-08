import { DiscoverFlow } from '@/components/discover/discover-flow';
import { RouletteClient } from '@/components/roulette/roulette-client';
import { DISCOVER_STREAM_FLAG, discoverStreamEnabled } from '@/lib/discover/flag';
import { loadDiscoverViewer } from '@/lib/discover/viewer';
import { parseDiscoverQuery, parseDiscoverRunToken } from '@/lib/home/hero';
import { createClient } from '@/lib/supabase/server';

export const metadata = {
  title: 'Discover',
  description:
    'Ask for a restaurant in McKinney, Texas. Discovery cannot assess allergies. No login required.',
};

type RoulettePageProps = {
  searchParams: Promise<{ q?: string | string[]; run?: string | string[] }>;
};

export default async function RoulettePage({ searchParams }: RoulettePageProps) {
  const params = await searchParams;
  const initialMessage = parseDiscoverQuery(params.q);
  const autoStartToken = initialMessage ? parseDiscoverRunToken(params.run) : null;
  if (!discoverStreamEnabled(process.env[DISCOVER_STREAM_FLAG])) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    let subscriptionStatus: string | null = null;
    if (user) {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('subscription_status')
        .eq('id', user.id)
        .maybeSingle();
      subscriptionStatus =
        (profile as { subscription_status: string | null } | null)?.subscription_status ?? null;
    }
    return (
      <main className="min-h-screen bg-gradient-to-b from-orange-50/80 to-background">
        <RouletteClient
          key={initialMessage}
          initialMessage={initialMessage}
          autoStartToken={autoStartToken}
          subscriptionStatus={subscriptionStatus}
        />
      </main>
    );
  }

  const viewer = await loadDiscoverViewer();
  return (
    <main className="wb-dark min-h-[calc(100svh-3.5rem)] bg-wb-night text-white">
      <DiscoverFlow
        key={initialMessage}
        initialMessage={initialMessage}
        autoStartToken={autoStartToken}
        viewer={viewer}
      />
    </main>
  );
}
