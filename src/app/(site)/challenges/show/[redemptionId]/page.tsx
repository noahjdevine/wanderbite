import { format } from 'date-fns';
import { redirect } from 'next/navigation';
import { getRedemptionCode } from '@/app/actions/get-redemption-code';
import { ShowRedemptionCode } from '@/components/challenges/show-redemption-code';
import { createClient } from '@/lib/supabase/server';
import { memberQrConfirmedDiscountLabel } from '@/lib/boost/confirm-visit';
import { formatCents, lowestSealedBase } from '@/lib/offers/sealed-base';
import { visitWindowOpen } from '@/lib/redemption-expiry';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import type { Json } from '@/types/database.types';

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
    .select('id, user_id, restaurant_id, challenge_item_id, status, verified_at, expires_at')
    .eq('id', redemptionId)
    .maybeSingle();

  if (error || !redemption) {
    redirect('/challenges');
  }

  const row = redemption as {
    id: string;
    user_id: string;
    restaurant_id: string;
    challenge_item_id: string | null;
    status: string;
    verified_at: string | null;
    expires_at: string | null;
  };

  if (row.user_id !== user.id) {
    redirect('/challenges');
  }

  const { data: restaurant } = await admin
    .from('restaurants')
    .select('name, slug, cuisine_tags, neighborhood')
    .eq('id', row.restaurant_id)
    .maybeSingle();

  const { data: offer } = await admin
    .from('restaurant_offers')
    .select('discount_amount_cents, min_spend_cents')
    .eq('restaurant_id', row.restaurant_id)
    .eq('active', true)
    .maybeSingle();

  const rest = restaurant as {
    name: string;
    slug: string | null;
    cuisine_tags: string[] | null;
    neighborhood: string | null;
  } | null;
  const offerRow = offer as {
    discount_amount_cents: number | null;
    min_spend_cents: number | null;
  } | null;

  if (!rest?.slug) {
    redirect('/challenges');
  }

  let versionId: string | null = null;
  let itemStatus: string | null = null;
  let redemptionDeadline: string | null = null;
  if (row.challenge_item_id) {
    const { data: item } = await admin
      .from('challenge_items')
      .select('offer_version_id, status, redemption_deadline')
      .eq('id', row.challenge_item_id)
      .maybeSingle();
    const itemRow = item as {
      offer_version_id: string | null;
      status: string;
      redemption_deadline: string | null;
    } | null;
    versionId = itemRow?.offer_version_id ?? null;
    itemStatus = itemRow?.status ?? null;
    redemptionDeadline = itemRow?.redemption_deadline ?? null;
  }
  const { data: noteRow } = await admin
    .from('bite_notes')
    .select('redemption_id')
    .eq('redemption_id', row.id)
    .maybeSingle();
  const hasNote = Boolean(noteRow);
  let sealed = null as ReturnType<typeof lowestSealedBase>;
  if (versionId) {
    const { data: version } = await admin
      .from('offer_versions')
      .select('tiers')
      .eq('id', versionId)
      .maybeSingle();
    sealed = lowestSealedBase((version as { tiers: Json } | null)?.tiers);
  }
  const offerUnavailable = Boolean(versionId) && !sealed;
  const discountCents = sealed?.discount_amount_cents ?? offerRow?.discount_amount_cents ?? 1000;
  const minSpendCents = sealed?.min_spend_cents ?? offerRow?.min_spend_cents ?? 4000;
  const discountLabel = offerUnavailable
    ? 'Offer unavailable'
    : `${formatCents(discountCents)} off`;
  const minSpendLabel = offerUnavailable
    ? ''
    : `${formatCents(minSpendCents)} minimum spend`;

  const now = new Date();
  const [confirmedDiscountLabel, codeResult] = await Promise.all([
    row.challenge_item_id
      ? memberQrConfirmedDiscountLabel({
          challengeItemId: row.challenge_item_id,
          redemptionId: row.id,
          now,
          sealedBase: sealed,
        })
      : Promise.resolve(null),
    row.status === 'verified' ? Promise.resolve(null) : getRedemptionCode(redemptionId),
  ]);
  if (
    row.status !== 'verified'
    && codeResult?.state !== 'verified'
    && (!codeResult || codeResult.state === 'unavailable')
  ) {
    redirect('/challenges');
  }

  const verifiedIso =
    row.status === 'verified'
      ? row.verified_at
      : codeResult?.state === 'verified'
        ? codeResult.verifiedAt
        : null;
  const verifiedAt = verifiedIso ? format(new Date(verifiedIso), 'PPp') : null;
  const phase =
    row.status === 'verified' || codeResult?.state === 'verified'
      ? 'verified'
      : codeResult?.state === 'issued'
        ? 'issued'
        : 'expired';
  const liveCode = codeResult?.state === 'issued' ? codeResult.code : null;
  const liveExpiresAt =
    codeResult?.state === 'issued' || codeResult?.state === 'expired'
      ? codeResult.expiresAt
      : row.expires_at;

  return (
    <main className="min-h-screen bg-wb-cream">
      <ShowRedemptionCode
        redemptionId={row.id}
        challengeItemId={row.challenge_item_id}
        code={liveCode}
        expiresAt={liveExpiresAt}
        redemptionDeadline={redemptionDeadline}
        canReissue={itemStatus === 'redeemed' && visitWindowOpen(redemptionDeadline, now)}
        restaurantName={rest.name}
        restaurantSlug={rest.slug}
        discountLabel={discountLabel}
        minSpendLabel={minSpendLabel}
        confirmedDiscountLabel={confirmedDiscountLabel}
        status={phase}
        verifiedAt={verifiedAt}
        verifiedAtIso={verifiedIso}
        cuisineTags={rest.cuisine_tags}
        neighborhood={rest.neighborhood}
        itemStatus={itemStatus}
        hasNote={hasNote}
      />
    </main>
  );
}
