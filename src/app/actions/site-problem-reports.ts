'use server';

import { headers } from 'next/headers';
import { hashClientIp } from '@/lib/ai-ip-hash';
import { trustedClientIpFromHeaders } from '@/lib/client-ip';
import { evaluateSiteProblemReportLimit } from '@/lib/ratelimit';
import { scheduleProblemAlert } from '@/lib/site-problems/alert';
import { siteProblemReportsEnabled } from '@/lib/site-problems/flag';
import {
  DISABLED_MESSAGE,
  RATE_LIMIT_MESSAGE,
  SAVE_FAILED_MESSAGE,
  parseSiteProblemSubmission,
  reportLimitSubject,
  truncateUserAgent,
} from '@/lib/site-problems/report';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export type SiteProblemFormState =
  | { ok: true; returnPath: string | null }
  | {
      ok: false;
      code:
        | 'idle'
        | 'disabled'
        | 'rejected'
        | 'what_happened'
        | 'trying_to_do'
        | 'page_path'
        | 'email'
        | 'rate_limited'
        | 'unavailable';
      message: string;
    };

function failure(
  code: Exclude<SiteProblemFormState, { ok: true }>['code'],
  message: string,
): SiteProblemFormState {
  return { ok: false, code, message };
}

/**
 * Store one site problem report.
 * Unset SITE_PROBLEM_REPORTS_ENABLED refuses before any read or insert.
 * The signed-in user id comes from the session. A visitor email is optional.
 * After the row is saved, one owner alert is scheduled. That send cannot fail this response.
 */
export async function submitSiteProblemReport(
  _prev: SiteProblemFormState,
  formData: FormData,
): Promise<SiteProblemFormState> {
  if (!siteProblemReportsEnabled()) return failure('disabled', DISABLED_MESSAGE);

  const honeypot = formData.get('company_website');
  const whatHappened = formData.get('what_happened');
  const tryingToDo = formData.get('trying_to_do');
  const pagePath = formData.get('page_path');
  const contactEmail = formData.get('contact_email');

  let signedIn = false;
  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      signedIn = true;
      userId = user.id;
    }
  } catch {
    return failure('unavailable', SAVE_FAILED_MESSAGE);
  }

  const parsed = parseSiteProblemSubmission({
    whatHappened,
    tryingToDo,
    pagePath,
    contactEmail,
    honeypot,
    signedIn,
  });
  if (!parsed.ok) return failure(parsed.code, parsed.message);

  const hdrs = await headers();
  const ip = trustedClientIpFromHeaders(hdrs);
  const ipHash = !userId && ip ? hashClientIp(ip) : null;
  const subject = reportLimitSubject({ userId, ipHash });
  if (!subject && process.env.NODE_ENV === 'production') {
    return failure('rate_limited', RATE_LIMIT_MESSAGE);
  }
  if (subject) {
    const limit = await evaluateSiteProblemReportLimit(subject);
    if (limit === 'rate_limited' || (limit === 'unavailable' && process.env.NODE_ENV === 'production')) {
      return failure('rate_limited', RATE_LIMIT_MESSAGE);
    }
  }

  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('site_problem_reports')
      .insert({
        user_id: userId,
        contact_email: userId ? null : parsed.contactEmail,
        page_path: parsed.pagePath,
        what_happened: parsed.whatHappened,
        trying_to_do: parsed.tryingToDo,
        user_agent: truncateUserAgent(hdrs.get('user-agent')),
      })
      .select('id, created_at')
      .single();
    if (error) return failure('unavailable', SAVE_FAILED_MESSAGE);
    if (data?.id) {
      try {
        scheduleProblemAlert({
          kind: 'site',
          reportId: data.id,
          occurredAt: data.created_at,
          pagePath: parsed.pagePath,
          whatHappened: parsed.whatHappened,
          reporter: userId ? 'member' : 'visitor',
        });
      } catch (scheduleError) {
        console.error(
          '[problem-alert] schedule failed',
          scheduleError instanceof Error ? scheduleError.message : 'unknown',
        );
      }
    } else {
      console.warn('[problem-alert] skipped count=1 reason=missing_report');
    }
  } catch {
    return failure('unavailable', SAVE_FAILED_MESSAGE);
  }

  return { ok: true, returnPath: parsed.pagePath };
}
