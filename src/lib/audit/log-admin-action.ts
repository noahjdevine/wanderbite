import 'server-only';

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import type { Json } from '@/types/database.types';

export type AdminAuditAction =
  | 'restaurant.create'
  | 'restaurant.delete'
  | 'restaurant.enrich'
  | 'restaurant.enrich_bulk'
  | 'restaurant.slugs_generated'
  | 'restaurant.import';

export async function logAdminAction(params: {
  actorUserId: string;
  action: AdminAuditAction;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin.from('admin_audit_log').insert({
    actor_user_id: params.actorUserId,
    action: params.action,
    target_type: params.targetType,
    target_id: params.targetId ?? null,
    metadata: (params.metadata ?? null) as Json,
  });

  if (error) {
    console.error('[audit] failed to write admin_audit_log:', error.message);
  }
}
