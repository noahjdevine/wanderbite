import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ArrivalItemRecord,
  ArrivalQuoteRecord,
  ArrivalSessionRecord,
  OpenSessionByItemResult,
} from '@/lib/boost/arrival-store';
import {
  memberQrConfirmedDiscountLabel,
  persistVerifiedBoostConfirmation,
  savingsViewFromPlan,
  toConfirmationQuote,
  type VisitConfirmationLoad,
} from '@/lib/boost/confirm-visit';
import type { BoostConfirmationPlan } from '@/lib/boost/confirm';
import type {
  RecordBoostSettlementArgs,
  SettlementStorePort,
  StoredRedemptionSettlement,
} from '@/lib/boost/settlement-store';
import type { SealedBase } from '@/lib/offers/sealed-base';

const ITEM = '44444444-4444-4444-8444-444444444444';
const REDEMPTION = '11111111-1111-4111-8111-111111111111';
const SESSION = '55555555-5555-4555-8555-555555555555';
const QUOTE = '22222222-2222-4222-8222-222222222222';
const VERSION = '77777777-7777-4777-8777-777777777777';
const RESTAURANT = '50000000-0000-4000-8000-000000000001';
const EXPIRES = '2026-11-08T22:00:00.000Z';
const NOW = new Date('2026-11-08T18:05:00.000Z');
const SEALED: SealedBase = { discount_amount_cents: 1500, min_spend_cents: 4000 };

function item(deadline: string | null = '2026-12-31T00:00:00.000Z'): ArrivalItemRecord {
  return {
    id: ITEM,
    restaurantId: RESTAURANT,
    status: 'assigned',
    offerVersionId: VERSION,
    redemptionDeadline: deadline,
  };
}

function session(): ArrivalSessionRecord {
  return {
    id: SESSION,
    restaurantId: RESTAURANT,
    challengeItemId: ITEM,
    offerVersionId: VERSION,
    redemptionId: null,
    lockedBoostId: 'boost-5',
    arrivalAt: '2026-11-08T17:00:00.000Z',
    expiresAt: EXPIRES,
    idempotencyKey: `e07-member-geo:${ITEM}`,
    status: 'open',
  };
}

function quote(overrides: Partial<ArrivalQuoteRecord> = {}): ArrivalQuoteRecord {
  return {
    id: QUOTE,
    sessionId: SESSION,
    quoteVersion: 2,
    offerVersionId: VERSION,
    tierId: 'threshold:8000',
    baseDiscountCents: 2000,
    boostId: 'boost-5',
    boostDiscountCents: 500,
    totalDiscountCents: 2500,
    eligibleSubtotalCents: 8200,
    belowMinimum: false,
    reasons: ['quoted', 'boost_applied'],
    expiresAt: EXPIRES,
    supersededAt: null,
    ...overrides,
  };
}

function placeholderQuote(): ArrivalQuoteRecord {
  return quote({
    baseDiscountCents: 0,
    boostDiscountCents: 0,
    totalDiscountCents: 0,
    eligibleSubtotalCents: 0,
    belowMinimum: true,
    reasons: ['below_minimum'],
    tierId: null,
    boostId: null,
  });
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

function memorySettlement(options?: { error?: boolean; initial?: StoredRedemptionSettlement | null }) {
  let row = options?.initial ?? null;
  const records: RecordBoostSettlementArgs[] = [];
  const port: SettlementStorePort = {
    async load() {
      return row;
    },
    async record(args) {
      records.push(args);
      if (options?.error) return { data: null, error: { message: 'record_boost_settlement missing' } };
      if (row?.settlement_kind) {
        return { data: { status: 'already_settled', snapshot: row }, error: null };
      }
      const snapshot = snapshotFromArgs(args);
      row = snapshot;
      return { data: { status: 'created', snapshot }, error: null };
    },
  };
  return { port, records };
}

function arrival(options: {
  item?: ArrivalItemRecord | null;
  open?: OpenSessionByItemResult;
  active?: ArrivalQuoteRecord | null;
}) {
  const calls = { item: 0, open: 0, quote: 0 };
  return {
    calls,
    arrival: {
      async findItem() {
        calls.item += 1;
        return options.item === undefined ? item() : options.item;
      },
      async findOpenSessionByChallengeItem() {
        calls.open += 1;
        return options.open ?? { status: 'found' as const, session: session() };
      },
      async findActiveQuote() {
        calls.quote += 1;
        return options.active === undefined ? quote() : options.active;
      },
    },
  };
}

function load(partial: Partial<VisitConfirmationLoad> & { settlement: SettlementStorePort }): VisitConfirmationLoad {
  const reads = partial.arrival ? null : arrival({});
  return {
    challengeItemId: ITEM,
    redemptionId: REDEMPTION,
    now: NOW,
    sealedBase: SEALED,
    arrival: reads?.arrival,
    ...partial,
  };
}

describe('visit confirmation', () => {
  beforeEach(() => {
    vi.stubEnv('E07_ARRIVAL_SESSIONS_ENABLED', 'true');
  });

  it('omits restaurant and item on the quote', () => {
    const mapped = toConfirmationQuote(quote());
    expect('restaurantId' in mapped).toBe(false);
    expect('challengeItemId' in mapped).toBe(false);
  });

  it('writes one consume_quote snapshot from verified_at and the locked Boost', async () => {
    const store = memorySettlement();
    const reads = arrival({});
    const view = await persistVerifiedBoostConfirmation({
      ...load({ settlement: store.port, arrival: reads.arrival }),
      settledAt: NOW,
    });
    expect(view).toEqual({
      kind: 'quote',
      savings: { totalDiscountCents: 2500, baseDiscountCents: 2000, boostDiscountCents: 500 },
    });
    expect(store.records).toHaveLength(1);
    expect(store.records[0]).toMatchObject({
      p_redemption_id: REDEMPTION,
      p_settlement_kind: 'consume_quote',
      p_settled_at: NOW.toISOString(),
      p_quote_id: QUOTE,
      p_total_discount_cents: 2500,
      p_base_discount_cents: 2000,
      p_boost_discount_cents: 500,
      p_locked_boost_id: 'boost-5',
    });
    expect(reads.calls.item).toBe(1);
    expect(await memberQrConfirmedDiscountLabel(load({ settlement: store.port, arrival: reads.arrival }))).toBe(
      '$25 off',
    );
  });

  it('replays already_settled without a second write', async () => {
    const store = memorySettlement();
    const input = {
      ...load({ settlement: store.port, arrival: arrival({}).arrival }),
      settledAt: NOW,
    };
    await persistVerifiedBoostConfirmation(input);
    const first = store.records[0];
    const again = await persistVerifiedBoostConfirmation(input);
    expect(again.kind).toBe('quote');
    expect(store.records).toHaveLength(1);
    expect(store.records[0]).toBe(first);
  });

  it('writes nothing for a placeholder quote and does not show $0', async () => {
    const store = memorySettlement();
    const view = await persistVerifiedBoostConfirmation({
      ...load({
        settlement: store.port,
        arrival: arrival({ active: placeholderQuote() }).arrival,
      }),
      settledAt: NOW,
    });
    expect(view).toEqual({ kind: 'needs_subtotal' });
    expect(store.records).toHaveLength(0);
    expect(await memberQrConfirmedDiscountLabel(load({
      settlement: store.port,
      arrival: arrival({ active: placeholderQuote() }).arrival,
    }))).toBeNull();
  });

  it('writes nothing when the visit deadline is already past', async () => {
    const store = memorySettlement();
    const view = await persistVerifiedBoostConfirmation({
      ...load({
        settlement: store.port,
        arrival: arrival({ item: item('2020-01-01T00:00:00.000Z') }).arrival,
      }),
      settledAt: NOW,
    });
    expect(view).toEqual({ kind: 'hidden' });
    expect(store.records).toHaveLength(0);
  });

  it('passes a stored null deadline and can consume', async () => {
    const store = memorySettlement();
    const view = await persistVerifiedBoostConfirmation({
      ...load({
        settlement: store.port,
        arrival: arrival({ item: item(null) }).arrival,
      }),
      settledAt: NOW,
    });
    expect(view.kind).toBe('quote');
    expect(store.records[0]?.p_settlement_kind).toBe('consume_quote');
  });

  it('stores the sealed base when no open session exists and hides the amount', async () => {
    const store = memorySettlement();
    const reads = arrival({ open: { status: 'none' } });
    const view = await persistVerifiedBoostConfirmation({
      ...load({ settlement: store.port, arrival: reads.arrival }),
      settledAt: NOW,
    });
    expect(view).toEqual({ kind: 'hidden' });
    expect(reads.calls.quote).toBe(0);
    expect(store.records[0]).toMatchObject({
      p_settlement_kind: 'use_sealed_base',
      p_sealed_discount_amount_cents: 1500,
      p_sealed_min_spend_cents: 4000,
      p_quote_id: null,
    });
    expect(await memberQrConfirmedDiscountLabel(load({
      settlement: store.port,
      arrival: arrival({ open: { status: 'none' } }).arrival,
    }))).toBeNull();
  });

  it('does not write a sealed snapshot when the open-session read is unavailable', async () => {
    const store = memorySettlement();
    const view = await persistVerifiedBoostConfirmation({
      ...load({
        settlement: store.port,
        arrival: arrival({ open: { status: 'unavailable' } }).arrival,
      }),
      settledAt: NOW,
    });
    expect(view).toEqual({ kind: 'hidden' });
    expect(store.records).toHaveLength(0);
  });

  it('keeps verify able to succeed when the settlement RPC is missing', async () => {
    const store = memorySettlement({ error: true });
    const view = await persistVerifiedBoostConfirmation({
      ...load({ settlement: store.port, arrival: arrival({}).arrival }),
      settledAt: NOW,
    });
    expect(view).toEqual({ kind: 'hidden' });
    expect(store.records).toHaveLength(1);
  });

  it('does not query arrival or settlement tables when the flag is not exactly true', async () => {
    vi.stubEnv('E07_ARRIVAL_SESSIONS_ENABLED', 'false');
    const store = memorySettlement();
    const reads = arrival({});
    let queries = 0;
    const count = async () => {
      queries += 1;
      return null;
    };
    reads.arrival.findItem = count;
    reads.arrival.findOpenSessionByChallengeItem = async () => {
      queries += 1;
      return { status: 'none' };
    };
    reads.arrival.findActiveQuote = count;
    store.port.load = count;
    store.port.record = async () => {
      queries += 1;
      return { data: null, error: { message: 'no' } };
    };
    const input = {
      ...load({ settlement: store.port, arrival: reads.arrival }),
      settledAt: NOW,
    };
    await expect(persistVerifiedBoostConfirmation(input)).resolves.toEqual({ kind: 'hidden' });
    await expect(memberQrConfirmedDiscountLabel(input)).resolves.toBeNull();
    expect(queries).toBe(0);
  });

  it('maps an already stored quote and hides a sealed or refused plan', () => {
    const stored: BoostConfirmationPlan = {
      ok: true,
      kind: 'already_settled',
      snapshot: {
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
      },
      progress: { kind: 'visit_verified', total_discount_cents: 2500, quote_id: QUOTE },
    };
    expect(savingsViewFromPlan(stored).kind).toBe('quote');
    expect(savingsViewFromPlan({
      ok: true,
      kind: 'already_settled',
      snapshot: SEALED,
      progress: { kind: 'visit_verified', total_discount_cents: 1500, quote_id: null },
    })).toEqual({ kind: 'hidden' });
    expect(savingsViewFromPlan({ ok: false, kind: 'past_deadline' })).toEqual({ kind: 'hidden' });
    expect(savingsViewFromPlan(null)).toEqual({ kind: 'hidden' });
  });

  it('does not quote, scan, or close a session', () => {
    const source = readFileSync(path.join(path.resolve(__dirname, '../../..'), 'src/lib/boost/confirm-visit.ts'), 'utf8');
    expect(source).not.toMatch(/quoteBoost|supersedeBoostArrivalQuote|bill-scan|member-boost-arrival|\.update\(/);
  });
});
