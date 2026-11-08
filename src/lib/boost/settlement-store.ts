import 'server-only';

import type {
  BoostConfirmationPlan,
  BoostConfirmationRefusal,
  BoostQuoteSavings,
  RecordedBoostSettlement,
} from '@/lib/boost/confirm';
import type { Json } from '@/types/database.types';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/**
 * Writer for an already-computed Boost confirmation plan.
 * Partner verify calls this after a successful claim when the arrival flag
 * is on. It does not re-run the planner, verify a redemption, quote a Boost,
 * or scan a bill.
 */

const SETTLEMENT_COLUMNS =
  'settlement_kind, settled_at, quote_id, quote_version, base_discount_cents, boost_discount_cents, total_discount_cents, eligible_subtotal_cents, below_minimum, tier_id, boost_id, locked_boost_id, quote_expires_at, sealed_discount_amount_cents, sealed_min_spend_cents';

export type StoredRedemptionSettlement = {
  settlement_kind: string | null;
  settled_at: string | null;
  quote_id: string | null;
  quote_version: number | null;
  base_discount_cents: number | null;
  boost_discount_cents: number | null;
  total_discount_cents: number | null;
  eligible_subtotal_cents: number | null;
  below_minimum: boolean | null;
  tier_id: string | null;
  boost_id: string | null;
  locked_boost_id: string | null;
  quote_expires_at: string | null;
  sealed_discount_amount_cents: number | null;
  sealed_min_spend_cents: number | null;
};

export type RecordBoostSettlementArgs = {
  p_redemption_id: string;
  p_settlement_kind: string;
  p_settled_at: string;
  p_quote_id: string | null;
  p_quote_version: number | null;
  p_base_discount_cents: number | null;
  p_boost_discount_cents: number | null;
  p_total_discount_cents: number | null;
  p_eligible_subtotal_cents: number | null;
  p_below_minimum: boolean | null;
  p_tier_id: string | null;
  p_boost_id: string | null;
  p_locked_boost_id: string | null;
  p_quote_expires_at: string | null;
  p_sealed_discount_amount_cents: number | null;
  p_sealed_min_spend_cents: number | null;
};

export type SettlementStorePort = {
  record: (
    args: RecordBoostSettlementArgs,
  ) => Promise<{ data: Json | null; error: { message: string } | null }>;
  load: (redemptionId: string) => Promise<StoredRedemptionSettlement | null>;
};

export type PersistBoostSettlementResult =
  | { status: 'created' | 'already_settled'; recorded: RecordedBoostSettlement }
  | { status: 'not_writable'; kind: 'needs_subtotal' | BoostConfirmationRefusal }
  | {
      status:
        | 'not_found'
        | 'not_verified'
        | 'quote_already_consumed'
        | 'invalid_snapshot'
        | 'unavailable';
    };

const RPC_STATUSES = new Set([
  'created',
  'already_settled',
  'not_found',
  'not_verified',
  'quote_already_consumed',
  'invalid_snapshot',
]);

type Admin = ReturnType<typeof getSupabaseAdmin>;

function wholeCents(value: number | null): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function textOrNull(value: unknown): string | null | undefined {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  return undefined;
}

function centsOrNull(value: unknown): number | null | undefined {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  return undefined;
}

function boolOrNull(value: unknown): boolean | null | undefined {
  if (value == null) return null;
  if (typeof value === 'boolean') return value;
  return undefined;
}

function asRecord(value: Json | null): { [key: string]: Json | undefined } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

/** Map a stored redemption row. Null means the visit is not settled yet. */
export function recordedBoostSettlementFromRow(
  row: StoredRedemptionSettlement | null,
): RecordedBoostSettlement | null {
  if (!row || row.settlement_kind == null) return null;
  if (row.settlement_kind === 'use_sealed_base') {
    const discount = row.sealed_discount_amount_cents;
    const minimum = row.sealed_min_spend_cents;
    if (discount == null && minimum == null) return { snapshot: null };
    if (!wholeCents(discount) || !wholeCents(minimum)) return null;
    return { snapshot: { discount_amount_cents: discount, min_spend_cents: minimum } };
  }
  if (row.settlement_kind !== 'consume_quote') return null;
  if (
    !row.quote_id ||
    !row.quote_expires_at ||
    row.quote_version == null ||
    !Number.isInteger(row.quote_version) ||
    row.quote_version < 1 ||
    !wholeCents(row.base_discount_cents) ||
    !wholeCents(row.boost_discount_cents) ||
    !wholeCents(row.total_discount_cents) ||
    !wholeCents(row.eligible_subtotal_cents) ||
    typeof row.below_minimum !== 'boolean'
  ) {
    return null;
  }
  const snapshot: BoostQuoteSavings = {
    quote_id: row.quote_id,
    quote_version: row.quote_version,
    base_discount_cents: row.base_discount_cents,
    boost_discount_cents: row.boost_discount_cents,
    total_discount_cents: row.total_discount_cents,
    eligible_subtotal_cents: row.eligible_subtotal_cents,
    below_minimum: row.below_minimum,
    tier_id: row.tier_id,
    boost_id: row.boost_id,
    locked_boost_id: row.locked_boost_id,
    expires_at: row.quote_expires_at,
  };
  return { snapshot };
}

function rowFromSnapshot(snapshot: { [key: string]: Json | undefined }): StoredRedemptionSettlement | null {
  const settlementKind = textOrNull(snapshot.settlement_kind);
  const settledAt = textOrNull(snapshot.settled_at);
  const quoteId = textOrNull(snapshot.quote_id);
  const quoteVersion = centsOrNull(snapshot.quote_version);
  const base = centsOrNull(snapshot.base_discount_cents);
  const boost = centsOrNull(snapshot.boost_discount_cents);
  const total = centsOrNull(snapshot.total_discount_cents);
  const eligible = centsOrNull(snapshot.eligible_subtotal_cents);
  const below = boolOrNull(snapshot.below_minimum);
  const tierId = textOrNull(snapshot.tier_id);
  const boostId = textOrNull(snapshot.boost_id);
  const locked = textOrNull(snapshot.locked_boost_id);
  const quoteExpires = textOrNull(snapshot.quote_expires_at);
  const sealedDiscount = centsOrNull(snapshot.sealed_discount_amount_cents);
  const sealedMin = centsOrNull(snapshot.sealed_min_spend_cents);
  if (
    settlementKind === undefined ||
    settledAt === undefined ||
    quoteId === undefined ||
    quoteVersion === undefined ||
    base === undefined ||
    boost === undefined ||
    total === undefined ||
    eligible === undefined ||
    below === undefined ||
    tierId === undefined ||
    boostId === undefined ||
    locked === undefined ||
    quoteExpires === undefined ||
    sealedDiscount === undefined ||
    sealedMin === undefined
  ) {
    return null;
  }
  return {
    settlement_kind: settlementKind,
    settled_at: settledAt,
    quote_id: quoteId,
    quote_version: quoteVersion,
    base_discount_cents: base,
    boost_discount_cents: boost,
    total_discount_cents: total,
    eligible_subtotal_cents: eligible,
    below_minimum: below,
    tier_id: tierId,
    boost_id: boostId,
    locked_boost_id: locked,
    quote_expires_at: quoteExpires,
    sealed_discount_amount_cents: sealedDiscount,
    sealed_min_spend_cents: sealedMin,
  };
}

function emptyArgs(redemptionId: string, kind: string, settledAt: string): RecordBoostSettlementArgs {
  return {
    p_redemption_id: redemptionId,
    p_settlement_kind: kind,
    p_settled_at: settledAt,
    p_quote_id: null,
    p_quote_version: null,
    p_base_discount_cents: null,
    p_boost_discount_cents: null,
    p_total_discount_cents: null,
    p_eligible_subtotal_cents: null,
    p_below_minimum: null,
    p_tier_id: null,
    p_boost_id: null,
    p_locked_boost_id: null,
    p_quote_expires_at: null,
    p_sealed_discount_amount_cents: null,
    p_sealed_min_spend_cents: null,
  };
}

/**
 * Load the database snapshot for a later C3 `recorded` argument.
 * A sealed miss is `{ snapshot: null }`. A visit that is not settled yet is null.
 */
export async function readRecordedBoostSettlement(
  redemptionId: string,
  port: Pick<SettlementStorePort, 'load'>,
): Promise<RecordedBoostSettlement | null> {
  return recordedBoostSettlementFromRow(await port.load(redemptionId));
}

/**
 * Persist `plan` on one redemption. The plan is already computed.
 * `needs_subtotal` and refusals do not call the write.
 * `already_settled` reads the database and does not overwrite.
 */
export async function persistBoostSettlement(
  redemptionId: string,
  plan: BoostConfirmationPlan,
  port: SettlementStorePort,
  options?: { settledAt?: Date },
): Promise<PersistBoostSettlementResult> {
  if (!plan.ok) return { status: 'not_writable', kind: plan.kind };
  if (plan.kind === 'needs_subtotal') return { status: 'not_writable', kind: 'needs_subtotal' };
  if (plan.kind === 'already_settled') {
    const recorded = await readRecordedBoostSettlement(redemptionId, port);
    if (!recorded) return { status: 'not_found' };
    return { status: 'already_settled', recorded };
  }

  const args = emptyArgs(
    redemptionId,
    plan.kind,
    (options?.settledAt ?? new Date()).toISOString(),
  );
  if (plan.kind === 'consume_quote') {
    args.p_quote_id = plan.snapshot.quote_id;
    args.p_quote_version = plan.snapshot.quote_version;
    args.p_base_discount_cents = plan.snapshot.base_discount_cents;
    args.p_boost_discount_cents = plan.snapshot.boost_discount_cents;
    args.p_total_discount_cents = plan.snapshot.total_discount_cents;
    args.p_eligible_subtotal_cents = plan.snapshot.eligible_subtotal_cents;
    args.p_below_minimum = plan.snapshot.below_minimum;
    args.p_tier_id = plan.snapshot.tier_id;
    args.p_boost_id = plan.snapshot.boost_id;
    args.p_locked_boost_id = plan.snapshot.locked_boost_id;
    args.p_quote_expires_at = plan.snapshot.expires_at;
  } else if (plan.snapshot) {
    args.p_sealed_discount_amount_cents = plan.snapshot.discount_amount_cents;
    args.p_sealed_min_spend_cents = plan.snapshot.min_spend_cents;
  }

  const { data, error } = await port.record(args);
  if (error) return { status: 'unavailable' };
  const body = asRecord(data);
  if (!body || typeof body.status !== 'string' || !RPC_STATUSES.has(body.status)) {
    return { status: 'unavailable' };
  }
  const status = body.status;
  if (status === 'created' || status === 'already_settled') {
    const snapshot = asRecord(body.snapshot ?? null);
    const recorded = snapshot ? recordedBoostSettlementFromRow(rowFromSnapshot(snapshot)) : null;
    if (!recorded) return { status: 'unavailable' };
    return { status, recorded };
  }
  if (
    status === 'not_found' ||
    status === 'not_verified' ||
    status === 'quote_already_consumed' ||
    status === 'invalid_snapshot'
  ) {
    return { status };
  }
  return { status: 'unavailable' };
}

export function createSupabaseSettlementStore(admin: Admin = getSupabaseAdmin()): SettlementStorePort {
  return {
    async record(args) {
      const { data, error } = await admin.rpc('record_boost_settlement', args);
      return { data, error };
    },
    async load(redemptionId) {
      const { data, error } = await admin
        .from('redemptions')
        .select(SETTLEMENT_COLUMNS)
        .eq('id', redemptionId)
        .maybeSingle();
      if (error || !data) return null;
      return data;
    },
  };
}
