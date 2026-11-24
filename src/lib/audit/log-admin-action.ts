import 'server-only';

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import type { Json } from '@/types/database.types';

export type AdminAuditAction =
  | 'restaurant.create'
  | 'restaurant.delete'
  | 'restaurant.enrich'
  | 'restaurant.enrich_bulk'
  | 'restaurant.slugs_generated'
  | 'restaurant.import'
  | 'restaurant.pin_set'
  | 'offer.draft_save'
  | 'content.exception_approve'
  | 'content.exception_edit'
  | 'content.exception_reject'
  | 'content.recipe_rollback'
  | 'content.source_pause'
  | 'content.source_resume'
  | 'content.activity_note_approve'
  | 'content.activity_note_edit'
  | 'content.activity_note_reject'
  | 'visit_problem.review'
  | 'visit_problem.resolve'
  | 'site_problem.review';

export async function logAdminAction(params: {
  actorUserId: string;
  action: AdminAuditAction;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}): Promise<boolean> {
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
    return false;
  }
  return true;
}
