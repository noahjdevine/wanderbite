import 'server-only';

import {
  createSupabaseArrivalStore,
  type ArrivalQuoteRecord,
  type ArrivalSessionRecord,
  type ArrivalStore,
} from '@/lib/boost/arrival-store';
import {
  planBoostConfirmation,
  type BoostConfirmationPlan,
  type BoostConfirmationQuote,
  type BoostConfirmationSession,
  type BoostQuoteSavings,
} from '@/lib/boost/confirm';
import { arrivalSessionsEnabled } from '@/lib/boost/flag';
import {
  createSupabaseSettlementStore,
  persistBoostSettlement,
  readRecordedBoostSettlement,
  type PersistBoostSettlementResult,
  type SettlementStorePort,
} from '@/lib/boost/settlement-store';
import type { SealedBase } from '@/lib/offers/sealed-base';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  qrLabelForView,
  type BoostSavingsView,
  type ConfirmedQuoteSavings,
} from '@/lib/boost/savings-copy';

type ArrivalRead = Pick<ArrivalStore, 'findItem' | 'findOpenSessionByChallengeItem' | 'findActiveQuote'>;

export type VisitConfirmationLoad = {
  challengeItemId: string;
  redemptionId: string;
  now: Date;
  sealedBase: SealedBase | null;
  arrival?: ArrivalRead;
  settlement?: SettlementStorePort;
};

function reads(input: VisitConfirmationLoad): {
  arrival: ArrivalRead;
  settlement: SettlementStorePort;
} {
  if (input.arrival && input.settlement) {
    return { arrival: input.arrival, settlement: input.settlement };
  }
  const admin = getSupabaseAdmin();
  return {
    arrival: input.arrival ?? createSupabaseArrivalStore(admin),
    settlement: input.settlement ?? createSupabaseSettlementStore(admin),
  };
}

/**
 * A stored null deadline is passed as null. An unreadable string stays an
 * invalid Date so the planner can refuse it. This does not invent a deadline.
 */
export function deadlineInstant(value: string | null): Date | null {
  if (value == null) return null;
  return new Date(value);
}

export function toConfirmationSession(session: ArrivalSessionRecord): BoostConfirmationSession {
  return {
    id: session.id,
    status: session.status,
    expiresAt: session.expiresAt,
    lockedBoostId: session.lockedBoostId,
    challengeItemId: session.challengeItemId,
    restaurantId: session.restaurantId,
    offerVersionId: session.offerVersionId,
  };
}

/**
 * `boost_quotes` has no restaurant or challenge-item column. Those fields stay
 * omitted so a missing value is unknown, not a mismatch.
 */
export function toConfirmationQuote(quote: ArrivalQuoteRecord): BoostConfirmationQuote {
  return {
    id: quote.id,
    sessionId: quote.sessionId,
    offerVersionId: quote.offerVersionId,
    quoteVersion: quote.quoteVersion,
    baseDiscountCents: quote.baseDiscountCents,
    boostDiscountCents: quote.boostDiscountCents,
    totalDiscountCents: quote.totalDiscountCents,
    eligibleSubtotalCents: quote.eligibleSubtotalCents,
    belowMinimum: quote.belowMinimum,
    tierId: quote.tierId,
    boostId: quote.boostId,
    expiresAt: quote.expiresAt,
    supersededAt: quote.supersededAt,
  };
}

function quoteSavings(snapshot: BoostQuoteSavings): ConfirmedQuoteSavings {
  return {
    totalDiscountCents: snapshot.total_discount_cents,
    baseDiscountCents: snapshot.base_discount_cents,
    boostDiscountCents: snapshot.boost_discount_cents,
  };
}

/** Live plan, including an already-stored quote snapshot. */
export function savingsViewFromPlan(plan: BoostConfirmationPlan | null): BoostSavingsView {
  if (!plan?.ok) return { kind: 'hidden' };
  if (plan.kind === 'consume_quote') return { kind: 'quote', savings: quoteSavings(plan.snapshot) };
  if (plan.kind === 'already_settled' && plan.snapshot && 'quote_id' in plan.snapshot) {
    return { kind: 'quote', savings: quoteSavings(plan.snapshot) };
  }
  if (plan.kind === 'needs_subtotal') return { kind: 'needs_subtotal' };
  return { kind: 'hidden' };
}

/**
 * Partner redeem shows a quote only after `created` or `already_settled`.
 * A write that did not land does not invent a dollar amount.
 */
export function savingsViewAfterPersist(
  persisted: PersistBoostSettlementResult,
): BoostSavingsView {
  if (persisted.status === 'created' || persisted.status === 'already_settled') {
    const snapshot = persisted.recorded.snapshot;
    if (snapshot && 'quote_id' in snapshot) return { kind: 'quote', savings: quoteSavings(snapshot) };
    return { kind: 'hidden' };
  }
  if (persisted.status === 'not_writable' && persisted.kind === 'needs_subtotal') {
    return { kind: 'needs_subtotal' };
  }
  return { kind: 'hidden' };
}

/**
 * Load the real visit deadline, the open session for this item, its active
 * quote, and any recorded settlement. Flag off returns before any read.
 * A missing item or an unreadable session returns null and does not plan
 * with a deadline that was never loaded.
 */
export async function loadVisitPlan(input: VisitConfirmationLoad): Promise<BoostConfirmationPlan | null> {
  if (!arrivalSessionsEnabled()) return null;
  const { arrival, settlement } = reads(input);
  const [item, open, recorded] = await Promise.all([
    arrival.findItem(input.challengeItemId),
    arrival.findOpenSessionByChallengeItem(input.challengeItemId),
    readRecordedBoostSettlement(input.redemptionId, settlement),
  ]);
  if (!item || open.status === 'unavailable') return null;
  const session = open.status === 'found' ? open.session : null;
  const quote = session ? await arrival.findActiveQuote(session.id) : null;
  return planBoostConfirmation({
    now: input.now,
    redemptionDeadline: deadlineInstant(item.redemptionDeadline),
    session: session ? toConfirmationSession(session) : null,
    quote: quote ? toConfirmationQuote(quote) : null,
    sealedBase: input.sealedBase,
    recorded,
  });
}

/** Member QR. Does not persist, close a session, or set `redemption_id`. */
export async function memberQrConfirmedDiscountLabel(input: VisitConfirmationLoad): Promise<string | null> {
  try {
    const plan = await loadVisitPlan(input);
    return qrLabelForView(savingsViewFromPlan(plan));
  } catch {
    return null;
  }
}

/**
 * After a successful claim. Persist failure, `not_writable`, and `unavailable`
 * return a view and do not throw. The caller keeps the verify success.
 */
export async function persistVerifiedBoostConfirmation(
  input: VisitConfirmationLoad & { settledAt: Date },
): Promise<BoostSavingsView> {
  if (!arrivalSessionsEnabled()) return { kind: 'hidden' };
  try {
    const plan = await loadVisitPlan(input);
    if (!plan) return { kind: 'hidden' };
    const { settlement } = reads(input);
    const persisted = await persistBoostSettlement(input.redemptionId, plan, settlement, {
      settledAt: input.settledAt,
    });
    return savingsViewAfterPersist(persisted);
  } catch {
    return { kind: 'hidden' };
  }
}
