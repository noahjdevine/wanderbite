'use server';

import { assertAdmin } from '@/lib/auth/assert-admin';
import { logAdminAction } from '@/lib/audit/log-admin-action';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { parseUuid } from '@/lib/uuid';
import type { Json } from '@/types/database.types';
import {
  pairSavingsModel,
  quoteOffer,
  type OfferBoost,
  type OfferQuote,
  type OfferTier,
} from '@/lib/offers/calculator';

export type OfferDraftInput = {
  restaurantId: string;
  timezone: string | null;
  validFrom: string | null;
  validUntil: string | null;
  tiers: OfferTier[];
  boosts: OfferBoost[];
  capacityTimezone: string | null;
  capacityMaxRedemptions: number | null;
  boostSessionMinutes: number | null;
};

export type OfferDraftView = OfferDraftInput & { id: string };

type DraftRow = {
  id: string;
  restaurant_id: string;
  timezone: string | null;
  valid_from: string | null;
  valid_until: string | null;
  tiers: Json;
  boosts: Json;
  capacity_timezone: string | null;
  capacity_max_redemptions: number | null;
  boost_session_minutes: number | null;
};

function asTiers(value: Json): OfferTier[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const threshold = Number(entry.threshold_cents);
    const discount = Number(entry.discount_cents);
    if (!Number.isInteger(threshold) || !Number.isInteger(discount)) return [];
    return [{ thresholdCents: threshold, discountCents: discount }];
  });
}

function asBoosts(value: Json): OfferBoost[] {
  if (!Array.isArray(value)) return [];
  const boosts: OfferBoost[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const id = typeof entry.id === 'string' ? entry.id : '';
    const bonusCents = Number(entry.bonus_cents);
    if (!id || !Number.isInteger(bonusCents)) continue;
    if (entry.kind === 'dated' && typeof entry.start === 'string' && typeof entry.end === 'string') {
      boosts.push({ id, kind: 'dated', start: entry.start, end: entry.end, bonusCents });
    } else if (entry.kind === 'weekly') {
      boosts.push({
        id,
        kind: 'weekly',
        startIsodow: Number(entry.start_isodow),
        startMinute: Number(entry.start_minute),
        endMinute: Number(entry.end_minute),
        bonusCents,
      });
    }
  }
  return boosts;
}

function tiersJson(tiers: OfferTier[]): Json {
  return tiers.map((tier) => ({
    threshold_cents: tier.thresholdCents,
    discount_cents: tier.discountCents,
  }));
}

function boostsJson(boosts: OfferBoost[]): Json {
  return boosts.map((boost) =>
    boost.kind === 'dated'
      ? { id: boost.id, kind: 'dated', start: boost.start, end: boost.end, bonus_cents: boost.bonusCents }
      : {
          id: boost.id,
          kind: 'weekly',
          start_isodow: boost.startIsodow,
          start_minute: boost.startMinute,
          end_minute: boost.endMinute,
          bonus_cents: boost.bonusCents,
        },
  );
}

export async function getOfferDraft(
  restaurantId: string,
): Promise<{ ok: true; draft: OfferDraftView | null } | { ok: false; error: string }> {
  const auth = await assertAdmin();
  if (!auth.ok) return { ok: false, error: auth.error };
  const id = parseUuid(restaurantId);
  if (!id) return { ok: false, error: 'Restaurant not found.' };

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('offer_drafts')
    .select(
      'id, restaurant_id, timezone, valid_from, valid_until, tiers, boosts, capacity_timezone, capacity_max_redemptions, boost_session_minutes',
    )
    .eq('restaurant_id', id)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: true, draft: null };
  const row = data as DraftRow;
  return {
    ok: true,
    draft: {
      id: row.id,
      restaurantId: row.restaurant_id,
      timezone: row.timezone,
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      tiers: asTiers(row.tiers),
      boosts: asBoosts(row.boosts),
      capacityTimezone: row.capacity_timezone,
      capacityMaxRedemptions: row.capacity_max_redemptions,
      boostSessionMinutes: row.boost_session_minutes,
    },
  };
}

export async function saveOfferDraft(
  input: OfferDraftInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await assertAdmin();
  if (!auth.ok) return { ok: false, error: auth.error };
  const restaurantId = parseUuid(input.restaurantId);
  if (!restaurantId) return { ok: false, error: 'Restaurant not found.' };

  const supabase = getSupabaseAdmin();
  const { data: existing, error: readErr } = await supabase
    .from('offer_drafts')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };

  const row = {
    restaurant_id: restaurantId,
    timezone: input.timezone,
    valid_from: input.validFrom,
    valid_until: input.validUntil,
    tiers: tiersJson(input.tiers),
    boosts: boostsJson(input.boosts),
    capacity_timezone: input.capacityTimezone,
    capacity_window_kind: 'calendar_month',
    capacity_max_redemptions: input.capacityMaxRedemptions,
    boost_session_minutes: input.boostSessionMinutes,
    updated_at: new Date().toISOString(),
  };

  const write = existing
    ? await supabase.from('offer_drafts').update(row).eq('restaurant_id', restaurantId)
    : await supabase.from('offer_drafts').insert(row);
  if (write.error) return { ok: false, error: write.error.message };

  await logAdminAction({
    actorUserId: auth.userId,
    action: 'offer.draft_save',
    targetType: 'restaurant',
    targetId: restaurantId,
  });
  return { ok: true };
}

export async function previewOfferDraft(input: {
  tiers: OfferTier[];
  boosts: OfferBoost[];
  timeZone: string;
  validFrom: string;
  validUntil: string;
  eligibleSubtotalCents: number;
  at: string;
  checkInAt: string | null;
  mode: 'selection' | 'bound';
  redemptionDeadline: string | null;
  comparisonTiers: OfferTier[];
}): Promise<
  | {
      ok: true;
      quote: OfferQuote;
      modelLabel: 'model input';
      pair: ReturnType<typeof pairSavingsModel>;
      targetCents: 2000;
    }
  | { ok: false; error: string }
> {
  const auth = await assertAdmin();
  if (!auth.ok) return { ok: false, error: auth.error };
  const validFrom = new Date(input.validFrom);
  const validUntil = new Date(input.validUntil);
  const at = new Date(input.at);
  if ([validFrom, validUntil, at].some((value) => Number.isNaN(value.getTime()))) {
    return { ok: false, error: 'Preview needs valid dates.' };
  }
  const quote = quoteOffer({
    mode: input.mode,
    tiers: input.tiers,
    boosts: input.boosts,
    timeZone: input.timeZone,
    validFrom,
    validUntil,
    current: true,
    withdrawn: false,
    eligibleSubtotalCents: input.eligibleSubtotalCents,
    at,
    checkInAt: input.checkInAt ? new Date(input.checkInAt) : null,
    redemptionDeadline: input.redemptionDeadline ? new Date(input.redemptionDeadline) : null,
  });
  return {
    ok: true,
    quote,
    modelLabel: 'model input',
    pair: pairSavingsModel(input.tiers, input.comparisonTiers),
    targetCents: 2000,
  };
}

async function auditRejection(actorUserId: string, restaurantId: string, error: string) {
  const supabase = getSupabaseAdmin();
  const { error: auditError } = await supabase.from('admin_audit_log').insert({
    actor_user_id: actorUserId,
    action: 'offer.publish_rejected',
    target_type: 'restaurant',
    target_id: restaurantId,
    metadata: { error },
  });
  return auditError?.message ?? null;
}

export async function publishOfferDraft(
  restaurantIdInput: string,
): Promise<{ ok: true; versionId: string } | { ok: false; error: string }> {
  const auth = await assertAdmin();
  if (!auth.ok) return { ok: false, error: auth.error };
  const restaurantId = parseUuid(restaurantIdInput);
  if (!restaurantId) return { ok: false, error: 'Restaurant not found.' };
  const supabase = getSupabaseAdmin();
  const { data: draft, error: draftError } = await supabase
    .from('offer_drafts')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .maybeSingle();
  if (draftError) return { ok: false, error: draftError.message };
  if (!draft) return { ok: false, error: 'Save a draft before publishing.' };
  const { data, error } = await supabase.rpc('publish_offer_version', {
    p_draft_id: draft.id,
    p_actor_user_id: auth.userId,
  });
  if (error) return { ok: false, error: error.message };
  const result = data as { published?: boolean; error?: string; version_id?: string } | null;
  if (!result?.published || !result.version_id) {
    const reason = result?.error ?? 'Publish failed.';
    const auditError = await auditRejection(auth.userId, restaurantId, reason);
    if (auditError) return { ok: false, error: auditError };
    return { ok: false, error: reason };
  }
  return { ok: true, versionId: result.version_id };
}

export async function withdrawCurrentOffer(
  restaurantIdInput: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await assertAdmin();
  if (!auth.ok) return { ok: false, error: auth.error };
  const restaurantId = parseUuid(restaurantIdInput);
  if (!restaurantId) return { ok: false, error: 'Restaurant not found.' };
  const supabase = getSupabaseAdmin();
  const { data: restaurant, error: readError } = await supabase
    .from('restaurants')
    .select('current_offer_version_id')
    .eq('id', restaurantId)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!restaurant?.current_offer_version_id) {
    return { ok: false, error: 'This restaurant has no current offer version.' };
  }
  const { data, error } = await supabase.rpc('withdraw_offer_version', {
    p_version_id: restaurant.current_offer_version_id,
    p_actor_user_id: auth.userId,
  });
  if (error) return { ok: false, error: error.message };
  const result = data as { withdrawn?: boolean; error?: string } | null;
  if (!result?.withdrawn) return { ok: false, error: result?.error ?? 'Withdraw failed.' };
  return { ok: true };
}

export async function activateRestaurant(
  restaurantIdInput: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await assertAdmin();
  if (!auth.ok) return { ok: false, error: auth.error };
  const restaurantId = parseUuid(restaurantIdInput);
  if (!restaurantId) return { ok: false, error: 'Restaurant not found.' };
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('activate_restaurant', {
    p_restaurant_id: restaurantId,
    p_actor_user_id: auth.userId,
  });
  if (error) return { ok: false, error: error.message };
  const result = data as { ok?: boolean; error?: string } | null;
  if (!result?.ok) return { ok: false, error: result?.error ?? 'Activate failed.' };
  return { ok: true };
}
