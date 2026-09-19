import 'server-only';

/**
 * G13-A1 RPC names. Provider rates live in `ai_price_rates` only —
 * call `ai_quote_max_cost` instead of hard-coding prices.
 */
export const AI_BUDGET_RPCS = {
  currentVersions: 'ai_current_versions',
  dispatch: 'ai_dispatch',
  failBeforeDispatch: 'ai_fail_before_dispatch',
  fairUseState: 'ai_fair_use_state',
  markAssumedSpent: 'ai_mark_assumed_spent',
  loadResultPayload: 'ai_load_result_payload',
  opsHeadroom: 'ai_ops_headroom',
  opsUsageSummary: 'ai_ops_usage_summary',
  quoteMaxCost: 'ai_quote_max_cost',
  recoverStaleRequests: 'ai_recover_stale_requests',
  reconcile: 'ai_reconcile',
  releaseCustomerAllowance: 'ai_release_customer_allowance',
  reserve: 'ai_reserve',
  settle: 'ai_settle',
  storeResultPayload: 'ai_store_result_payload',
  transferGuestToAccount: 'ai_transfer_guest_to_account',
} as const;

export const AI_MICRODOLLARS_PER_DOLLAR = 1_000_000;

export const AI_FEATURE_CLASSES = [
  'protected_core',
  'optional',
  'maintenance',
  'guest',
] as const;

export const AI_ACCOUNT_TIERS = ['paid', 'free', 'guest', 'ops'] as const;

export const AI_REQUEST_STATUSES = [
  'denied',
  'reserved',
  'dispatched',
  'settled',
  'failed_before_dispatch',
  'assumed_spent',
] as const;

export const AI_FAIR_USE_STATUSES = ['ok', 'near_limit', 'exhausted'] as const;

export type AiFeatureClass = (typeof AI_FEATURE_CLASSES)[number];
export type AiAccountTier = (typeof AI_ACCOUNT_TIERS)[number];
export type AiRequestStatus = (typeof AI_REQUEST_STATUSES)[number];
export type AiFairUseStatus = (typeof AI_FAIR_USE_STATUSES)[number];

/** Unit conversion only. Not a provider rate. */
export function dollarsToMicrodollars(dollars: number): number {
  return Math.trunc(dollars * AI_MICRODOLLARS_PER_DOLLAR);
}
