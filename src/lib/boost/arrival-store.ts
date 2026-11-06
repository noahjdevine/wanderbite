import 'server-only';

import type { Json } from '@/types/database.types';
import type { BoostQuoteReason } from '@/lib/boost/quote';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

const QUOTE_REASONS = new Set<BoostQuoteReason>([
  'quoted',
  'below_minimum',
  'capped',
  'boost_applied',
  'boost_locked',
]);

export type ArrivalItemRecord = {
  id: string;
  restaurantId: string | null;
  status: string | null;
  offerVersionId: string | null;
  redemptionDeadline: string | null;
};

export type ArrivalVersionRecord = {
  id: string;
  restaurantId: string;
  timezone: string;
  validFrom: string;
  validUntil: string;
  tiers: Json;
  boosts: Json;
  withdrawnFromSelectionAt: string | null;
  boostSessionMinutes: number | null;
};

export type ArrivalSessionRecord = {
  id: string;
  restaurantId: string;
  challengeItemId: string;
  offerVersionId: string;
  redemptionId: string | null;
  lockedBoostId: string | null;
  arrivalAt: string;
  expiresAt: string;
  idempotencyKey: string;
  status: 'open' | 'closed';
};

export type ArrivalQuoteRecord = {
  id: string;
  sessionId: string;
  quoteVersion: number;
  offerVersionId: string;
  tierId: string | null;
  baseDiscountCents: number;
  boostId: string | null;
  boostDiscountCents: number;
  totalDiscountCents: number;
  eligibleSubtotalCents: number;
  belowMinimum: boolean;
  reasons: BoostQuoteReason[];
  expiresAt: string;
  supersededAt: string | null;
};

export type OpenArrivalSessionInput = {
  restaurantId: string;
  challengeItemId: string;
  offerVersionId: string;
  redemptionId: string | null;
  lockedBoostId: string | null;
  arrivalAt: string;
  expiresAt: string;
  idempotencyKey: string;
  createdByTokenHash: string;
  tierId: string | null;
  baseDiscountCents: number;
  boostId: string | null;
  boostDiscountCents: number;
  totalDiscountCents: number;
  eligibleSubtotalCents: number;
  belowMinimum: boolean;
  reasons: BoostQuoteReason[];
};

export type OpenArrivalSessionResult =
  | { status: 'created' | 'existing'; sessionId: string }
  | {
      status:
        | 'session_open'
        | 'restaurant_mismatch'
        | 'version_mismatch'
        | 'redemption_mismatch'
        | 'invalid_quote'
        | 'unavailable';
    };

export type SupersedeArrivalQuoteInput = {
  sessionId: string;
  restaurantId: string;
  supersededAt: string;
  quoteVersion: number;
  tierId: string | null;
  baseDiscountCents: number;
  boostId: string | null;
  boostDiscountCents: number;
  totalDiscountCents: number;
  eligibleSubtotalCents: number;
  belowMinimum: boolean;
  reasons: BoostQuoteReason[];
  expiresAt: string;
};

export type SupersedeArrivalQuoteResult = {
  status:
    | 'created'
    | 'not_found'
    | 'session_closed'
    | 'no_active_quote'
    | 'expiry_mismatch'
    | 'conflict'
    | 'invalid_quote'
    | 'unavailable';
};

export type ArrivalStore = {
  findItem(id: string): Promise<ArrivalItemRecord | null>;
  findVersion(id: string, restaurantId: string): Promise<ArrivalVersionRecord | null>;
  findSessionByKey(restaurantId: string, idempotencyKey: string): Promise<ArrivalSessionRecord | null>;
  findSession(id: string, restaurantId: string): Promise<ArrivalSessionRecord | null>;
  findActiveQuote(sessionId: string): Promise<ArrivalQuoteRecord | null>;
  openSession(input: OpenArrivalSessionInput): Promise<OpenArrivalSessionResult>;
  supersedeQuote(input: SupersedeArrivalQuoteInput): Promise<SupersedeArrivalQuoteResult>;
};

type Admin = ReturnType<typeof getSupabaseAdmin>;

function rpcStatus(data: Json | null): { status: string; sessionId: string | null } | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const status = data.status;
  if (typeof status !== 'string') return null;
  const sessionId = data.session_id;
  return { status, sessionId: typeof sessionId === 'string' ? sessionId : null };
}

function parseReasons(value: Json): BoostQuoteReason[] | null {
  if (!Array.isArray(value)) return null;
  const reasons: BoostQuoteReason[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !QUOTE_REASONS.has(entry as BoostQuoteReason)) return null;
    reasons.push(entry as BoostQuoteReason);
  }
  return reasons;
}

function mapSession(row: {
  id: string;
  restaurant_id: string;
  challenge_item_id: string;
  offer_version_id: string;
  redemption_id: string | null;
  locked_boost_id: string | null;
  arrival_at: string;
  expires_at: string;
  idempotency_key: string;
  status: string;
}): ArrivalSessionRecord | null {
  if (row.status !== 'open' && row.status !== 'closed') return null;
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    challengeItemId: row.challenge_item_id,
    offerVersionId: row.offer_version_id,
    redemptionId: row.redemption_id,
    lockedBoostId: row.locked_boost_id,
    arrivalAt: row.arrival_at,
    expiresAt: row.expires_at,
    idempotencyKey: row.idempotency_key,
    status: row.status,
  };
}

function mapQuote(row: {
  id: string;
  session_id: string;
  quote_version: number;
  offer_version_id: string;
  tier_id: string | null;
  base_discount_cents: number;
  boost_id: string | null;
  boost_discount_cents: number;
  total_discount_cents: number;
  eligible_subtotal_cents: number;
  below_minimum: boolean;
  reasons: Json;
  expires_at: string;
  superseded_at: string | null;
}): ArrivalQuoteRecord | null {
  const reasons = parseReasons(row.reasons);
  if (!reasons) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    quoteVersion: row.quote_version,
    offerVersionId: row.offer_version_id,
    tierId: row.tier_id,
    baseDiscountCents: row.base_discount_cents,
    boostId: row.boost_id,
    boostDiscountCents: row.boost_discount_cents,
    totalDiscountCents: row.total_discount_cents,
    eligibleSubtotalCents: row.eligible_subtotal_cents,
    belowMinimum: row.below_minimum,
    reasons,
    expiresAt: row.expires_at,
    supersededAt: row.superseded_at,
  };
}

const OPEN_STATUSES = new Set([
  'session_open',
  'restaurant_mismatch',
  'version_mismatch',
  'redemption_mismatch',
  'invalid_quote',
]);

const SUPERSEDE_STATUSES = new Set([
  'created',
  'not_found',
  'session_closed',
  'no_active_quote',
  'expiry_mismatch',
  'conflict',
  'invalid_quote',
]);

export function createSupabaseArrivalStore(admin: Admin): ArrivalStore {
  return {
    async findItem(id) {
      const { data, error } = await admin
        .from('challenge_items')
        .select('id, restaurant_id, status, offer_version_id, redemption_deadline')
        .eq('id', id)
        .maybeSingle();
      if (error || !data) return null;
      return {
        id: data.id,
        restaurantId: data.restaurant_id,
        status: data.status,
        offerVersionId: data.offer_version_id,
        redemptionDeadline: data.redemption_deadline,
      };
    },
    async findVersion(id, restaurantId) {
      const { data, error } = await admin
        .from('offer_versions')
        .select(
          'id, restaurant_id, timezone, valid_from, valid_until, tiers, boosts, withdrawn_from_selection_at, boost_session_minutes',
        )
        .eq('id', id)
        .eq('restaurant_id', restaurantId)
        .maybeSingle();
      if (error || !data) return null;
      return {
        id: data.id,
        restaurantId: data.restaurant_id,
        timezone: data.timezone,
        validFrom: data.valid_from,
        validUntil: data.valid_until,
        tiers: data.tiers,
        boosts: data.boosts,
        withdrawnFromSelectionAt: data.withdrawn_from_selection_at,
        boostSessionMinutes: data.boost_session_minutes,
      };
    },
    async findSessionByKey(restaurantId, idempotencyKey) {
      const { data, error } = await admin
        .from('boost_arrival_sessions')
        .select(
          'id, restaurant_id, challenge_item_id, offer_version_id, redemption_id, locked_boost_id, arrival_at, expires_at, idempotency_key, status',
        )
        .eq('restaurant_id', restaurantId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      if (error || !data) return null;
      return mapSession(data);
    },
    async findSession(id, restaurantId) {
      const { data, error } = await admin
        .from('boost_arrival_sessions')
        .select(
          'id, restaurant_id, challenge_item_id, offer_version_id, redemption_id, locked_boost_id, arrival_at, expires_at, idempotency_key, status',
        )
        .eq('id', id)
        .eq('restaurant_id', restaurantId)
        .maybeSingle();
      if (error || !data) return null;
      return mapSession(data);
    },
    async findActiveQuote(sessionId) {
      const { data, error } = await admin
        .from('boost_quotes')
        .select(
          'id, session_id, quote_version, offer_version_id, tier_id, base_discount_cents, boost_id, boost_discount_cents, total_discount_cents, eligible_subtotal_cents, below_minimum, reasons, expires_at, superseded_at',
        )
        .eq('session_id', sessionId)
        .is('superseded_at', null)
        .maybeSingle();
      if (error || !data) return null;
      return mapQuote(data);
    },
    async openSession(input) {
      const { data, error } = await admin.rpc('open_boost_arrival_session', {
        p_restaurant_id: input.restaurantId,
        p_challenge_item_id: input.challengeItemId,
        p_offer_version_id: input.offerVersionId,
        p_redemption_id: input.redemptionId,
        p_locked_boost_id: input.lockedBoostId,
        p_arrival_at: input.arrivalAt,
        p_expires_at: input.expiresAt,
        p_idempotency_key: input.idempotencyKey,
        p_created_by_token_hash: input.createdByTokenHash,
        p_tier_id: input.tierId,
        p_base_discount_cents: input.baseDiscountCents,
        p_boost_id: input.boostId,
        p_boost_discount_cents: input.boostDiscountCents,
        p_total_discount_cents: input.totalDiscountCents,
        p_eligible_subtotal_cents: input.eligibleSubtotalCents,
        p_below_minimum: input.belowMinimum,
        p_reasons: input.reasons,
      });
      if (error) return { status: 'unavailable' };
      const parsed = rpcStatus(data);
      if (!parsed) return { status: 'unavailable' };
      if (parsed.status === 'created' || parsed.status === 'existing') {
        if (!parsed.sessionId) return { status: 'unavailable' };
        return { status: parsed.status, sessionId: parsed.sessionId };
      }
      if (OPEN_STATUSES.has(parsed.status)) {
        return { status: parsed.status as Exclude<OpenArrivalSessionResult, { status: 'created' | 'existing' }>['status'] };
      }
      return { status: 'unavailable' };
    },
    async supersedeQuote(input) {
      const { data, error } = await admin.rpc('supersede_boost_arrival_quote', {
        p_session_id: input.sessionId,
        p_restaurant_id: input.restaurantId,
        p_superseded_at: input.supersededAt,
        p_quote_version: input.quoteVersion,
        p_tier_id: input.tierId,
        p_base_discount_cents: input.baseDiscountCents,
        p_boost_id: input.boostId,
        p_boost_discount_cents: input.boostDiscountCents,
        p_total_discount_cents: input.totalDiscountCents,
        p_eligible_subtotal_cents: input.eligibleSubtotalCents,
        p_below_minimum: input.belowMinimum,
        p_reasons: input.reasons,
        p_expires_at: input.expiresAt,
      });
      if (error) return { status: 'unavailable' };
      const parsed = rpcStatus(data);
      if (!parsed || !SUPERSEDE_STATUSES.has(parsed.status)) return { status: 'unavailable' };
      return { status: parsed.status as SupersedeArrivalQuoteResult['status'] };
    },
  };
}
