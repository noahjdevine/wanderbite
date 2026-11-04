import 'server-only';

import { isTestOfferAuditMarker } from '@/lib/catalog/import';
import { cuisineIdsFromRestaurantTags, cuisineLabel } from '@/lib/cuisines';
import { LAUNCH_MARKET } from '@/lib/launch-market';
import { requireLaunchMarketId } from '@/lib/launch-market-server';
import { lowestSealedBase } from '@/lib/offers/sealed-base';
import { versionSelectable } from '@/lib/offers/version-capacity';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import type { Json } from '@/types/database.types';
import {
  CURATED_ADVENTURES_PER_MONTH,
  chooseHeroPick,
  curatedAdventuresFact,
  heroOfferLine,
  marketSealCity,
  nowCuratingLabel,
  partnerNamesForMarquee,
  partnerSpotCount,
  type DirectoryNameRow,
  type HeroPick,
} from '@/lib/home/hero';

export type HomeHeroPick =
  | { kind: 'sample' }
  | {
      kind: 'partner';
      id: string;
      name: string;
      cuisine: string | null;
      offerLabel: string | null;
      imageUrl: string | null;
      googlePlaceId: string | null;
    };

export type HomeHeroCatalog = {
  curatingLabel: string;
  sealCity: string;
  partnerCount: number | null;
  marqueeNames: string[] | null;
  adventures: { value: number; label: string } | null;
  pick: HomeHeroPick;
};

type RestaurantRow = DirectoryNameRow & {
  id: string;
  cuisine_tags: string[] | null;
  current_offer_version_id: string | null;
  image_url: string | null;
  google_place_id: string | null;
};

type VersionRow = {
  id: string;
  restaurant_id: string;
  tiers: Json;
  valid_from: string;
  valid_until: string;
  withdrawn_from_selection_at: string | null;
};

function emptyCatalog(): HomeHeroCatalog {
  return {
    curatingLabel: nowCuratingLabel(LAUNCH_MARKET.cityQuery),
    sealCity: marketSealCity(LAUNCH_MARKET.cityQuery),
    partnerCount: null,
    marqueeNames: null,
    adventures: curatedAdventuresFact(CURATED_ADVENTURES_PER_MONTH),
    pick: { kind: 'sample' },
  };
}

function auditIsTest(metadata: Json | null): unknown {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  return metadata.is_test;
}

function withPhoto(pick: HeroPick, rows: readonly RestaurantRow[]): HomeHeroPick {
  if (pick.kind === 'sample') return pick;
  const row = rows.find((candidate) => candidate.id === pick.id);
  return {
    kind: 'partner',
    id: pick.id,
    name: pick.name,
    cuisine: pick.cuisine,
    offerLabel: pick.offerLabel,
    imageUrl: row?.image_url ?? null,
    googlePlaceId: row?.google_place_id ?? null,
  };
}

/**
 * Same restaurant set as the public directory: active rows in the launch market.
 * Offer copy is omitted unless the current version is selectable and not a test mark.
 */
export async function loadHomeHeroCatalog(): Promise<HomeHeroCatalog> {
  const base = emptyCatalog();
  try {
    const admin = getSupabaseAdmin();
    const market = await requireLaunchMarketId(admin);
    if (!market.ok) return base;

    const { data, error } = await admin
      .from('restaurants')
      .select(
        'id, name, status, cuisine_tags, current_offer_version_id, image_url, google_place_id',
      )
      .eq('status', 'active')
      .eq('market_id', market.marketId)
      .order('name');

    if (error || !data) return base;
    const rows = data as RestaurantRow[];
    const directoryRows: DirectoryNameRow[] = rows.map((row) => ({
      status: row.status,
      name: row.name,
    }));

    const versionIds = rows.flatMap((row) =>
      row.current_offer_version_id ? [row.current_offer_version_id] : [],
    );

    let versions: VersionRow[] = [];
    let testIds = new Set<string>();
    let offersUntrusted = false;

    if (versionIds.length > 0) {
      const [versionResult, auditResult] = await Promise.all([
        admin
          .from('offer_versions')
          .select(
            'id, restaurant_id, tiers, valid_from, valid_until, withdrawn_from_selection_at',
          )
          .in('id', versionIds),
        admin
          .from('admin_audit_log')
          .select('action, target_type, target_id, metadata')
          .eq('target_type', 'offer_version')
          .in('target_id', versionIds)
          .in('action', ['offer.test_mark', 'offer.publish']),
      ]);

      if (versionResult.error || auditResult.error) {
        offersUntrusted = true;
      } else {
        versions = (versionResult.data ?? []) as VersionRow[];
        testIds = new Set(
          (auditResult.data ?? []).flatMap((row) => {
            if (!row.target_id) return [];
            const marked = isTestOfferAuditMarker({
              action: row.action,
              targetType: row.target_type,
              isTest: auditIsTest(row.metadata),
            });
            return marked ? [row.target_id] : [];
          }),
        );
      }
    }

    const versionById = new Map(versions.map((version) => [version.id, version]));
    const now = new Date();
    const picks = rows.map((row) => {
      const versionId = row.current_offer_version_id;
      const version = versionId ? versionById.get(versionId) : undefined;
      const selectable =
        version != null &&
        versionSelectable(version, now, {
          id: row.id,
          current_offer_version_id: versionId,
        });
      const base = version ? lowestSealedBase(version.tiers) : null;
      const cuisineIds = cuisineIdsFromRestaurantTags(row.cuisine_tags);
      return {
        id: row.id,
        name: row.name,
        cuisine: cuisineIds[0] ? cuisineLabel(cuisineIds[0]) : null,
        offerLabel: heroOfferLine({
          discountCents: base?.discount_amount_cents ?? null,
          minSpendCents: base?.min_spend_cents ?? null,
          isTestOffer: offersUntrusted || (versionId != null && testIds.has(versionId)),
          selectable: selectable && !offersUntrusted,
        }),
      };
    });

    return {
      ...base,
      partnerCount: partnerSpotCount(directoryRows),
      marqueeNames: partnerNamesForMarquee(directoryRows),
      pick: withPhoto(chooseHeroPick(picks), rows),
    };
  } catch {
    return base;
  }
}
