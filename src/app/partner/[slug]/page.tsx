import { createClient } from '@/lib/supabase/server';
import {
  getPartnerSession,
  getPartnerAnalytics,
} from '@/app/actions/partner-auth';
import { PartnerDashboard } from '../partner-dashboard';
import { PartnerSlugLogin } from './partner-slug-login';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from('restaurants')
    .select('name')
    .eq('slug', slug)
    .eq('status', 'active')
    .maybeSingle();
  const name = (data as { name: string } | null)?.name;
  return {
    title: name ? `${name} — Partner Portal` : 'Partner Portal',
  };
}

export default async function PartnerSlugPage({ params }: PageProps) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: row, error } = await supabase
    .from('restaurants')
    .select('id, name, slug')
    .eq('slug', slug)
    .eq('status', 'active')
    .maybeSingle();

  if (error || !row) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Portal not found
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Contact{' '}
          <a
            href="mailto:support@wanderbite.com"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            support@wanderbite.com
          </a>{' '}
          for your partner link.
        </p>
      </div>
    );
  }

  const restaurant = row as { id: string; name: string; slug: string };
  const session = await getPartnerSession();

  if (session.ok && session.restaurantId === restaurant.id) {
    const analytics = await getPartnerAnalytics(session.restaurantId);
    return (
      <div className="mx-auto max-w-4xl px-6 py-12">
        <PartnerDashboard
          restaurantName={session.restaurantName}
          analytics={analytics.ok ? analytics : null}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-6 py-12">
      <PartnerSlugLogin
        restaurantId={restaurant.id}
        restaurantName={restaurant.name}
      />
    </div>
  );
}
