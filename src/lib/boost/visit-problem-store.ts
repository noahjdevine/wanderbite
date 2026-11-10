import 'server-only';

import type {
  AdminVisitProblem,
  MemberMakeupSpot,
  RestoreCorrectionRpc,
  ReviewRpcResult,
  SavingsCorrectionRpc,
  VisitProblemStore,
  VisitProblemCaseRow,
} from '@/lib/boost/visit-problem';
import {
  makeupSpotAvailability,
  parseRestoreCorrectionRpc,
  parseReviewRpc,
  parseSavingsCorrectionRpc,
  parseVisitProblemCategory,
  parseVisitProblemStatus,
  visitProblemInsertCode,
  VISIT_PROBLEM_CATEGORY_LABELS,
  VISIT_PROBLEM_STATUS_LABELS,
} from '@/lib/boost/visit-problem';
import { visitProblemsEnabled } from '@/lib/boost/flag';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import type { Json } from '@/types/database.types';

const CASE_COLUMNS =
  'id, user_id, challenge_item_id, redemption_id, category, explanation, status, member_response, resolved_at, created_at, updated_at';

type CaseRecord = {
  id: string;
  user_id: string;
  challenge_item_id: string;
  redemption_id: string | null;
  category: string;
  explanation: string;
  status: string;
  member_response: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export function parseVisitProblemCaseRow(value: CaseRecord | null): VisitProblemCaseRow | null {
  if (!value) return null;
  const category = parseVisitProblemCategory(value.category);
  const status = parseVisitProblemStatus(value.status);
  if (!category || !status) return null;
  return {
    id: value.id,
    user_id: value.user_id,
    challenge_item_id: value.challenge_item_id,
    redemption_id: value.redemption_id,
    category,
    explanation: value.explanation,
    status,
    member_response: value.member_response,
    resolved_at: value.resolved_at,
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
}

export function createSupabaseVisitProblemStore(): VisitProblemStore {
  const admin = getSupabaseAdmin();
  return {
    async lookupOwnedVisit({ userId, challengeItemId, redemptionId }) {
      const { data: item, error: itemError } = await admin
        .from('challenge_items')
        .select('id, status, cycle_id')
        .eq('id', challengeItemId)
        .maybeSingle();
      if (itemError) return { ok: false, code: 'unavailable' };
      if (!item?.id || !item.cycle_id) return { ok: false, code: 'not_found' };

      const { data: cycle, error: cycleError } = await admin
        .from('challenge_cycles')
        .select('id, user_id')
        .eq('id', item.cycle_id)
        .maybeSingle();
      if (cycleError) return { ok: false, code: 'unavailable' };
      if (!cycle) return { ok: false, code: 'not_found' };
      if (cycle.user_id !== userId) return { ok: false, code: 'forbidden' };

      const { data: redemptions, error: redemptionError } = await admin
        .from('redemptions')
        .select('id, user_id, challenge_item_id, created_at')
        .eq('challenge_item_id', item.id)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (redemptionError) return { ok: false, code: 'unavailable' };

      const owned = (redemptions ?? []).filter(
        (row) => row.user_id === userId && row.challenge_item_id === item.id,
      );
      let linked: string | null = null;
      if (redemptionId) {
        const match = owned.find((row) => row.id === redemptionId);
        if (!match) return { ok: false, code: 'invalid_redemption' };
        linked = match.id;
      } else {
        linked = owned[0]?.id ?? null;
      }

      return {
        ok: true,
        visit: {
          challengeItemId: item.id,
          itemStatus: item.status ?? '',
          redemptionId: linked,
        },
      };
    },

    async listOwnCases({ userId, challengeItemId }) {
      const { data, error } = await admin
        .from('visit_problem_cases')
        .select(CASE_COLUMNS)
        .eq('user_id', userId)
        .eq('challenge_item_id', challengeItemId);
      if (error) return { ok: false, code: 'unavailable' };
      const rows = (data ?? [])
        .map((row) => parseVisitProblemCaseRow(row))
        .filter((row): row is VisitProblemCaseRow => row !== null && row.user_id === userId);
      return { ok: true, rows };
    },

    async insertCase(input) {
      const { data, error } = await admin
        .from('visit_problem_cases')
        .insert({
          user_id: input.userId,
          challenge_item_id: input.challengeItemId,
          redemption_id: input.redemptionId,
          category: input.category,
          explanation: input.explanation,
          status: 'submitted',
        })
        .select(CASE_COLUMNS)
        .maybeSingle();
      const code = visitProblemInsertCode(error);
      if (code) return { ok: false, code };
      const row = parseVisitProblemCaseRow(data);
      if (!row || row.user_id !== input.userId) return { ok: false, code: 'unavailable' };
      return { ok: true, row };
    },
  };
}

const QUEUE_LIMIT = 100;

function reasonFromMetadata(metadata: Json | null): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const reason = metadata.reason;
  return typeof reason === 'string' && reason.trim() ? reason : null;
}

export async function loadVisitProblemQueue(): Promise<
  | { ok: true; cases: AdminVisitProblem[]; correctionsUnavailable: boolean }
  | { ok: false; code: 'disabled' | 'unavailable' }
> {
  if (!visitProblemsEnabled()) return { ok: false, code: 'disabled' };
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('visit_problem_cases')
    .select(CASE_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(QUEUE_LIMIT);
  if (error) return { ok: false, code: 'unavailable' };

  const rows = (data ?? [])
    .map((row) => parseVisitProblemCaseRow(row))
    .filter((row): row is VisitProblemCaseRow => row !== null);
  if (rows.length === 0) return { ok: true, cases: [], correctionsUnavailable: false };

  const itemIds = [...new Set(rows.map((row) => row.challenge_item_id))];
  const userIds = [...new Set(rows.map((row) => row.user_id))];
  const caseIds = rows.map((row) => row.id);

  const [{ data: items }, { data: profiles }, { data: audits }] = await Promise.all([
    admin.from('challenge_items').select('id, restaurant_id').in('id', itemIds),
    admin.from('user_profiles').select('id, email').in('id', userIds),
    admin
      .from('admin_audit_log')
      .select('target_id, metadata, created_at')
      .eq('target_type', 'visit_problem_case')
      .in('target_id', caseIds)
      .order('created_at', { ascending: false }),
  ]);

  const restaurantIds = [
    ...new Set((items ?? []).map((item) => item.restaurant_id).filter((id): id is string => Boolean(id))),
  ];
  const { data: restaurants } = restaurantIds.length
    ? await admin.from('restaurants').select('id, name').in('id', restaurantIds)
    : { data: [] };

  const restaurantByItem = new Map<string, string>();
  for (const item of items ?? []) {
    const name = restaurants?.find((restaurant) => restaurant.id === item.restaurant_id)?.name;
    restaurantByItem.set(item.id, name?.trim() || 'Restaurant');
  }
  const emailByUser = new Map((profiles ?? []).map((profile) => [profile.id, profile.email]));
  const reasonByCase = new Map<string, string>();
  for (const audit of audits ?? []) {
    if (!audit.target_id || reasonByCase.has(audit.target_id)) continue;
    const reason = reasonFromMetadata(audit.metadata);
    if (reason) reasonByCase.set(audit.target_id, reason);
  }

  const [{ data: savingsRows, error: savingsError }, { data: opportunityRows, error: opportunityError }] =
    await Promise.all([
      admin
        .from('visit_problem_savings_adjustments')
        .select('case_id, corrected_cents')
        .in('case_id', caseIds),
      admin.from('visit_problem_opportunities').select('case_id').in('case_id', caseIds),
    ]);
  const correctionsUnavailable = Boolean(savingsError || opportunityError);
  const savingsByCase = new Map<string, number>();
  if (!savingsError) {
    for (const row of savingsRows ?? []) {
      if (typeof row.corrected_cents === 'number' && Number.isInteger(row.corrected_cents)) {
        savingsByCase.set(row.case_id, row.corrected_cents);
      }
    }
  }
  const makeupCases = new Set(
    opportunityError ? [] : (opportunityRows ?? []).map((row) => row.case_id),
  );

  const cases = rows
    .map((row) => ({
      id: row.id,
      userId: row.user_id,
      email: emailByUser.get(row.user_id) ?? null,
      restaurantName: restaurantByItem.get(row.challenge_item_id) ?? 'Restaurant',
      challengeItemId: row.challenge_item_id,
      redemptionId: row.redemption_id,
      category: row.category,
      categoryLabel: VISIT_PROBLEM_CATEGORY_LABELS[row.category],
      explanation: row.explanation,
      status: row.status,
      statusLabel: VISIT_PROBLEM_STATUS_LABELS[row.status],
      response: row.member_response,
      createdAt: row.created_at,
      latestReason: reasonByCase.get(row.id) ?? null,
      savingsCorrectionCents: savingsByCase.get(row.id) ?? null,
      makeupGranted: makeupCases.has(row.id),
    }))
    .sort((a, b) => {
      const open = (status: string) => (status === 'resolved' ? 1 : 0);
      const rank = open(a.status) - open(b.status);
      if (rank !== 0) return rank;
      return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
    });

  return { ok: true, cases, correctionsUnavailable };
}

/**
 * Make-up spots for the signed-in member. Flag off returns nothing and does
 * not query. A missing table or a failed read returns an empty list so
 * Challenges still loads.
 */
export async function loadMemberMakeupSpots(
  userId: string,
  now = new Date(),
): Promise<MemberMakeupSpot[]> {
  if (!visitProblemsEnabled()) return [];
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('visit_problem_opportunities')
      .select('id, challenge_item_id, status')
      .eq('user_id', userId);
    if (error) {
      console.error('[visit-problem] makeup read:', error.message);
      return [];
    }
    const rows = (data ?? []).filter(
      (row) => row.id && row.challenge_item_id && (row.status === 'available' || row.status === 'used'),
    );
    if (rows.length === 0) return [];
    const itemIds = [...new Set(rows.map((row) => row.challenge_item_id))];
    const { data: items, error: itemError } = await admin
      .from('challenge_items')
      .select('id, restaurant_id, offer_version_id, redemption_deadline')
      .in('id', itemIds);
    if (itemError) {
      console.error('[visit-problem] makeup read:', itemError.message);
      return [];
    }
    const restaurantIds = [
      ...new Set((items ?? []).map((item) => item.restaurant_id).filter((id): id is string => Boolean(id))),
    ];
    const versionIds = [
      ...new Set(
        (items ?? []).map((item) => item.offer_version_id).filter((id): id is string => Boolean(id)),
      ),
    ];
    const [{ data: restaurants, error: restaurantError }, { data: versions, error: versionError }] =
      await Promise.all([
        restaurantIds.length
          ? admin.from('restaurants').select('id, name, status').in('id', restaurantIds)
          : Promise.resolve({ data: [], error: null }),
        versionIds.length
          ? admin
              .from('offer_versions')
              .select('id, valid_from, valid_until, withdrawn_from_selection_at')
              .in('id', versionIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
    if (restaurantError || versionError) {
      console.error('[visit-problem] makeup read:', restaurantError?.message ?? versionError?.message);
      return [];
    }
    const itemById = new Map((items ?? []).map((item) => [item.id, item]));
    return rows.map((row) => {
      const item = itemById.get(row.challenge_item_id);
      const restaurant = restaurants?.find((entry) => entry.id === item?.restaurant_id);
      const version = versions?.find((entry) => entry.id === item?.offer_version_id);
      const status = row.status === 'used' ? 'used' : 'available';
      const availability = makeupSpotAvailability({
        status,
        restaurantStatus: restaurant?.status ?? null,
        offerVersionId: item?.offer_version_id ?? null,
        offer: version
          ? {
              validFrom: version.valid_from,
              validUntil: version.valid_until,
              withdrawnAt: version.withdrawn_from_selection_at,
            }
          : null,
        redemptionDeadline: item?.redemption_deadline ?? null,
        now,
      });
      return {
        id: row.id,
        restaurantName: restaurant?.name?.trim() || 'your restaurant',
        status,
        bookable: availability.bookable,
        unavailableMessage: availability.unavailableMessage,
      };
    });
  } catch (error) {
    console.error(
      '[visit-problem] makeup read:',
      error instanceof Error ? error.message : 'unknown',
    );
    return [];
  }
}

export async function reviewVisitProblemCase(input: {
  caseId: string;
  actorUserId: string;
  status: string;
  memberResponse: string | null;
  reason: string;
}): Promise<ReviewRpcResult> {
  if (!visitProblemsEnabled()) return { ok: false, code: 'unavailable' };
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc('review_visit_problem_case', {
    p_case_id: input.caseId,
    p_actor_user_id: input.actorUserId,
    p_status: input.status,
    p_member_response: input.memberResponse,
    p_reason: input.reason,
  });
  if (error) return { ok: false, code: 'unavailable' };
  return parseReviewRpc(data);
}

export async function correctVisitProblemSavings(input: {
  caseId: string;
  actorUserId: string;
  correctedCents: number;
  reason: string;
}): Promise<SavingsCorrectionRpc> {
  if (!visitProblemsEnabled()) return { ok: false, code: 'unavailable' };
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc('correct_visit_problem_savings', {
    p_case_id: input.caseId,
    p_actor_user_id: input.actorUserId,
    p_corrected_cents: input.correctedCents,
    p_reason: input.reason,
  });
  if (error) return { ok: false, code: 'unavailable' };
  return parseSavingsCorrectionRpc(data);
}

export async function restoreVisitProblemOpportunity(input: {
  caseId: string;
  actorUserId: string;
  reason: string;
}): Promise<RestoreCorrectionRpc> {
  if (!visitProblemsEnabled()) return { ok: false, code: 'unavailable' };
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc('restore_visit_problem_opportunity', {
    p_case_id: input.caseId,
    p_actor_user_id: input.actorUserId,
    p_reason: input.reason,
  });
  if (error) return { ok: false, code: 'unavailable' };
  return parseRestoreCorrectionRpc(data);
}

export type MakeupOpenRpc =
  | { ok: true; challengeItemId: string }
  | { ok: false; code: 'not_found' | 'forbidden' | 'already_used' | 'not_bookable' | 'unavailable'; detail: string | null };

export async function openMakeupVisitItem(input: {
  opportunityId: string;
  userId: string;
}): Promise<MakeupOpenRpc> {
  if (!visitProblemsEnabled()) return { ok: false, code: 'unavailable', detail: null };
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc('open_visit_problem_makeup_item', {
    p_opportunity_id: input.opportunityId,
    p_user_id: input.userId,
  });
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, code: 'unavailable', detail: null };
  }
  if (data.ok === true && typeof data.makeup_challenge_item_id === 'string') {
    return { ok: true, challengeItemId: data.makeup_challenge_item_id };
  }
  const code = typeof data.error === 'string' ? data.error : 'unavailable';
  const detail = typeof data.detail === 'string' ? data.detail : null;
  if (
    code === 'not_found'
    || code === 'forbidden'
    || code === 'already_used'
    || code === 'not_bookable'
    || code === 'unavailable'
  ) {
    return { ok: false, code, detail };
  }
  return { ok: false, code: 'unavailable', detail: null };
}

export type MakeupUseRpc =
  | { ok: true; alreadyApplied: boolean }
  | { ok: false; code: 'not_found' | 'forbidden' | 'already_used' | 'invalid_redemption' | 'not_ready' | 'unavailable' };

export async function markMakeupVisitUsed(input: {
  opportunityId: string;
  userId: string;
  redemptionId: string;
}): Promise<MakeupUseRpc> {
  if (!visitProblemsEnabled()) return { ok: false, code: 'unavailable' };
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc('use_visit_problem_opportunity', {
    p_opportunity_id: input.opportunityId,
    p_user_id: input.userId,
    p_redemption_id: input.redemptionId,
  });
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, code: 'unavailable' };
  }
  if (data.ok === true && typeof data.already_applied === 'boolean') {
    if ('reason' in data) return { ok: false, code: 'unavailable' };
    return { ok: true, alreadyApplied: data.already_applied };
  }
  const code = typeof data.error === 'string' ? data.error : '';
  if (
    code === 'not_found'
    || code === 'forbidden'
    || code === 'already_used'
    || code === 'invalid_redemption'
    || code === 'not_ready'
  ) {
    return { ok: false, code };
  }
  return { ok: false, code: 'unavailable' };
}
