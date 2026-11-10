import type { Json } from '@/types/database.types';
import { deriveVisitStatus } from '@/lib/visits/visit-status';

/**
 * Member visit-problem rules. No database and no feature-flag read.
 * Server code checks E07_VISIT_PROBLEMS_ENABLED before calling a store.
 */

export const VISIT_PROBLEM_CATEGORIES = [
  'wrong_discount',
  'offer_refused',
  'check_in_code',
  'other',
] as const;

export type VisitProblemCategory = (typeof VISIT_PROBLEM_CATEGORIES)[number];

export const VISIT_PROBLEM_CATEGORY_LABELS: Record<VisitProblemCategory, string> = {
  wrong_discount: 'Wrong discount',
  offer_refused: "Restaurant wouldn't honor offer",
  check_in_code: 'Check-in or code trouble',
  other: 'Other visit issue',
};

export const VISIT_PROBLEM_STATUSES = ['submitted', 'under_review', 'resolved'] as const;

export type VisitProblemStatus = (typeof VISIT_PROBLEM_STATUSES)[number];

export const VISIT_PROBLEM_STATUS_LABELS: Record<VisitProblemStatus, string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  resolved: 'Resolved',
};

export const VISIT_PROBLEM_TEXT_MAX = 500;

/** Corrected savings stay within this many cents. Zero is a real amount. */
export const CORRECTED_SAVINGS_MAX_CENTS = 10_000_000;

export type VisitProblemFixKind = 'savings' | 'restore';

/** Which fixes an admin may apply for a category. Other allows both. */
export function allowedVisitProblemFixes(category: VisitProblemCategory): {
  savings: boolean;
  restore: boolean;
} {
  if (category === 'wrong_discount') return { savings: true, restore: false };
  if (category === 'offer_refused' || category === 'check_in_code') {
    return { savings: false, restore: true };
  }
  return { savings: true, restore: true };
}

export function parseCorrectedCents(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > CORRECTED_SAVINGS_MAX_CENTS) return null;
    return value;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^[0-9]+$/.test(text)) return null;
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed > CORRECTED_SAVINGS_MAX_CENTS) return null;
  return parsed;
}

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export function parseVisitProblemText(value: unknown, max = VISIT_PROBLEM_TEXT_MAX): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text.length < 1 || text.length > max) return null;
  if (CONTROL.test(text)) return null;
  return text;
}

export function parseVisitProblemCategory(value: unknown): VisitProblemCategory | null {
  if (typeof value !== 'string') return null;
  return (VISIT_PROBLEM_CATEGORIES as readonly string[]).includes(value)
    ? (value as VisitProblemCategory)
    : null;
}

export function parseVisitProblemStatus(value: unknown): VisitProblemStatus | null {
  if (typeof value !== 'string') return null;
  return (VISIT_PROBLEM_STATUSES as readonly string[]).includes(value)
    ? (value as VisitProblemStatus)
    : null;
}

export const REPORTABLE_ITEM_STATUSES = ['assigned', 'redeemed', 'expired'] as const;

export function isReportableItemStatus(status: string | null | undefined): boolean {
  return status === 'assigned' || status === 'redeemed' || status === 'expired';
}

export type VisitProblemCaseRow = {
  id: string;
  user_id: string;
  challenge_item_id: string;
  redemption_id: string | null;
  category: VisitProblemCategory;
  explanation: string;
  status: VisitProblemStatus;
  member_response: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Fields a member may see. No actor, audit reason, or internal metadata. */
export type MemberVisitProblem = {
  id: string;
  challengeItemId: string;
  redemptionId: string | null;
  category: VisitProblemCategory;
  categoryLabel: string;
  explanation: string;
  status: VisitProblemStatus;
  statusLabel: string;
  response: string | null;
  createdAt: string;
  updatedAt: string;
};

export function toMemberVisitProblem(row: VisitProblemCaseRow): MemberVisitProblem {
  return {
    id: row.id,
    challengeItemId: row.challenge_item_id,
    redemptionId: row.redemption_id,
    category: row.category,
    categoryLabel: VISIT_PROBLEM_CATEGORY_LABELS[row.category],
    explanation: row.explanation,
    status: row.status,
    statusLabel: VISIT_PROBLEM_STATUS_LABELS[row.status],
    response: row.member_response,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Admin queue row. `latestReason` is audit text and is not part of a member read. */
export type AdminVisitProblem = {
  id: string;
  userId: string;
  email: string | null;
  restaurantName: string;
  challengeItemId: string;
  redemptionId: string | null;
  category: VisitProblemCategory;
  categoryLabel: string;
  explanation: string;
  status: VisitProblemStatus;
  statusLabel: string;
  response: string | null;
  createdAt: string;
  latestReason: string | null;
  /** Null when this case has no savings correction. */
  savingsCorrectionCents: number | null;
  /** True when this case already granted its one make-up opportunity. */
  makeupGranted: boolean;
};

/** A member-visible make-up spot. No actor, audit reason, or case id. */
export type MemberMakeupSpot = {
  id: string;
  restaurantName: string;
  status: 'available' | 'used';
  /** False when the restaurant or offer cannot take the visit, or the spot is used. */
  bookable: boolean;
  unavailableMessage: string | null;
  /**
   * True when this spot's code is issued and the visit window is still open.
   * A verified visit, an expired code, and an available spot stay false.
   */
  codeIssued: boolean;
};

/**
 * Whether a make-up spot currently counts as an issued code.
 * Uses the same visit status Progress uses for pending codes.
 * Instants are absolute, so the process time zone does not change the result.
 */
export function makeupCodeIssued(input: {
  status: 'available' | 'used';
  redemption: { status: string | null; verifiedAt: string | null; expiresAt: string | null } | null;
  item: { status: string | null; redemptionDeadline: string | null } | null;
  now: Date;
}): boolean {
  if (input.status !== 'used' || !input.redemption?.status) return false;
  return (
    deriveVisitStatus({
      item: input.item
        ? {
            status: input.item.status ?? 'assigned',
            redemptionDeadline: input.item.redemptionDeadline,
          }
        : null,
      redemption: {
        status: input.redemption.status,
        verifiedAt: input.redemption.verifiedAt,
        expiresAt: input.redemption.expiresAt,
      },
      note: null,
      now: input.now,
    }) === 'code_issued'
  );
}

/**
 * First whole non-negative correction per redemption.
 * A later row for the same redemption is ignored. Invalid cents are skipped.
 */
export function savingsCorrectionCentsByRedemption(
  rows: readonly { redemption_id: string; corrected_cents: unknown }[] | null,
): Map<string, number> {
  const byId = new Map<string, number>();
  for (const row of rows ?? []) {
    if (!row.redemption_id || byId.has(row.redemption_id)) continue;
    if (
      typeof row.corrected_cents !== 'number' ||
      !Number.isInteger(row.corrected_cents) ||
      row.corrected_cents < 0
    ) {
      continue;
    }
    byId.set(row.redemption_id, row.corrected_cents);
  }
  return byId;
}

export const MAKEUP_RESTAURANT_CLOSED = 'This restaurant is not taking visits right now.';
export const MAKEUP_OFFER_CLOSED = 'This offer is no longer available.';
export const MAKEUP_WINDOW_CLOSED = 'This visit window has closed.';

export type MakeupOfferWindow = {
  validFrom: string;
  validUntil: string;
  withdrawnAt: string | null;
};

/**
 * Whether the member can start the make-up visit. A used spot is not bookable.
 * A paused restaurant, a withdrawn or expired offer, or a closed visit window
 * is a message instead of a code button.
 */
export function makeupSpotAvailability(input: {
  status: 'available' | 'used';
  restaurantStatus: string | null;
  offerVersionId: string | null;
  offer: MakeupOfferWindow | null;
  redemptionDeadline: string | null;
  now: Date;
}): { bookable: boolean; unavailableMessage: string | null } {
  if (input.status === 'used') return { bookable: false, unavailableMessage: null };
  if (input.restaurantStatus !== 'active') {
    return { bookable: false, unavailableMessage: MAKEUP_RESTAURANT_CLOSED };
  }
  if (input.offerVersionId) {
    const offer = input.offer;
    const from = offer ? new Date(offer.validFrom).getTime() : Number.NaN;
    const until = offer ? new Date(offer.validUntil).getTime() : Number.NaN;
    const now = input.now.getTime();
    if (
      !offer
      || offer.withdrawnAt
      || Number.isNaN(from)
      || Number.isNaN(until)
      || from > now
      || until <= now
    ) {
      return { bookable: false, unavailableMessage: MAKEUP_OFFER_CLOSED };
    }
  }
  if (input.redemptionDeadline) {
    const deadline = new Date(input.redemptionDeadline).getTime();
    if (Number.isNaN(deadline) || deadline <= input.now.getTime()) {
      return { bookable: false, unavailableMessage: MAKEUP_WINDOW_CLOSED };
    }
  }
  return { bookable: true, unavailableMessage: null };
}

export function currentMemberCase(rows: readonly VisitProblemCaseRow[]): VisitProblemCaseRow | null {
  const open = rows.find((row) => row.status === 'submitted' || row.status === 'under_review');
  if (open) return open;
  const resolved = [...rows]
    .filter((row) => row.status === 'resolved')
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  return resolved[0] ?? null;
}

export type ReviewDecision =
  | {
      ok: true;
      status: VisitProblemStatus;
      memberResponse: string | null;
      reason: string;
      action: 'visit_problem.review' | 'visit_problem.resolve';
    }
  | {
      ok: false;
      code:
        | 'invalid_status'
        | 'invalid_reason'
        | 'invalid_response'
        | 'explanation_required'
        | 'terminal'
        | 'unchanged';
    };

/**
 * Admin review rules. A resolved case stays sealed. Moving to resolved
 * requires a member-visible explanation. The reason is the audit text.
 */
export function decideVisitProblemReview(input: {
  currentStatus: VisitProblemStatus;
  currentResponse: string | null;
  nextStatus: unknown;
  memberResponse: unknown;
  reason: unknown;
}): ReviewDecision {
  if (input.currentStatus === 'resolved') return { ok: false, code: 'terminal' };

  const reason = parseVisitProblemText(input.reason);
  if (!reason) return { ok: false, code: 'invalid_reason' };

  const status = parseVisitProblemStatus(input.nextStatus);
  if (!status || (status === 'submitted' && input.currentStatus !== 'submitted')) {
    return { ok: false, code: 'invalid_status' };
  }

  let memberResponse = input.currentResponse;
  if (typeof input.memberResponse === 'string') {
    if (input.memberResponse.trim() !== '') {
      const parsed = parseVisitProblemText(input.memberResponse);
      if (!parsed) return { ok: false, code: 'invalid_response' };
      memberResponse = parsed;
    }
  } else if (input.memberResponse != null) {
    return { ok: false, code: 'invalid_response' };
  }

  if (status === 'resolved' && !memberResponse) {
    return { ok: false, code: 'explanation_required' };
  }
  if (status === input.currentStatus && memberResponse === input.currentResponse) {
    return { ok: false, code: 'unchanged' };
  }

  return {
    ok: true,
    status,
    memberResponse,
    reason,
    action: status === 'resolved' ? 'visit_problem.resolve' : 'visit_problem.review',
  };
}

export type OwnedVisit = {
  challengeItemId: string;
  itemStatus: string;
  redemptionId: string | null;
};

export type VisitLookupCode = 'not_found' | 'forbidden' | 'invalid_redemption' | 'unavailable';

export type VisitLookup =
  | { ok: true; visit: OwnedVisit }
  | { ok: false; code: VisitLookupCode };

export type VisitProblemStore = {
  lookupOwnedVisit(input: {
    userId: string;
    challengeItemId: string;
    redemptionId: string | null;
  }): Promise<VisitLookup>;
  listOwnCases(input: {
    userId: string;
    challengeItemId: string;
  }): Promise<{ ok: true; rows: VisitProblemCaseRow[] } | { ok: false; code: 'unavailable' }>;
  insertCase(input: {
    userId: string;
    challengeItemId: string;
    redemptionId: string | null;
    category: VisitProblemCategory;
    explanation: string;
  }): Promise<
    | { ok: true; row: VisitProblemCaseRow }
    | { ok: false; code: 'already_open' | 'unavailable' }
  >;
};

export type SubmitVisitProblemCode =
  | VisitLookupCode
  | 'not_reportable'
  | 'invalid_category'
  | 'invalid_explanation'
  | 'already_open';

export async function submitOwnedVisitProblem(
  store: VisitProblemStore,
  input: {
    userId: string;
    challengeItemId: string;
    redemptionId: string | null;
    category: unknown;
    explanation: unknown;
  },
): Promise<{ ok: true; problem: MemberVisitProblem } | { ok: false; code: SubmitVisitProblemCode }> {
  const category = parseVisitProblemCategory(input.category);
  if (!category) return { ok: false, code: 'invalid_category' };
  const explanation = parseVisitProblemText(input.explanation);
  if (!explanation) return { ok: false, code: 'invalid_explanation' };

  const visit = await store.lookupOwnedVisit({
    userId: input.userId,
    challengeItemId: input.challengeItemId,
    redemptionId: input.redemptionId,
  });
  if (!visit.ok) return visit;
  if (!isReportableItemStatus(visit.visit.itemStatus)) {
    return { ok: false, code: 'not_reportable' };
  }

  const inserted = await store.insertCase({
    userId: input.userId,
    challengeItemId: visit.visit.challengeItemId,
    redemptionId: visit.visit.redemptionId,
    category,
    explanation,
  });
  if (!inserted.ok) return inserted;
  return { ok: true, problem: toMemberVisitProblem(inserted.row) };
}

export type SavingsCorrectionCode =
  | 'terminal'
  | 'not_allowed'
  | 'invalid_amount'
  | 'invalid_reason';

export type RestoreCorrectionCode = 'terminal' | 'not_allowed' | 'invalid_reason';

/**
 * Admin savings correction while the case is open. A resolved case is refused
 * before the amount is judged. The reason is the audit text.
 */
export function decideSavingsCorrection(input: {
  category: VisitProblemCategory;
  status: VisitProblemStatus;
  correctedCents: unknown;
  reason: unknown;
}): { ok: true; correctedCents: number; reason: string } | { ok: false; code: SavingsCorrectionCode } {
  if (input.status === 'resolved') return { ok: false, code: 'terminal' };
  if (!allowedVisitProblemFixes(input.category).savings) return { ok: false, code: 'not_allowed' };
  const reason = parseVisitProblemText(input.reason);
  if (!reason) return { ok: false, code: 'invalid_reason' };
  const correctedCents = parseCorrectedCents(input.correctedCents);
  if (correctedCents == null) return { ok: false, code: 'invalid_amount' };
  return { ok: true, correctedCents, reason };
}

/** Admin make-up opportunity while the case is open. Resolving alone does not grant one. */
export function decideRestoreCorrection(input: {
  category: VisitProblemCategory;
  status: VisitProblemStatus;
  reason: unknown;
}): { ok: true; reason: string } | { ok: false; code: RestoreCorrectionCode } {
  if (input.status === 'resolved') return { ok: false, code: 'terminal' };
  if (!allowedVisitProblemFixes(input.category).restore) return { ok: false, code: 'not_allowed' };
  const reason = parseVisitProblemText(input.reason);
  if (!reason) return { ok: false, code: 'invalid_reason' };
  return { ok: true, reason };
}

const SAVINGS_RPC_ERRORS = [
  'not_admin',
  'not_found',
  'terminal',
  'not_allowed',
  'invalid_reason',
  'invalid_amount',
  'already_applied',
  'no_redemption',
  'not_verified',
] as const;

const RESTORE_RPC_ERRORS = [
  'not_admin',
  'not_found',
  'terminal',
  'not_allowed',
  'invalid_reason',
  'already_applied',
] as const;

export type SavingsRpcCode = (typeof SAVINGS_RPC_ERRORS)[number];
export type RestoreRpcCode = (typeof RESTORE_RPC_ERRORS)[number];

export type SavingsCorrectionRpc =
  | { ok: true; alreadyApplied: boolean; correctedCents: number; redemptionId: string }
  | { ok: false; code: SavingsRpcCode | 'unavailable' };

export type RestoreCorrectionRpc =
  | { ok: true; alreadyApplied: boolean; opportunityId: string }
  | { ok: false; code: RestoreRpcCode | 'unavailable' };

function rpcObject(value: Json | null): Record<string, Json | undefined> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

export function parseSavingsCorrectionRpc(value: Json | null): SavingsCorrectionRpc {
  const body = rpcObject(value);
  if (!body) return { ok: false, code: 'unavailable' };
  if (body.ok === true) {
    const correctedCents = parseCorrectedCents(body.corrected_cents);
    const redemptionId = typeof body.redemption_id === 'string' ? body.redemption_id : null;
    if (correctedCents == null || !redemptionId || typeof body.already_applied !== 'boolean') {
      return { ok: false, code: 'unavailable' };
    }
    if ('reason' in body) return { ok: false, code: 'unavailable' };
    return { ok: true, alreadyApplied: body.already_applied, correctedCents, redemptionId };
  }
  if (typeof body.error === 'string' && (SAVINGS_RPC_ERRORS as readonly string[]).includes(body.error)) {
    return { ok: false, code: body.error as SavingsRpcCode };
  }
  return { ok: false, code: 'unavailable' };
}

export function parseRestoreCorrectionRpc(value: Json | null): RestoreCorrectionRpc {
  const body = rpcObject(value);
  if (!body) return { ok: false, code: 'unavailable' };
  if (body.ok === true) {
    const opportunityId = typeof body.opportunity_id === 'string' ? body.opportunity_id : null;
    if (!opportunityId || typeof body.already_applied !== 'boolean') {
      return { ok: false, code: 'unavailable' };
    }
    if ('reason' in body) return { ok: false, code: 'unavailable' };
    return { ok: true, alreadyApplied: body.already_applied, opportunityId };
  }
  if (typeof body.error === 'string' && (RESTORE_RPC_ERRORS as readonly string[]).includes(body.error)) {
    return { ok: false, code: body.error as RestoreRpcCode };
  }
  return { ok: false, code: 'unavailable' };
}

export function visitProblemInsertCode(
  error: { code?: string } | null,
): 'already_open' | 'unavailable' | null {
  if (!error) return null;
  if (error.code === '23505') return 'already_open';
  return 'unavailable';
}

export type ReviewRpcResult =
  | { ok: true; status: VisitProblemStatus; memberResponse: string | null }
  | {
      ok: false;
      code:
        | 'not_admin'
        | 'not_found'
        | 'terminal'
        | 'invalid_reason'
        | 'invalid_status'
        | 'invalid_response'
        | 'explanation_required'
        | 'unchanged'
        | 'unavailable';
    };

const REVIEW_ERRORS = [
  'not_admin',
  'not_found',
  'terminal',
  'invalid_reason',
  'invalid_status',
  'invalid_response',
  'explanation_required',
  'unchanged',
] as const;

type ReviewErrorCode = (typeof REVIEW_ERRORS)[number];

function isReviewError(value: string): value is ReviewErrorCode {
  return (REVIEW_ERRORS as readonly string[]).includes(value);
}

export function parseReviewRpc(value: Json | null): ReviewRpcResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, code: 'unavailable' };
  }
  if (value.ok === true) {
    const status = parseVisitProblemStatus(value.status);
    const memberResponse =
      typeof value.member_response === 'string'
        ? value.member_response
        : value.member_response === null
          ? null
          : undefined;
    if (!status || memberResponse === undefined) return { ok: false, code: 'unavailable' };
    if ('reason' in value) return { ok: false, code: 'unavailable' };
    return { ok: true, status, memberResponse };
  }
  if (typeof value.error === 'string' && isReviewError(value.error)) {
    return { ok: false, code: value.error };
  }
  return { ok: false, code: 'unavailable' };
}

export async function readOwnedVisitProblem(
  store: VisitProblemStore,
  input: { userId: string; challengeItemId: string },
): Promise<{ ok: true; problem: MemberVisitProblem | null } | { ok: false; code: VisitLookupCode }> {
  const visit = await store.lookupOwnedVisit({
    userId: input.userId,
    challengeItemId: input.challengeItemId,
    redemptionId: null,
  });
  if (!visit.ok) return visit;
  const listed = await store.listOwnCases({
    userId: input.userId,
    challengeItemId: input.challengeItemId,
  });
  if (!listed.ok) return listed;
  const own = listed.rows.filter(
    (row) => row.user_id === input.userId && row.challenge_item_id === input.challengeItemId,
  );
  const current = currentMemberCase(own);
  return { ok: true, problem: current ? toMemberVisitProblem(current) : null };
}
