import { getPartnerSession } from '@/app/actions/partner-auth';
import { PartnerRedeemClient } from '@/components/partner/partner-redeem-client';
import { createClient } from '@/lib/supabase/server';
import { PartnerSlugLogin } from '../partner-slug-login';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ code?: string }>;
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
    title: name ? `${name} — Redeem` : 'Partner Redeem',
  };
}

export default async function PartnerRedeemPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { code: rawCode } = await searchParams;
  const initialCode = rawCode?.trim() || null;

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from('restaurants')
    .select('id, name, slug')
    .eq('slug', slug)
    .eq('status', 'active')
    .maybeSingle();

  if (error || !row) {
    return (
      <div className="wb-partner-narrow wb-partner-center">
        <h1 className="wb-partner-title">Portal not found</h1>
        <p className="wb-partner-lede">
          Contact{' '}
          <a href="mailto:support@wanderbite.com">support@wanderbite.com</a>{' '}
          for your partner link.
        </p>
      </div>
    );
  }

  const restaurant = row as { id: string; name: string; slug: string };
  const session = await getPartnerSession();

  if (!session.ok || session.restaurantId !== restaurant.id) {
    return (
      <div className="wb-partner-narrow">
        <PartnerSlugLogin
          restaurantId={restaurant.id}
          restaurantName={restaurant.name}
          mode="redeem"
          redirectSlug={restaurant.slug}
          initialCode={initialCode}
        />
      </div>
    );
  }

  return (
    <PartnerRedeemClient
      restaurantName={session.restaurantName}
      slug={restaurant.slug}
      initialCode={initialCode}
    />
  );
}
