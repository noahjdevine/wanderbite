import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  planBoostConfirmation,
  type BoostConfirmationQuote,
  type BoostConfirmationSession,
  type BoostQuoteSavings,
} from '@/lib/boost/confirm';
import type { SealedBase } from '@/lib/offers/sealed-base';

const ROOT = path.resolve(__dirname, '../../..');

const NOW = new Date('2026-11-08T18:00:00.000Z');
const DEADLINE = new Date('2026-11-20T18:00:00.000Z');
const EXPIRES = '2026-11-08T22:00:00.000Z';

const SEALED: SealedBase = { discount_amount_cents: 1000, min_spend_cents: 4000 };

function session(overrides: Partial<BoostConfirmationSession> = {}): BoostConfirmationSession {
  return {
    id: 'session-1',
    status: 'open',
    expiresAt: EXPIRES,
    lockedBoostId: 'boost-5',
    challengeItemId: 'item-1',
    restaurantId: 'restaurant-1',
    offerVersionId: 'version-1',
    ...overrides,
  };
}

function quote(overrides: Partial<BoostConfirmationQuote> = {}): BoostConfirmationQuote {
  return {
    id: 'quote-1',
    sessionId: 'session-1',
    offerVersionId: 'version-1',
    quoteVersion: 2,
    baseDiscountCents: 2000,
    boostDiscountCents: 500,
    totalDiscountCents: 2500,
    eligibleSubtotalCents: 8200,
    belowMinimum: false,
    tierId: 'threshold:8000',
    boostId: 'boost-5',
    expiresAt: EXPIRES,
    supersededAt: null,
    ...overrides,
  };
}

function plan(overrides: Partial<Parameters<typeof planBoostConfirmation>[0]> = {}) {
  return planBoostConfirmation({
    now: NOW,
    redemptionDeadline: DEADLINE,
    session: session(),
    quote: quote(),
    sealedBase: SEALED,
    ...overrides,
  });
}

describe('planBoostConfirmation', () => {
  it('uses the sealed lowest tier when there is no arrival session', () => {
    const result = plan({ session: null, quote: null });
    expect(result).toEqual({
      ok: true,
      kind: 'use_sealed_base',
      reason: 'no_session',
      snapshot: SEALED,
      progress: { kind: 'visit_verified', total_discount_cents: 1000, quote_id: null },
    });
    if (result.kind !== 'use_sealed_base') return;
    expect(result.snapshot).toBe(SEALED);
    expect(result.progress.quote_id).toBeNull();
  });

  it('does not invent the 1000-cent display fallback when no sealed tier exists', () => {
    const result = plan({ session: null, quote: quote(), sealedBase: null });
    expect(result.kind).toBe('use_sealed_base');
    if (result.kind !== 'use_sealed_base') return;
    expect(result.snapshot).toBeNull();
    expect(result.progress).toEqual({
      kind: 'visit_verified',
      total_discount_cents: null,
      quote_id: null,
    });
  });

  it('asks for a staff subtotal when the active quote is the $0 placeholder', () => {
    const zero = quote({
      quoteVersion: 1,
      baseDiscountCents: 0,
      boostDiscountCents: 0,
      totalDiscountCents: 0,
      eligibleSubtotalCents: 0,
      belowMinimum: true,
      tierId: null,
      boostId: null,
    });
    const member = plan({ quote: zero, session: session({ lockedBoostId: 'boost-5' }) });
    const partner = plan({ quote: zero, session: session({ lockedBoostId: null }) });
    expect(member).toEqual({ ok: true, kind: 'needs_subtotal' });
    expect(partner).toEqual({ ok: true, kind: 'needs_subtotal' });
    expect(JSON.stringify(member)).not.toMatch(/discount_amount_cents|total_discount_cents|1000/);
  });

  it('treats eligible subtotal 0 as the placeholder even when below_minimum is false', () => {
    const result = plan({
      quote: quote({
        quoteVersion: 1,
        baseDiscountCents: 0,
        boostDiscountCents: 0,
        totalDiscountCents: 0,
        eligibleSubtotalCents: 0,
        belowMinimum: false,
        tierId: null,
        boostId: null,
      }),
    });
    expect(result.kind).toBe('needs_subtotal');
  });

  it('consumes a below-minimum quote once staff confirmed a positive subtotal', () => {
    const result = plan({
      quote: quote({
        baseDiscountCents: 0,
        boostDiscountCents: 0,
        totalDiscountCents: 0,
        eligibleSubtotalCents: 500,
        belowMinimum: true,
        tierId: null,
        boostId: null,
      }),
    });
    expect(result.kind).toBe('consume_quote');
    if (result.kind !== 'consume_quote') return;
    expect(result.snapshot.eligible_subtotal_cents).toBe(500);
    expect(result.snapshot.total_discount_cents).toBe(0);
    expect(result.snapshot.below_minimum).toBe(true);
    expect(result.snapshot.locked_boost_id).toBe('boost-5');
  });

  it('copies the active quote, including the session lock, when the parts sum', () => {
    const open = session();
    const active = quote();
    const result = plan({ session: open, quote: active });
    expect(result.ok).toBe(true);
    if (result.kind !== 'consume_quote') return;
    const snapshot: BoostQuoteSavings = {
      quote_id: 'quote-1',
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
    expect(result.snapshot).toEqual(snapshot);
    expect(result.progress).toEqual({
      kind: 'visit_verified',
      total_discount_cents: 2500,
      quote_id: 'quote-1',
    });
    expect(open.expiresAt).toBe(EXPIRES);
  });

  it('still consumes a locked Boost after the session window and before the visit deadline', () => {
    const result = plan({
      now: new Date('2026-11-08T23:00:00.000Z'),
      session: session({
        expiresAt: '2026-11-08T22:00:00.000Z',
        lockedBoostId: 'boost-5',
      }),
      quote: quote({ expiresAt: '2026-11-08T22:00:00.000Z' }),
    });
    expect(result.kind).toBe('consume_quote');
    if (result.kind !== 'consume_quote') return;
    expect(result.snapshot.locked_boost_id).toBe('boost-5');
    expect(result.snapshot.boost_discount_cents).toBe(500);
    expect(result.snapshot.expires_at).toBe('2026-11-08T22:00:00.000Z');
  });

  it('still asks for a subtotal when the placeholder outlives the session window', () => {
    const result = plan({
      now: new Date('2026-11-08T23:00:00.000Z'),
      session: session({ expiresAt: '2026-11-08T22:00:00.000Z', lockedBoostId: 'boost-5' }),
      quote: quote({
        quoteVersion: 1,
        baseDiscountCents: 0,
        boostDiscountCents: 0,
        totalDiscountCents: 0,
        eligibleSubtotalCents: 0,
        belowMinimum: true,
        tierId: null,
        boostId: null,
        expiresAt: '2026-11-08T22:00:00.000Z',
      }),
    });
    expect(result.kind).toBe('needs_subtotal');
  });

  it('does not refuse an unlocked quote only because the session window has passed', () => {
    const result = plan({
      now: new Date('2026-11-08T23:00:00.000Z'),
      session: session({ expiresAt: '2026-11-08T22:00:00.000Z', lockedBoostId: null }),
      quote: quote({
        boostId: null,
        boostDiscountCents: 0,
        totalDiscountCents: 2000,
        expiresAt: '2026-11-08T22:00:00.000Z',
      }),
    });
    expect(result.kind).toBe('consume_quote');
    if (result.kind !== 'consume_quote') return;
    expect(result.snapshot.locked_boost_id).toBeNull();
    expect(result.snapshot.total_discount_cents).toBe(2000);
  });

  it('refuses at the visit deadline and after it', () => {
    expect(plan({ now: DEADLINE }).kind).toBe('past_deadline');
    expect(plan({ now: new Date(DEADLINE.getTime() + 1) }).kind).toBe('past_deadline');
    expect(plan({ now: new Date(DEADLINE.getTime() - 1) }).kind).toBe('consume_quote');
  });

  it('compares fall-back 1:30 AM deadlines as ISO instants, not a clock face', () => {
    const firstOneThirty = new Date('2026-11-01T06:30:00.000Z');
    const secondOneThirty = new Date('2026-11-01T07:30:00.000Z');
    const duringFirst = plan({ now: firstOneThirty, redemptionDeadline: secondOneThirty });
    const atSecond = plan({ now: secondOneThirty, redemptionDeadline: secondOneThirty });
    const afterFirstDeadline = plan({ now: secondOneThirty, redemptionDeadline: firstOneThirty });
    expect(duringFirst.kind).toBe('consume_quote');
    expect(atSecond.kind).toBe('past_deadline');
    expect(afterFirstDeadline.kind).toBe('past_deadline');
  });

  it('allows a null visit deadline without inventing one', () => {
    expect(plan({ redemptionDeadline: null }).kind).toBe('consume_quote');
  });

  it('returns a recorded snapshot unchanged and does not apply a second discount', () => {
    const first = plan();
    expect(first.kind).toBe('consume_quote');
    if (first.kind !== 'consume_quote') return;
    const again = plan({
      now: new Date(DEADLINE.getTime() + 60_000),
      session: session({ status: 'closed' }),
      quote: quote({
        id: 'quote-2',
        totalDiscountCents: 9999,
        baseDiscountCents: 9999,
        boostDiscountCents: 0,
        eligibleSubtotalCents: 9999,
      }),
      sealedBase: { discount_amount_cents: 1000, min_spend_cents: 4000 },
      recorded: { snapshot: first.snapshot },
    });
    expect(again.kind).toBe('already_settled');
    if (again.kind !== 'already_settled') return;
    expect(again.snapshot).toBe(first.snapshot);
    expect(again.snapshot).toEqual(first.snapshot);
    expect(again.progress.total_discount_cents).toBe(2500);
    expect(again.progress.quote_id).toBe('quote-1');
  });

  it('replays a recorded sealed snapshot, including a null sealed miss', () => {
    const sealed = plan({
      session: null,
      quote: null,
      recorded: { snapshot: SEALED },
    });
    const missed = plan({
      session: null,
      quote: null,
      sealedBase: SEALED,
      recorded: { snapshot: null },
    });
    expect(sealed.kind).toBe('already_settled');
    if (sealed.kind !== 'already_settled') return;
    expect(sealed.snapshot).toBe(SEALED);
    expect(sealed.progress).toEqual({
      kind: 'visit_verified',
      total_discount_cents: 1000,
      quote_id: null,
    });
    expect(missed.kind).toBe('already_settled');
    if (missed.kind !== 'already_settled') return;
    expect(missed.snapshot).toBeNull();
    expect(missed.progress.total_discount_cents).toBeNull();
  });

  it('refuses a superseded row or parts that do not sum', () => {
    const superseded = plan({
      quote: quote({ supersededAt: '2026-11-08T18:30:00.000Z' }),
    });
    const broken = plan({
      quote: quote({ baseDiscountCents: 2000, boostDiscountCents: 500, totalDiscountCents: 2000 }),
    });
    const negative = plan({
      quote: quote({
        baseDiscountCents: -1,
        boostDiscountCents: 0,
        totalDiscountCents: -1,
        eligibleSubtotalCents: 8200,
      }),
    });
    const overSubtotal = plan({
      quote: quote({
        baseDiscountCents: 9000,
        boostDiscountCents: 0,
        totalDiscountCents: 9000,
        eligibleSubtotalCents: 8200,
      }),
    });
    expect(superseded).toEqual({ ok: false, kind: 'invalid_quote' });
    expect(broken).toEqual({ ok: false, kind: 'invalid_quote' });
    expect(negative).toEqual({ ok: false, kind: 'invalid_quote' });
    expect(overSubtotal).toEqual({ ok: false, kind: 'invalid_quote' });
    expect(superseded.kind).not.toBe('consume_quote');
  });

  it('refuses a missing quote, a closed session, and a mismatched identity', () => {
    expect(plan({ quote: null }).kind).toBe('missing_quote');
    expect(plan({ session: session({ status: 'closed' }) }).kind).toBe('session_closed');
    expect(plan({ quote: quote({ offerVersionId: 'version-2' }) }).kind).toBe('mismatch');
    expect(plan({ quote: quote({ sessionId: 'session-2' }) }).kind).toBe('mismatch');
    expect(plan({ quote: quote({ restaurantId: 'restaurant-2' }) }).kind).toBe('mismatch');
    expect(plan({ quote: quote({ challengeItemId: 'item-2' }) }).kind).toBe('mismatch');
    expect(plan({ quote: quote({ expiresAt: '2026-11-08T21:00:00.000Z' }) }).kind).toBe('mismatch');
  });

  it('does not treat an omitted restaurant or item on the quote as a mismatch', () => {
    const result = plan({
      quote: quote({ restaurantId: undefined, challengeItemId: undefined }),
    });
    expect(result.kind).toBe('consume_quote');
  });

  it('matches expiry instants that use a different ISO spelling', () => {
    const result = plan({
      session: session({ expiresAt: '2026-11-08T22:00:00.000Z' }),
      quote: quote({ expiresAt: '2026-11-08T22:00:00Z' }),
    });
    expect(result.kind).toBe('consume_quote');
    if (result.kind !== 'consume_quote') return;
    expect(result.snapshot.expires_at).toBe('2026-11-08T22:00:00Z');
  });

  it('does not consume when the server clock or the deadline cannot be read', () => {
    expect(plan({ now: new Date(Number.NaN) }).kind).toBe('invalid_quote');
    expect(plan({ redemptionDeadline: new Date(Number.NaN) }).kind).toBe('invalid_quote');
    expect(plan({ session: null, now: new Date(Number.NaN) }).kind).toBe('use_sealed_base');
  });

  it('is unused outside this helper and its test', () => {
    const source = readFileSync(path.join(ROOT, 'src/lib/boost/confirm.ts'), 'utf8');
    expect(source).not.toMatch(/supabase|from 'next|use server|server-only|quoteBoost|supersedeBoostQuote|lowestSealedBase|getSupabaseAdmin/);
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx|sql)$/.test(name)) continue;
        if (full.endsWith(`${path.sep}confirm.ts`) || full.endsWith(`${path.sep}confirm.test.ts`)) continue;
        const text = readFileSync(full, 'utf8');
        if (
          text.includes('planBoostConfirmation') ||
          text.includes('@/lib/boost/confirm') ||
          text.includes('lib/boost/confirm')
        ) {
          hits.push(path.relative(ROOT, full));
        }
      }
    };
    walk(path.join(ROOT, 'src'));
    walk(path.join(ROOT, 'supabase'));
    expect(hits).toEqual([]);
  });
});
