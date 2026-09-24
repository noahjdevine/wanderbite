import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
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
import {
  buildRedemptionReminderEmail,
  emailBaseUrl,
  sendStoredEmail,
} from '@/lib/resend';
import type { Database, Json } from '@/types/database.types';

type Admin = SupabaseClient<Database>;

export type AdventureReminderResult = {
  status: 'emailed' | 'skipped' | 'failed' | 'released' | 'reconciliation';
  reason?: string;
  messageId?: string;
};

type ClaimRow = Database['public']['Functions']['claim_email_reminder_delivery']['Returns'][number];

function reminderKey(userId: string, cycleMonth: string): string {
  return `adventure-reminder/${userId}/${cycleMonth}`;
}

async function rpcBoolean(
  supabase: Admin,
  fn:
    | 'store_email_reminder_payload'
    | 'complete_email_reminder_delivery'
    | 'skip_email_reminder_delivery'
    | 'release_email_reminder_delivery'
    | 'fail_email_reminder_delivery'
    | 'reconcile_email_reminder_delivery'
    | 'record_hard_email_suppression',
  args: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await supabase.rpc(fn, args as never);
  if (error) throw new Error(error.message);
  return Boolean(data);
}

async function topicOptedOut(supabase: Admin, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('email_topic_preferences')
    .select('opted_out')
    .eq('user_id', userId)
    .eq('topic', ADVENTURE_REMINDERS_TOPIC)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.opted_out === true;
}

async function addressSuppressed(supabase: Admin, address: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('email_suppressions')
    .select('normalized_address')
    .eq('normalized_address', address)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

async function finishSkip(
  supabase: Admin,
  userId: string,
  cycleMonth: string,
  token: string,
  status: 'skipped_opt_out' | 'skipped_suppressed',
): Promise<AdventureReminderResult> {
  const skipped = await rpcBoolean(supabase, 'skip_email_reminder_delivery', {
    p_user_id: userId,
    p_cycle_month: cycleMonth,
    p_token: token,
    p_status: status,
  });
  if (!skipped) {
    return { status: 'reconciliation', reason: 'lost claim before skip' };
  }
  return {
    status: 'skipped',
    reason: status === 'skipped_opt_out' ? 'topic opt-out' : 'hard suppression',
  };
}

async function applySendResult(
  supabase: Admin,
  userId: string,
  cycleMonth: string,
  token: string,
  address: string,
  payload: StoredEmailPayload,
  idempotencyKey: string,
): Promise<AdventureReminderResult> {
  const sent = await sendStoredEmail(payload, idempotencyKey);
  const decision = decideAfterSend(sent);
  if (decision.action === 'complete') {
    const completed = await rpcBoolean(supabase, 'complete_email_reminder_delivery', {
      p_user_id: userId,
      p_cycle_month: cycleMonth,
      p_token: token,
      p_message_id: decision.messageId,
    });
    if (!completed) return { status: 'reconciliation', reason: 'lost claim after send' };
    return { status: 'emailed', messageId: decision.messageId };
  }
  if (decision.action === 'suppress') {
    await rpcBoolean(supabase, 'record_hard_email_suppression', {
      p_address: address,
      p_reason: 'already_suppressed',
      p_email_id: '',
    });
    return finishSkip(supabase, userId, cycleMonth, token, 'skipped_suppressed');
  }
  if (decision.action === 'fail') {
    const failed = await rpcBoolean(supabase, 'fail_email_reminder_delivery', {
      p_user_id: userId,
      p_cycle_month: cycleMonth,
      p_token: token,
      p_error: decision.error,
    });
    if (!failed) return { status: 'reconciliation', reason: 'lost claim after failure' };
    return { status: 'failed', reason: decision.error };
  }
  const reconciled = await rpcBoolean(supabase, 'reconcile_email_reminder_delivery', {
    p_user_id: userId,
    p_cycle_month: cycleMonth,
    p_token: token,
    p_reason: decision.reason,
  });
  if (!reconciled) return { status: 'reconciliation', reason: 'lost claim during reconciliation' };
  return { status: 'reconciliation', reason: decision.reason };
}

export async function readReminderDeliveryStatus(
  supabase: Admin,
  userId: string,
  cycleMonth: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('email_reminder_deliveries')
    .select('status')
    .eq('user_id', userId)
    .eq('cycle_month', cycleMonth)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.status ?? null;
}

export async function deliverAdventureReminder(params: {
  supabase: Admin;
  userId: string;
  cycleMonth: string;
  email: string;
  restaurantNames: string[];
  daysLeft: number;
  now?: Date;
}): Promise<AdventureReminderResult> {
  const now = params.now ?? new Date();
  const address = normalizeMailbox(params.email);
  if (!address) return { status: 'skipped', reason: 'invalid recipient' };
  if (params.restaurantNames.length === 0) {
    return { status: 'skipped', reason: 'no restaurants to remind about' };
  }

  const { error: ensureError } = await params.supabase.rpc('ensure_email_reminder_delivery', {
    p_user_id: params.userId,
    p_cycle_month: params.cycleMonth,
  });
  if (ensureError) throw new Error(ensureError.message);

  const token = crypto.randomUUID();
  const { data: claimed, error: claimError } = await params.supabase.rpc(
    'claim_email_reminder_delivery',
    {
      p_user_id: params.userId,
      p_cycle_month: params.cycleMonth,
      p_token: token,
    },
  );
  if (claimError) throw new Error(claimError.message);
  const row: ClaimRow | undefined = claimed?.[0];
  if (!row) return { status: 'skipped', reason: 'claimed by another worker' };

  let optedOut = false;
  let suppressed = false;
  try {
    [optedOut, suppressed] = await Promise.all([
      topicOptedOut(params.supabase, params.userId),
      addressSuppressed(params.supabase, address),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'preference lookup failed';
    const released = await rpcBoolean(params.supabase, 'release_email_reminder_delivery', {
      p_user_id: params.userId,
      p_cycle_month: params.cycleMonth,
      p_token: token,
      p_error: message,
    });
    if (!released) return { status: 'reconciliation', reason: 'lost claim during release' };
    return { status: 'released', reason: message };
  }
  const stored = parseStoredEmailPayload(row.email_payload as Json);
  const decision = decideReminderPreSend({
    previousStatus: row.previous_status,
    hasPayload: stored !== null,
    usedAt: row.idempotency_key_used_at,
    optedOut,
    suppressed,
    hasUnsubscribeSecret: Boolean(process.env.EMAIL_UNSUBSCRIBE_SECRET?.trim()),
    now,
  });

  if (decision.action === 'skip') {
    return finishSkip(params.supabase, params.userId, params.cycleMonth, token, decision.status);
  }
  if (decision.action === 'release') {
    const released = await rpcBoolean(params.supabase, 'release_email_reminder_delivery', {
      p_user_id: params.userId,
      p_cycle_month: params.cycleMonth,
      p_token: token,
      p_error: decision.error,
    });
    if (!released) return { status: 'reconciliation', reason: 'lost claim during release' };
    return { status: 'released', reason: decision.error };
  }
  if (decision.action === 'reconcile') {
    const reconciled = await rpcBoolean(params.supabase, 'reconcile_email_reminder_delivery', {
      p_user_id: params.userId,
      p_cycle_month: params.cycleMonth,
      p_token: token,
      p_reason: decision.reason,
    });
    if (!reconciled) return { status: 'reconciliation', reason: 'lost claim during reconciliation' };
    return { status: 'reconciliation', reason: decision.reason };
  }

  if (!process.env.RESEND_API_KEY?.trim()) {
    const released = await rpcBoolean(
      params.supabase,
      stored ? 'fail_email_reminder_delivery' : 'release_email_reminder_delivery',
      {
        p_user_id: params.userId,
        p_cycle_month: params.cycleMonth,
        p_token: token,
        p_error: 'RESEND_API_KEY not configured',
      },
    );
    if (!released) return { status: 'reconciliation', reason: 'lost claim before send' };
    return stored
      ? { status: 'failed', reason: 'RESEND_API_KEY not configured' }
      : { status: 'released', reason: 'RESEND_API_KEY not configured' };
  }

  const signed = signAdventureReminderUnsubscribe({ userId: params.userId, email: address });
  if (!signed) {
    const released = await rpcBoolean(params.supabase, 'release_email_reminder_delivery', {
      p_user_id: params.userId,
      p_cycle_month: params.cycleMonth,
      p_token: token,
      p_error: 'EMAIL_UNSUBSCRIBE_SECRET not configured',
    });
    if (!released) return { status: 'reconciliation', reason: 'lost claim during release' };
    return { status: 'released', reason: 'EMAIL_UNSUBSCRIBE_SECRET not configured' };
  }

  const fresh = await buildRedemptionReminderEmail({
    to: address,
    restaurantNames: params.restaurantNames,
    daysLeft: params.daysLeft,
    unsubscribeUrl: unsubscribeUrl(emailBaseUrl(), signed),
  });
  const idempotencyKey = row.idempotency_key || reminderKey(params.userId, params.cycleMonth);

  if (decision.action === 'compare_stored') {
    if (!stored) return { status: 'reconciliation', reason: 'stored payload missing' };
    const retry = decideStoredRetry({
      stored,
      fresh,
      usedAt: row.idempotency_key_used_at,
      now,
    });
    if (retry.action === 'reconcile') {
      const reconciled = await rpcBoolean(params.supabase, 'reconcile_email_reminder_delivery', {
        p_user_id: params.userId,
        p_cycle_month: params.cycleMonth,
        p_token: token,
        p_reason: retry.reason,
      });
      if (!reconciled) {
        return { status: 'reconciliation', reason: 'lost claim during reconciliation' };
      }
      return { status: 'reconciliation', reason: retry.reason };
    }
    return applySendResult(
      params.supabase,
      params.userId,
      params.cycleMonth,
      token,
      address,
      stored,
      idempotencyKey,
    );
  }

  const storedOk = await rpcBoolean(params.supabase, 'store_email_reminder_payload', {
    p_user_id: params.userId,
    p_cycle_month: params.cycleMonth,
    p_token: token,
    p_recipient: address,
    p_payload: fresh,
    p_idempotency_key: idempotencyKey,
  });
  if (!storedOk) return { status: 'skipped', reason: 'lost claim before send' };

  return applySendResult(
    params.supabase,
    params.userId,
    params.cycleMonth,
    token,
    address,
    fresh,
    idempotencyKey,
  );
}
