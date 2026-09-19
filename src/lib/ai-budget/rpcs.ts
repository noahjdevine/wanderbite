import 'server-only';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { AI_BUDGET_RPCS } from '@/lib/ai-budget';
import type { Json } from '@/types/database.types';

export type AiRequestRpcRow = {
  acquired: boolean;
  customer_released: boolean;
  deny_reason: string | null;
  request_id: string;
  reserved_customer_microdollars: number;
  reserved_platform_microdollars: number;
  settled_customer_microdollars: number;
  settled_platform_microdollars: number;
  status: string;
};

function firstRow<T>(data: T[] | T | null): T | null {
  if (Array.isArray(data)) return data[0] ?? null;
  return data;
}

export async function rpcAiCurrentVersions() {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc(AI_BUDGET_RPCS.currentVersions);
  if (error) throw error;
  const row = firstRow(data);
  if (!row) throw new Error('ai_current_versions empty');
  return row;
}

export async function rpcAiReserve(args: {
  accountTier: string;
  configVersionId: string;
  featureClass: string;
  guestId?: string | null;
  idempotencyKey: string;
  modelId: string;
  priceVersionId: string;
  provider: string;
  usageUnits: Record<string, number>;
  userId?: string | null;
}): Promise<AiRequestRpcRow> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc(AI_BUDGET_RPCS.reserve, {
    p_account_tier: args.accountTier,
    p_config_version_id: args.configVersionId,
    p_feature_class: args.featureClass,
    p_guest_id: args.guestId ?? undefined,
    p_idempotency_key: args.idempotencyKey,
    p_model_id: args.modelId,
    p_price_version_id: args.priceVersionId,
    p_provider: args.provider,
    p_usage_units: args.usageUnits as unknown as Json,
    p_user_id: args.userId ?? undefined,
  });
  if (error) throw error;
  const row = firstRow(data);
  if (!row) throw new Error('ai_reserve empty');
  return row;
}

export async function rpcAiDispatch(requestId: string): Promise<AiRequestRpcRow> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc(AI_BUDGET_RPCS.dispatch, {
    p_request_id: requestId,
  });
  if (error) throw error;
  const row = firstRow(data);
  if (!row) throw new Error('ai_dispatch empty');
  return row;
}

export async function rpcAiFailBeforeDispatch(requestId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin.rpc(AI_BUDGET_RPCS.failBeforeDispatch, {
    p_request_id: requestId,
  });
  if (error) throw error;
}

export async function rpcAiSettle(
  requestId: string,
  usageActual: Record<string, number>,
): Promise<AiRequestRpcRow> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc(AI_BUDGET_RPCS.settle, {
    p_request_id: requestId,
    p_usage_actual: usageActual as unknown as Json,
  });
  if (error) throw error;
  const row = firstRow(data);
  if (!row) throw new Error('ai_settle empty');
  return row;
}

export async function rpcAiMarkAssumedSpent(requestId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin.rpc(AI_BUDGET_RPCS.markAssumedSpent, {
    p_request_id: requestId,
  });
  if (error) throw error;
}

export async function rpcAiReleaseCustomerAllowance(requestId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin.rpc(AI_BUDGET_RPCS.releaseCustomerAllowance, {
    p_request_id: requestId,
  });
  if (error) throw error;
}

export async function rpcAiReconcile(
  requestId: string,
  usageActual: Record<string, number>,
): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin.rpc(AI_BUDGET_RPCS.reconcile, {
    p_request_id: requestId,
    p_usage_actual: usageActual as unknown as Json,
  });
  if (error) throw error;
}

export async function rpcAiStoreResultPayload(
  requestId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin.rpc(AI_BUDGET_RPCS.storeResultPayload, {
    p_request_id: requestId,
    p_payload: payload as unknown as Json,
  });
  if (error) throw error;
}

export async function rpcAiLoadResultPayload(requestId: string): Promise<{
  deny_reason: string | null;
  request_id: string;
  result_payload: Json | null;
  status: string;
} | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc(AI_BUDGET_RPCS.loadResultPayload, {
    p_request_id: requestId,
  });
  if (error) throw error;
  return firstRow(data);
}

export async function rpcAiRecoverStaleRequests(): Promise<void> {
  const admin = getSupabaseAdmin();
  const staleBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { error } = await admin.rpc(AI_BUDGET_RPCS.recoverStaleRequests, {
    p_stale_before: staleBefore,
    p_limit: 10,
  });
  if (error) throw error;
}

export async function rpcAiTransferGuestToAccount(
  guestId: string,
  userId: string,
): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin.rpc(AI_BUDGET_RPCS.transferGuestToAccount, {
    p_guest_id: guestId,
    p_user_id: userId,
  });
  if (error) throw error;
}
