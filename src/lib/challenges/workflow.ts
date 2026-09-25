import { getSupabaseAdmin } from '@/lib/supabase-admin';

export type WorkflowVersion = 'legacy' | 'credits';

export async function readWorkflowVersion(userId: string): Promise<WorkflowVersion> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('user_profiles')
    .select('workflow_version')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data?.workflow_version === 'credits' ? 'credits' : 'legacy';
}
