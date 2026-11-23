'use server';

import { revalidatePath } from 'next/cache';
import { assertAdmin } from '@/lib/auth/assert-admin';
import { logAdminAction } from '@/lib/audit/log-admin-action';
import { siteProblemReportsEnabled } from '@/lib/site-problems/flag';
import { parseAdminNote, parseSiteProblemStatus } from '@/lib/site-problems/report';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { parseUuid } from '@/lib/uuid';

export type SiteProblemReviewState =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'idle'
        | 'disabled'
        | 'forbidden'
        | 'not_found'
        | 'invalid_status'
        | 'invalid_note'
        | 'unchanged'
        | 'unavailable'
        | 'mfa_enroll'
        | 'mfa_challenge'
        | 'auth_error'
        | 'role_lookup_failed';
      message: string;
    };

const MESSAGES = {
  disabled: 'Site problem reports are turned off.',
  forbidden: 'Admin access is required.',
  not_found: 'That report could not be found.',
  invalid_status: "That status isn't one we use.",
  invalid_note: 'The note is too long. Please keep it under 500 characters.',
  unchanged: 'Nothing changed.',
  unavailable: "We couldn't save that. Please try again.",
  mfa_enroll: 'Authenticator setup is required before admin access.',
  mfa_challenge: 'Authenticator verification is required before admin access.',
  auth_error: 'Admin access could not be checked.',
  role_lookup_failed: 'Admin access could not be checked.',
} as const;

function failure(
  code: Exclude<keyof typeof MESSAGES, never>,
): SiteProblemReviewState {
  return { ok: false, code, message: MESSAGES[code] };
}

/**
 * Mark one site problem report reviewed or closed and store a short note.
 * Unset SITE_PROBLEM_REPORTS_ENABLED returns disabled before any read.
 * The actor is the signed-in admin. The change is written to admin_audit_log.
 */
export async function updateSiteProblemReport(
  _prev: SiteProblemReviewState,
  formData: FormData,
): Promise<SiteProblemReviewState> {
  if (!siteProblemReportsEnabled()) return failure('disabled');

  const auth = await assertAdmin();
  if (!auth.ok) {
    if (auth.code === 'not_admin' || auth.code === 'unauthenticated') return failure('forbidden');
    return failure(auth.code);
  }

  const id = parseUuid(typeof formData.get('id') === 'string' ? formData.get('id') as string : null);
  if (!id) return failure('not_found');

  const status = parseSiteProblemStatus(formData.get('status'));
  if (!status) return failure('invalid_status');

  const note = parseAdminNote(formData.get('admin_note'));
  if (!note.ok) return failure('invalid_note');

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('site_problem_reports')
    .select('id, status, admin_note')
    .eq('id', id)
    .maybeSingle();
  if (error) return failure('unavailable');
  if (!data) return failure('not_found');

  const currentStatus = parseSiteProblemStatus(data.status);
  if (!currentStatus) return failure('unavailable');
  const currentNote = data.admin_note;
  if (currentStatus === status && currentNote === note.note) return failure('unchanged');

  const reviewing = status === 'reviewed' || status === 'closed';
  const { error: updateError } = await admin
    .from('site_problem_reports')
    .update({
      status,
      admin_note: note.note,
      reviewed_at: reviewing ? new Date().toISOString() : null,
      reviewed_by: reviewing ? auth.userId : null,
    })
    .eq('id', id);
  if (updateError) return failure('unavailable');

  await logAdminAction({
    actorUserId: auth.userId,
    action: 'site_problem.review',
    targetType: 'site_problem_report',
    targetId: id,
    metadata: {
      from_status: currentStatus,
      to_status: status,
      note_set: note.note !== null,
    },
  });

  revalidatePath('/admin/site-problems');
  return { ok: true };
}
