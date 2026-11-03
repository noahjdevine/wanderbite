import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { cycleMonthForWorkflow } from '@/lib/challenges/challenge-deadline';
import { memberShowsMonthlyCuration } from '@/lib/challenges/monthly-cron-gate';
import {
  logRevealPickReadFailedOnce,
  monthlyRevealEnabled,
  revealSchemaMissing,
} from '@/lib/challenges/monthly-reveal-flag';
import { normalizeMailbox } from '@/lib/email-address';
import {
  decideAfterSend,
  decideReminderPreSend,
  decideStoredRetry,
  parseStoredEmailPayload,
  type StoredEmailPayload,
} from '@/lib/email-send';
import {
  ADVENTURE_REMINDERS_TOPIC,
  signAdventureReminderUnsubscribe,
  unsubscribeUrl,
} from '@/lib/email-unsubscribe';
import { buildRevealPickReminderEmail, emailBaseUrl, sendStoredEmail } from '@/lib/resend';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import type { Database, Json } from '@/types/database.types';

type Admin = SupabaseClient<Database>;
type ClaimRow = Database['public']['Functions']['claim_reveal_pick_reminder']['Returns'][number];

export type RevealPickReminderResult = {
  status: 'emailed' | 'skipped' | 'failed' | 'released' | 'reconciliation';
  reason?: string;
};

type RpcName =
  | 'store_reveal_pick_reminder_payload'
  | 'complete_reveal_pick_reminder'
  | 'skip_reveal_pick_reminder'
  | 'release_reveal_pick_reminder'
  | 'fail_reveal_pick_reminder'
  | 'reconcile_reveal_pick_reminder'
  | 'record_hard_email_suppression';

function reminderKey(userId: string, periodKey: string): string {
  return `reveal-pick/${userId}/${periodKey}`;
}

async function rpcBoolean(supabase: Admin, fn: RpcName, args: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await supabase.rpc(fn, args as never);
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export type RevealPickRead = 'ok' | 'missing' | 'error';

/** Flag off, ineligible, already paired, already revealed, or an unreadable reveal table: do not send. */
export function decideRevealPickSend(args: {
  flagOn: boolean;
  showsCuration: boolean;
  hasRevealRow: boolean;
  revealRead: RevealPickRead;
}): 'send' | 'skip' {
  if (!args.flagOn || args.revealRead !== 'ok' || !args.showsCuration || args.hasRevealRow) return 'skip';
  return 'send';
}

async function revealReadForPeriod(
  supabase: Admin,
  userId: string,
  periodKey: string,
): Promise<{ read: RevealPickRead; hasRow: boolean }> {
  const { data, error } = await supabase
    .from('challenge_reveals')
    .select('id')
    .eq('user_id', userId)
    .eq('period_key', periodKey)
    .maybeSingle();
  if (error) {
    logRevealPickReadFailedOnce();
    return { read: revealSchemaMissing(error) ? 'missing' : 'error', hasRow: false };
  }
  return { read: 'ok', hasRow: Boolean(data) };
}

async function finishSkip(
  supabase: Admin,
  userId: string,
  periodKey: string,
  token: string,
  status: 'skipped_opt_out' | 'skipped_suppressed',
): Promise<RevealPickReminderResult> {
  const skipped = await rpcBoolean(supabase, 'skip_reveal_pick_reminder', {
    p_user_id: userId,
    p_period_key: periodKey,
    p_token: token,
    p_status: status,
  });
  if (!skipped) return { status: 'reconciliation', reason: 'lost claim before skip' };
  return {
    status: 'skipped',
    reason: status === 'skipped_opt_out' ? 'topic opt-out' : 'hard suppression',
  };
}

async function applySendResult(
  supabase: Admin,
  userId: string,
  periodKey: string,
  token: string,
  address: string,
  payload: StoredEmailPayload,
  idempotencyKey: string,
): Promise<RevealPickReminderResult> {
  const sent = await sendStoredEmail(payload, idempotencyKey);
  const decision = decideAfterSend(sent);
  if (decision.action === 'complete') {
    const completed = await rpcBoolean(supabase, 'complete_reveal_pick_reminder', {
      p_user_id: userId,
      p_period_key: periodKey,
      p_token: token,
      p_message_id: decision.messageId,
    });
    if (!completed) return { status: 'reconciliation', reason: 'lost claim after send' };
    return { status: 'emailed' };
  }
  if (decision.action === 'suppress') {
    await rpcBoolean(supabase, 'record_hard_email_suppression', {
      p_address: address,
      p_reason: 'already_suppressed',
      p_email_id: '',
    });
    return finishSkip(supabase, userId, periodKey, token, 'skipped_suppressed');
  }
  if (decision.action === 'fail') {
    const failed = await rpcBoolean(supabase, 'fail_reveal_pick_reminder', {
      p_user_id: userId,
      p_period_key: periodKey,
      p_token: token,
      p_error: decision.error,
    });
    if (!failed) return { status: 'reconciliation', reason: 'lost claim after failure' };
    return { status: 'failed', reason: decision.error };
  }
  const reconciled = await rpcBoolean(supabase, 'reconcile_reveal_pick_reminder', {
    p_user_id: userId,
    p_period_key: periodKey,
    p_token: token,
    p_reason: decision.reason,
  });
  if (!reconciled) return { status: 'reconciliation', reason: 'lost claim during reconciliation' };
  return { status: 'reconciliation', reason: decision.reason };
}

/**
 * One pick reminder per curation-eligible member per period.
 * Flag off, a reveal-read failure, an existing pair, or an existing reveal sends nothing.
 */
export async function deliverRevealPickReminder(params: {
  userId: string;
  now?: Date;
  supabase?: Admin;
}): Promise<RevealPickReminderResult> {
  if (!monthlyRevealEnabled()) return { status: 'skipped', reason: 'flag off' };
  const now = params.now ?? new Date();
  const periodKey = cycleMonthForWorkflow('legacy', now);
  let showsCuration = false;
  try {
    showsCuration = await memberShowsMonthlyCuration(params.userId, now);
  } catch {
    return { status: 'skipped', reason: 'eligibility unread' };
  }
  const supabase = params.supabase ?? getSupabaseAdmin();
  const reveal = await revealReadForPeriod(supabase, params.userId, periodKey);
  if (
    decideRevealPickSend({
      flagOn: true,
      showsCuration,
      hasRevealRow: reveal.hasRow,
      revealRead: reveal.read,
    }) !== 'send'
  ) {
    return { status: 'skipped', reason: reveal.read === 'ok' ? 'not eligible' : 'reveal read failed' };
  }

  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('email')
    .eq('id', params.userId)
    .maybeSingle();
  if (profileError) return { status: 'skipped', reason: 'email unread' };
  const address = normalizeMailbox(profile?.email ?? null);
  if (!address) return { status: 'skipped', reason: 'invalid recipient' };

  const { error: ensureError } = await supabase.rpc('ensure_reveal_pick_reminder', {
    p_user_id: params.userId,
    p_period_key: periodKey,
  });
  if (ensureError) return { status: 'failed', reason: 'could not record reminder' };

  const token = crypto.randomUUID();
  const { data: claimed, error: claimError } = await supabase.rpc('claim_reveal_pick_reminder', {
    p_user_id: params.userId,
    p_period_key: periodKey,
    p_token: token,
  });
  if (claimError) return { status: 'failed', reason: 'could not claim reminder' };
  const row: ClaimRow | undefined = claimed?.[0];
  if (!row) return { status: 'skipped', reason: 'already sent or claimed' };

  const [{ data: pref, error: prefError }, { data: suppression, error: suppressionError }] = await Promise.all([
    supabase
      .from('email_topic_preferences')
      .select('opted_out')
      .eq('user_id', params.userId)
      .eq('topic', ADVENTURE_REMINDERS_TOPIC)
      .maybeSingle(),
    supabase.from('email_suppressions').select('normalized_address').eq('normalized_address', address).maybeSingle(),
  ]);
  if (prefError || suppressionError) {
    await rpcBoolean(supabase, 'release_reveal_pick_reminder', {
      p_user_id: params.userId,
      p_period_key: periodKey,
      p_token: token,
      p_error: 'preference lookup failed',
    });
    return { status: 'released', reason: 'preference lookup failed' };
  }

  const stored = parseStoredEmailPayload(row.email_payload as Json);
  const decision = decideReminderPreSend({
    previousStatus: row.previous_status,
    hasPayload: stored !== null,
    usedAt: row.idempotency_key_used_at,
    optedOut: pref?.opted_out === true,
    suppressed: Boolean(suppression),
    hasUnsubscribeSecret: Boolean(process.env.EMAIL_UNSUBSCRIBE_SECRET?.trim()),
    now,
  });
  if (decision.action === 'skip') {
    return finishSkip(supabase, params.userId, periodKey, token, decision.status);
  }
  if (decision.action === 'release') {
    await rpcBoolean(supabase, 'release_reveal_pick_reminder', {
      p_user_id: params.userId,
      p_period_key: periodKey,
      p_token: token,
      p_error: decision.error,
    });
    return { status: 'released', reason: decision.error };
  }
  if (decision.action === 'reconcile') {
    await rpcBoolean(supabase, 'reconcile_reveal_pick_reminder', {
      p_user_id: params.userId,
      p_period_key: periodKey,
      p_token: token,
      p_reason: decision.reason,
    });
    return { status: 'reconciliation', reason: decision.reason };
  }

  const signed = signAdventureReminderUnsubscribe({ userId: params.userId, email: address });
  if (!signed) {
    await rpcBoolean(supabase, 'release_reveal_pick_reminder', {
      p_user_id: params.userId,
      p_period_key: periodKey,
      p_token: token,
      p_error: 'EMAIL_UNSUBSCRIBE_SECRET not configured',
    });
    return { status: 'released', reason: 'EMAIL_UNSUBSCRIBE_SECRET not configured' };
  }

  const fresh = await buildRevealPickReminderEmail({
    to: address,
    unsubscribeUrl: unsubscribeUrl(emailBaseUrl(), signed),
  });
  const idempotencyKey = row.idempotency_key || reminderKey(params.userId, periodKey);
  if (decision.action === 'compare_stored') {
    if (!stored) return { status: 'reconciliation', reason: 'stored payload missing' };
    const retry = decideStoredRetry({ stored, fresh, usedAt: row.idempotency_key_used_at, now });
    if (retry.action === 'reconcile') {
      await rpcBoolean(supabase, 'reconcile_reveal_pick_reminder', {
        p_user_id: params.userId,
        p_period_key: periodKey,
        p_token: token,
        p_reason: retry.reason,
      });
      return { status: 'reconciliation', reason: retry.reason };
    }
    return applySendResult(supabase, params.userId, periodKey, token, address, stored, idempotencyKey);
  }

  const storedOk = await rpcBoolean(supabase, 'store_reveal_pick_reminder_payload', {
    p_user_id: params.userId,
    p_period_key: periodKey,
    p_token: token,
    p_recipient: address,
    p_payload: fresh,
    p_idempotency_key: idempotencyKey,
  });
  if (!storedOk) return { status: 'skipped', reason: 'lost claim before send' };
  return applySendResult(supabase, params.userId, periodKey, token, address, fresh, idempotencyKey);
}
