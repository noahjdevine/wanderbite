import { format } from 'date-fns';
import { redirect } from 'next/navigation';
import { getRedemptionCode } from '@/app/actions/get-redemption-code';
import { ShowRedemptionCode } from '@/components/challenges/show-redemption-code';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ redemptionId: string }>;
};

export default async function ShowRedemptionPage({ params }: PageProps) {
  const { redemptionId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/signin?redirectTo=${encodeURIComponent(`/challenges/show/${redemptionId}`)}`);
  }

  const admin = getSupabaseAdmin();
  const { data: redemption, error } = await admin
    .from('redemptions')
    .select('id, user_id, restaurant_id, status, verified_at')
    .eq('id', redemptionId)
    .maybeSingle();

  if (error || !redemption) {
    redirect('/challenges');
  }

  const row = redemption as {
    id: string;
    user_id: string;
    restaurant_id: string;
    status: string;
    verified_at: string | null;
  };

  if (row.user_id !== user.id) {
    redirect('/challenges');
  }

  const { data: restaurant } = await admin
    .from('restaurants')
    .select('name, slug')
    .eq('id', row.restaurant_id)
    .maybeSingle();

  const { data: offer } = await admin
    .from('restaurant_offers')
    .select('discount_amount_cents, min_spend_cents')
    .eq('restaurant_id', row.restaurant_id)
    .eq('active', true)
    .maybeSingle();

  const rest = restaurant as { name: string; slug: string | null } | null;
  const offerRow = offer as {
    discount_amount_cents: number | null;
    min_spend_cents: number | null;
  } | null;

  if (!rest?.slug) {
    redirect('/challenges');
  }

  const discountCents = offerRow?.discount_amount_cents ?? 1000;
  const minSpendCents = offerRow?.min_spend_cents ?? 4000;
  const discountLabel = `$${(discountCents / 100).toFixed(0)} off`;
  const minSpendLabel = `$${(minSpendCents / 100).toFixed(0)} minimum spend`;

  const code = row.status === 'issued' ? await getRedemptionCode(redemptionId) : null;

  if (row.status === 'issued' && !code) {
    redirect('/challenges');
  }

  const verifiedAt = row.verified_at
    ? format(new Date(row.verified_at), 'PPp')
    : null;

  return (
    <main className="min-h-screen bg-background">
      <ShowRedemptionCode
        code={code ?? ''}
        restaurantName={rest.name}
        restaurantSlug={rest.slug}
        discountLabel={discountLabel}
        minSpendLabel={minSpendLabel}
        status={row.status === 'verified' ? 'verified' : 'issued'}
        verifiedAt={verifiedAt}
      />
    </main>
  );
}
