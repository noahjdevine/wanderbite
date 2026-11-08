import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOOST_CONFIRMATION_REFUSALS, type BoostConfirmationPlan, type BoostQuoteSavings } from '@/lib/boost/confirm';
import type { SealedBase } from '@/lib/offers/sealed-base';
import {
  persistBoostSettlement,
  readRecordedBoostSettlement,
  type RecordBoostSettlementArgs,
  type SettlementStorePort,
  type StoredRedemptionSettlement,
} from '@/lib/boost/settlement-store';

const ROOT = path.resolve(__dirname, '../../..');
const REDEMPTION = '11111111-1111-4111-8111-111111111111';
const QUOTE = '22222222-2222-4222-8222-222222222222';
const SETTLED_AT = new Date('2026-11-08T18:05:00.000Z');
const EXPIRES = '2026-11-08T22:00:00.000Z';

const SAVINGS: BoostQuoteSavings = {
  quote_id: QUOTE,
  quote_version: 2,
  base_discount_cents: 2000,
  boost_discount_cents: 500,
  total_discount_cents: 2500,
  eligible_subtotal_cents: 8200,
  below_minimum: false,
  tier_id: 'threshold:8000',
  boost_id: 'boost-5',
  locked_boost_id: 'boost-5',
  expires_at: EXPIRES,
};

const SEALED: SealedBase = { discount_amount_cents: 1000, min_spend_cents: 4000 };

function consumePlan(snapshot: BoostQuoteSavings = SAVINGS): BoostConfirmationPlan {
  return {
    ok: true,
    kind: 'consume_quote',
    snapshot,
    progress: {
      kind: 'visit_verified',
      total_discount_cents: snapshot.total_discount_cents,
      quote_id: snapshot.quote_id,
    },
  };
}

function sealedPlan(snapshot: SealedBase | null): BoostConfirmationPlan {
  return {
    ok: true,
    kind: 'use_sealed_base',
    reason: 'no_session',
    snapshot,
    progress: {
      kind: 'visit_verified',
      total_discount_cents: snapshot?.discount_amount_cents ?? null,
      quote_id: null,
    },
  };
}

function emptyRow(overrides: Partial<StoredRedemptionSettlement> = {}): StoredRedemptionSettlement {
  return {
    settlement_kind: null,
    settled_at: null,
    quote_id: null,
    quote_version: null,
    base_discount_cents: null,
    boost_discount_cents: null,
    total_discount_cents: null,
    eligible_subtotal_cents: null,
    below_minimum: null,
    tier_id: null,
    boost_id: null,
    locked_boost_id: null,
    quote_expires_at: null,
    sealed_discount_amount_cents: null,
    sealed_min_spend_cents: null,
    ...overrides,
  };
}

function snapshotFromArgs(args: RecordBoostSettlementArgs) {
  return {
    settlement_kind: args.p_settlement_kind,
    settled_at: args.p_settled_at,
    quote_id: args.p_quote_id,
    quote_version: args.p_quote_version,
    base_discount_cents: args.p_base_discount_cents,
    boost_discount_cents: args.p_boost_discount_cents,
    total_discount_cents: args.p_total_discount_cents,
    eligible_subtotal_cents: args.p_eligible_subtotal_cents,
    below_minimum: args.p_below_minimum,
    tier_id: args.p_tier_id,
    boost_id: args.p_boost_id,
    locked_boost_id: args.p_locked_boost_id,
    quote_expires_at: args.p_quote_expires_at,
    sealed_discount_amount_cents: args.p_sealed_discount_amount_cents,
    sealed_min_spend_cents: args.p_sealed_min_spend_cents,
  };
}

function port(options?: {
  status?: string;
  row?: StoredRedemptionSettlement | null;
  error?: boolean;
}): SettlementStorePort & { records: RecordBoostSettlementArgs[]; loads: number } {
  const state = {
    records: [] as RecordBoostSettlementArgs[],
    loads: 0,
    stored: null as ReturnType<typeof snapshotFromArgs> | null,
    async record(args: RecordBoostSettlementArgs) {
      state.records.push(args);
      if (options?.error) return { data: null, error: { message: 'db down' } };
      if (options?.status && options.status !== 'created') {
        return { data: { status: options.status }, error: null };
      }
      if (state.stored) {
        return { data: { status: 'already_settled', snapshot: state.stored }, error: null };
      }
      state.stored = snapshotFromArgs(args);
      return { data: { status: 'created', snapshot: state.stored }, error: null };
    },
    async load() {
      state.loads += 1;
      return options?.row === undefined ? null : options.row;
    },
  };
  return state;
}

describe('persistBoostSettlement', () => {
  it('writes a consume_quote snapshot once and replays the stored cents', async () => {
    const store = port();
    const created = await persistBoostSettlement(REDEMPTION, consumePlan(), store, { settledAt: SETTLED_AT });
    expect(created).toEqual({
      status: 'created',
      recorded: { snapshot: SAVINGS },
    });
    expect(store.records).toHaveLength(1);
    expect(store.records[0]).toMatchObject({
      p_redemption_id: REDEMPTION,
      p_settlement_kind: 'consume_quote',
      p_settled_at: '2026-11-08T18:05:00.000Z',
      p_quote_id: QUOTE,
      p_locked_boost_id: 'boost-5',
      p_quote_expires_at: EXPIRES,
      p_sealed_discount_amount_cents: null,
      p_sealed_min_spend_cents: null,
    });
    expect(store.loads).toBe(0);

    const again = await persistBoostSettlement(
      REDEMPTION,
      consumePlan({ ...SAVINGS, total_discount_cents: 1, locked_boost_id: 'other' }),
      store,
      { settledAt: new Date('2026-11-09T18:05:00.000Z') },
    );
    expect(again).toEqual({ status: 'already_settled', recorded: { snapshot: SAVINGS } });
    expect(store.records).toHaveLength(2);
  });

  it('stores a sealed tier and a null sealed miss', async () => {
    const tier = port();
    const stored = await persistBoostSettlement(REDEMPTION, sealedPlan(SEALED), tier, { settledAt: SETTLED_AT });
    expect(stored).toEqual({
      status: 'created',
      recorded: { snapshot: SEALED },
    });
    expect(tier.records[0]).toMatchObject({
      p_settlement_kind: 'use_sealed_base',
      p_quote_id: null,
      p_locked_boost_id: null,
      p_base_discount_cents: null,
      p_sealed_discount_amount_cents: 1000,
      p_sealed_min_spend_cents: 4000,
    });

    const missStore = port();
    const miss = await persistBoostSettlement(REDEMPTION, sealedPlan(null), missStore, { settledAt: SETTLED_AT });
    expect(miss).toEqual({ status: 'created', recorded: { snapshot: null } });
    expect(missStore.records[0].p_sealed_discount_amount_cents).toBeNull();
    expect(missStore.records[0].p_sealed_min_spend_cents).toBeNull();
  });

  it('does not write needs_subtotal or a planner refusal', async () => {
    const store = port();
    const needs: BoostConfirmationPlan = { ok: true, kind: 'needs_subtotal' };
    expect(await persistBoostSettlement(REDEMPTION, needs, store)).toEqual({
      status: 'not_writable',
      kind: 'needs_subtotal',
    });
    for (const kind of BOOST_CONFIRMATION_REFUSALS) {
      const refusal: BoostConfirmationPlan = { ok: false, kind };
      expect(await persistBoostSettlement(REDEMPTION, refusal, store)).toEqual({
        status: 'not_writable',
        kind,
      });
    }
    expect(store.records).toHaveLength(0);
    expect(store.loads).toBe(0);
  });

  it('reads an already settled row and does not call the write', async () => {
    const store = port({
      row: emptyRow({
        settlement_kind: 'consume_quote',
        settled_at: '2026-11-08T18:05:00.000Z',
        quote_id: QUOTE,
        quote_version: 2,
        base_discount_cents: 2000,
        boost_discount_cents: 500,
        total_discount_cents: 2500,
        eligible_subtotal_cents: 8200,
        below_minimum: false,
        tier_id: 'threshold:8000',
        boost_id: 'boost-5',
        locked_boost_id: 'boost-5',
        quote_expires_at: EXPIRES,
      }),
    });
    const plan: BoostConfirmationPlan = {
      ok: true,
      kind: 'already_settled',
      snapshot: { ...SAVINGS, total_discount_cents: 1 },
      progress: { kind: 'visit_verified', total_discount_cents: 1, quote_id: QUOTE },
    };
    expect(await persistBoostSettlement(REDEMPTION, plan, store)).toEqual({
      status: 'already_settled',
      recorded: { snapshot: SAVINGS },
    });
    expect(store.records).toHaveLength(0);
    expect(store.loads).toBe(1);

    const miss = port({
      row: emptyRow({
        settlement_kind: 'use_sealed_base',
        settled_at: '2026-11-08T18:05:00.000Z',
      }),
    });
    const replay: BoostConfirmationPlan = {
      ok: true,
      kind: 'already_settled',
      snapshot: null,
      progress: { kind: 'visit_verified', total_discount_cents: null, quote_id: null },
    };
    expect(await persistBoostSettlement(REDEMPTION, replay, miss)).toEqual({
      status: 'already_settled',
      recorded: { snapshot: null },
    });
    expect(miss.records).toHaveLength(0);
  });

  it('passes through not_verified, quote_already_consumed, and a write error', async () => {
    const unverified = port({ status: 'not_verified' });
    expect(await persistBoostSettlement(REDEMPTION, consumePlan(), unverified)).toEqual({
      status: 'not_verified',
    });
    const consumed = port({ status: 'quote_already_consumed' });
    expect(await persistBoostSettlement(REDEMPTION, consumePlan(), consumed)).toEqual({
      status: 'quote_already_consumed',
    });
    const down = port({ error: true });
    expect(await persistBoostSettlement(REDEMPTION, sealedPlan(SEALED), down)).toEqual({
      status: 'unavailable',
    });
  });
});

describe('readRecordedBoostSettlement', () => {
  it('maps a quote, a sealed tier, a sealed miss, and an unsettled row', async () => {
    const quote = await readRecordedBoostSettlement(REDEMPTION, {
      async load() {
        return emptyRow({
          settlement_kind: 'consume_quote',
          settled_at: '2026-11-08T18:05:00.000Z',
          quote_id: QUOTE,
          quote_version: 2,
          base_discount_cents: 2000,
          boost_discount_cents: 500,
          total_discount_cents: 2500,
          eligible_subtotal_cents: 8200,
          below_minimum: false,
          tier_id: 'threshold:8000',
          boost_id: 'boost-5',
          locked_boost_id: 'boost-5',
          quote_expires_at: EXPIRES,
        });
      },
    });
    expect(quote).toEqual({ snapshot: SAVINGS });

    const sealed = await readRecordedBoostSettlement(REDEMPTION, {
      async load() {
        return emptyRow({
          settlement_kind: 'use_sealed_base',
          settled_at: '2026-11-08T18:05:00.000Z',
          sealed_discount_amount_cents: 1000,
          sealed_min_spend_cents: 4000,
        });
      },
    });
    expect(sealed).toEqual({ snapshot: SEALED });
    expect(sealed?.snapshot && 'quote_id' in sealed.snapshot).toBe(false);

    const miss = await readRecordedBoostSettlement(REDEMPTION, {
      async load() {
        return emptyRow({
          settlement_kind: 'use_sealed_base',
          settled_at: '2026-11-08T18:05:00.000Z',
        });
      },
    });
    expect(miss).toEqual({ snapshot: null });

    const unsettled = await readRecordedBoostSettlement(REDEMPTION, {
      async load() {
        return emptyRow();
      },
    });
    expect(unsettled).toBeNull();
    expect(await readRecordedBoostSettlement(REDEMPTION, { async load() { return null; } })).toBeNull();
  });
});

describe('settlement store stays unused', () => {
  it('is not imported from src/app or the verify SQL', () => {
    const source = readFileSync(path.join(ROOT, 'src/lib/boost/settlement-store.ts'), 'utf8');
    expect(source.startsWith("import 'server-only';")).toBe(true);
    expect(source).not.toMatch(/planBoostConfirmation\s*\(|\bquoteBoost\s*\(|supersedeBoostQuote\s*\(|verify_redemption|from 'next|src\/app/);
    const allowed = new Set([
      'src/lib/boost/settlement-store.ts',
      'src/lib/boost/settlement-store.test.ts',
      'src/lib/boost/confirm.test.ts',
      'src/types/database.types.ts',
      'src/lib/schema-contract.ts',
    ]);
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name === 'node_modules' || name === '.next') continue;
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx|sql)$/.test(name)) continue;
        const rel = path.relative(ROOT, full);
        if (allowed.has(rel)) continue;
        const text = readFileSync(full, 'utf8');
        if (
          text.includes('settlement-store') ||
          text.includes('record_boost_settlement') ||
          text.includes('persistBoostSettlement') ||
          text.includes('readRecordedBoostSettlement')
        ) {
          hits.push(rel);
        }
      }
    };
    walk(path.join(ROOT, 'src'));
    for (const file of [
      'supabase/migrations/20260907174245_redemptions_verify_rpc.sql',
      'supabase/migrations/20260925175518_e02_capacity_binding.sql',
      'supabase/migrations/20260925215534_e02_b_credit_ledger.sql',
    ]) {
      expect(readFileSync(path.join(ROOT, file), 'utf8')).not.toContain('settlement_kind');
    }
    expect(hits).toEqual([]);
  });
});
