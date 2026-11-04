import { isTestOfferAuditMarker } from '@/lib/catalog/import';
import { isCheckoutEnabled } from '@/lib/checkout-enabled';
import type { DiscoverEvent, DiscoverOffer } from '@/lib/discover/events';
import { lowestSealedBase } from '@/lib/offers/sealed-base';
import { versionSelectable } from '@/lib/offers/version-capacity';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import type { Json } from '@/types/database.types';

type VersionRow = {
  id: string;
  restaurant_id: string;
  tiers: Json;
  valid_from: string;
  valid_until: string;
  withdrawn_from_selection_at: string | null;
};

/**
 * Same offer rule as the home hero: current version, `versionSelectable`,
 * and not an `isTestOfferAuditMarker` row. A failed read claims nothing.
 * Checkout stays fail-closed, so a paused checkout never reaches this read.
 */
export function memberOfferFromVersion(args: {
  restaurantId: string;
  currentOfferVersionId: string | null;
  version: VersionRow | null;
  isTestOffer: boolean;
  now: Date;
}): DiscoverOffer | null {
  if (args.isTestOffer || !args.currentOfferVersionId || !args.version) return null;
  const selectable = versionSelectable(args.version, args.now, {
    id: args.restaurantId,
    current_offer_version_id: args.currentOfferVersionId,
  });
  if (!selectable) return null;
  const base = lowestSealedBase(args.version.tiers);
  if (!base) return null;
  if (base.discount_amount_cents <= 0 || base.min_spend_cents <= 0) return null;
  return {
    amountOff: base.discount_amount_cents,
    minSpend: base.min_spend_cents,
  };
}

function auditIsTest(metadata: Json | null): unknown {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  return (metadata as { is_test?: unknown }).is_test;
}

export async function readMemberOffer(
  restaurantId: string,
  now = new Date(),
): Promise<DiscoverOffer | null> {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('restaurants')
      .select('id, status, current_offer_version_id')
      .eq('id', restaurantId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as {
      id: string;
      status: string | null;
      current_offer_version_id: string | null;
    };
    if (row.status !== 'active' || !row.current_offer_version_id) return null;
    const versionId = row.current_offer_version_id;

    const [versionResult, auditResult] = await Promise.all([
      admin
        .from('offer_versions')
        .select('id, restaurant_id, tiers, valid_from, valid_until, withdrawn_from_selection_at')
        .eq('id', versionId)
        .maybeSingle(),
      admin
        .from('admin_audit_log')
        .select('action, target_type, target_id, metadata')
        .eq('target_type', 'offer_version')
        .eq('target_id', versionId)
        .in('action', ['offer.test_mark', 'offer.publish']),
    ]);
    if (versionResult.error || auditResult.error || !versionResult.data) return null;

    const marked = (auditResult.data ?? []).some((audit) =>
      isTestOfferAuditMarker({
        action: audit.action,
        targetType: audit.target_type,
        isTest: auditIsTest(audit.metadata),
      }),
    );
    return memberOfferFromVersion({
      restaurantId: row.id,
      currentOfferVersionId: versionId,
      version: versionResult.data as VersionRow,
      isTestOffer: marked,
      now,
    });
  } catch {
    console.error('[discover] offer read failed');
    return null;
  }
}

export function applyOfferToPick(
  events: readonly DiscoverEvent[],
  offer: DiscoverOffer | null,
): DiscoverEvent[] {
  if (!offer) return [...events];
  return events.map((event) => {
    if (event.type !== 'pick') return event;
    return { ...event, partner: { ...event.partner, offer } };
  });
}

export async function attachMemberOffer(args: {
  events: readonly DiscoverEvent[];
  memberUserId: string | null;
  selectionMode: 'ai' | 'random_fallback' | null;
  restaurantId: string | null;
}): Promise<DiscoverEvent[]> {
  if (
    !isCheckoutEnabled() ||
    !args.memberUserId ||
    args.selectionMode !== 'ai' ||
    !args.restaurantId
  ) {
    return [...args.events];
  }
  const offer = await readMemberOffer(args.restaurantId);
  return applyOfferToPick(args.events, offer);
}
