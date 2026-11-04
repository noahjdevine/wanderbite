/**
 * Closed reasons for a Discover random pick (`selectionMode: random_fallback`).
 *
 * Priority for the gates before reserve: kill switch, then missing config
 * (API key, guest signing secret, or IP hash secret), then missing identity
 * (no trusted IP hash, or no user and no guest id).
 *
 * `no_candidates` is not a code. An empty catalog returns 503, and a dietary
 * or exclusion filter that matches nothing returns 404, before any random pick.
 *
 * `ai_requests.result_payload.selectionMode` records `ai` or `random_fallback`
 * only after a dispatched attempt stores a payload. These logs cover the
 * earlier gates and the reason, which that payload does not store.
 * Lines are the two objects below: no message, note, model text, token, IP,
 * email, or user id. `requestId` is the client idempotency UUID before reserve
 * and `ai_requests.id` after it.
 */
export const DISCOVER_FALLBACK_REASONS = [
  'ai_disabled',
  'missing_config',
  'missing_identity',
  'rate_limited',
  'budget_exceeded',
  'guest_transferred',
  'provider_error',
  'parse_failed',
  'invalid_pick',
  'replay_fallback',
  'missing_metadata',
] as const;

export type DiscoverFallbackReason = (typeof DISCOVER_FALLBACK_REASONS)[number];

export type DiscoverMemberType = 'member' | 'guest';

export type DiscoverFallbackLog = {
  reason: DiscoverFallbackReason;
  requestId: string;
  memberType: DiscoverMemberType;
  poolSize: number;
  dietaryFilterCount: number;
  providerStatus?: number;
};

export type DiscoverAiPickLog = {
  requestId: string;
  poolSize: number;
};

export const DISCOVER_FALLBACK_LOG = '[discover] fallback';
export const DISCOVER_AI_PICK_LOG = '[discover] ai_pick';

/** Ledger denials that refuse the billable attempt before dispatch. */
export const BUDGET_DENY_REASONS = [
  'insufficient_budget',
  'guest_turns_exhausted',
  'paid_core_reserve',
  'zero_quote',
] as const;

export function prerequisiteFallbackReason(args: {
  aiDisabled: boolean;
  hasApiKey: boolean;
  hasGuestSigningSecret: boolean;
  hasIpHashSecret: boolean;
  hasIpHash: boolean;
  hasSubject: boolean;
}): DiscoverFallbackReason | null {
  if (args.aiDisabled) return 'ai_disabled';
  if (!args.hasApiKey || !args.hasGuestSigningSecret || !args.hasIpHashSecret) {
    return 'missing_config';
  }
  if (!args.hasIpHash || !args.hasSubject) return 'missing_identity';
  return null;
}

export function fallbackReasonForReserveDenial(
  denyReason: string | null | undefined,
): 'budget_exceeded' | 'guest_transferred' | 'missing_metadata' {
  const deny = (denyReason ?? '').trim();
  if ((BUDGET_DENY_REASONS as readonly string[]).includes(deny)) return 'budget_exceeded';
  if (deny === 'guest_already_transferred') return 'guest_transferred';
  return 'missing_metadata';
}

function storedRestaurantId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const id = (payload as Record<string, unknown>).restaurantId;
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Replay did not return a stored card. A budget or transferred-guest denial
 * wins. A payload that names a restaurant the current pool rejected is
 * `invalid_pick`. No payload and an empty deny reason (in-flight replay, or
 * dispatch already taken) is `missing_metadata`.
 */
export function fallbackReasonForReplayMiss(args: {
  denyReason: string | null | undefined;
  payload: unknown;
}): DiscoverFallbackReason {
  const denial = fallbackReasonForReserveDenial(args.denyReason);
  if (denial !== 'missing_metadata') return denial;
  if (storedRestaurantId(args.payload)) return 'invalid_pick';
  return 'missing_metadata';
}

/** Null when the model id is in the prompt list. Provider failure wins over parse. */
export function modelPickFallbackReason(args: {
  providerFailed: boolean;
  parsedId: string | null;
  pickValid: boolean;
}): DiscoverFallbackReason | null {
  if (args.providerFailed) return 'provider_error';
  if (args.parsedId === null) return 'parse_failed';
  if (!args.pickValid) return 'invalid_pick';
  return null;
}

export function logDiscoverFallback(entry: DiscoverFallbackLog): void {
  const line: DiscoverFallbackLog = {
    reason: entry.reason,
    requestId: entry.requestId,
    memberType: entry.memberType,
    poolSize: entry.poolSize,
    dietaryFilterCount: entry.dietaryFilterCount,
  };
  if (typeof entry.providerStatus === 'number' && Number.isFinite(entry.providerStatus)) {
    line.providerStatus = entry.providerStatus;
  }
  console.warn(DISCOVER_FALLBACK_LOG, line);
}

export function logDiscoverAiPick(entry: DiscoverAiPickLog): void {
  console.warn(DISCOVER_AI_PICK_LOG, {
    requestId: entry.requestId,
    poolSize: entry.poolSize,
  });
}
