import { describe, expect, it } from 'vitest';
import { journeyBoostPartsFromSettlement } from '@/lib/progress/load-progress-activity';

function consumeQuote(boostCents: number, totalCents = 1000 + boostCents) {
  return {
    settlement_kind: 'consume_quote',
    settled_at: '2026-11-08T18:05:00.000Z',
    quote_id: '22222222-2222-4222-8222-222222222222',
    quote_version: 1,
    base_discount_cents: 1000,
    boost_discount_cents: boostCents,
    total_discount_cents: totalCents,
    eligible_subtotal_cents: 8000,
    below_minimum: false,
    tier_id: 'threshold:4000',
    boost_id: 'boost-1',
    locked_boost_id: 'boost-1',
    quote_expires_at: '2026-11-08T22:00:00.000Z',
    sealed_discount_amount_cents: null,
    sealed_min_spend_cents: null,
  };
}

describe('journey boost parts from stored settlement', () => {
  it('keeps the stored base and Boost and ignores a mismatched total', () => {
    expect(journeyBoostPartsFromSettlement(consumeQuote(500, 9999))).toEqual({
      baseDiscountCents: 1000,
      boostDiscountCents: 500,
    });
  });

  it('adds nothing for a zero Boost, a sealed snapshot, or an empty row', () => {
    expect(journeyBoostPartsFromSettlement(consumeQuote(0, 1000))).toBeNull();
    expect(
      journeyBoostPartsFromSettlement({
        settlement_kind: 'use_sealed_base',
        settled_at: '2026-11-08T18:05:00.000Z',
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
        sealed_discount_amount_cents: 1000,
        sealed_min_spend_cents: 4000,
      }),
    ).toBeNull();
    expect(journeyBoostPartsFromSettlement(null)).toBeNull();
  });
});
