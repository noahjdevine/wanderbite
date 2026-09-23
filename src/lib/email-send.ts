import { differenceInMilliseconds } from 'date-fns';

export const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

export const EMAIL_FROM = 'Wanderbite <noreply@wanderbite.com>';

export type StoredEmailPayload = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
};

export type EmailSendOutcome =
  | { outcome: 'sent'; messageId: string }
  | { outcome: 'suppressed'; error: string }
  | { outcome: 'definite_failure'; error: string }
  | { outcome: 'uncertain'; error: string }
  | { outcome: 'payload_mismatch'; error: string };

type ResendErrorLike = {
  message?: string;
  statusCode?: number | null;
  name?: string;
};

export function idempotencyKeyExpired(usedAt: string, now: Date): boolean {
  const used = new Date(usedAt);
  if (Number.isNaN(used.getTime())) return true;
  return differenceInMilliseconds(now, used) >= IDEMPOTENCY_WINDOW_MS;
}

export function isProviderSuppressionMessage(message: string): boolean {
  const text = message.toLowerCase();
  return text.includes('suppression list') || text.includes('already suppressed');
}

export function classifyResendError(error: ResendErrorLike): EmailSendOutcome {
  const message = error.message?.trim() || 'Resend returned an error';
  if (isProviderSuppressionMessage(message)) {
    return { outcome: 'suppressed', error: message };
  }
  const name = error.name ?? '';
  const status = error.statusCode ?? null;
  if (
    name === 'invalid_idempotent_request' ||
    (status === 409 && /invalid_idempotent_request/i.test(message))
  ) {
    return { outcome: 'payload_mismatch', error: message };
  }
  if (
    name === 'concurrent_idempotent_requests' ||
    status === 409 ||
    status == null ||
    status >= 500
  ) {
    return { outcome: 'uncertain', error: message };
  }
  if (status >= 400 && status < 500) {
    return { outcome: 'definite_failure', error: message };
  }
  return { outcome: 'uncertain', error: message };
}

export function classifyResendSend(input: {
  data: { id?: string | null } | null;
  error: ResendErrorLike | null;
}): EmailSendOutcome {
  if (input.error) return classifyResendError(input.error);
  const messageId = input.data?.id?.trim();
  if (!messageId) {
    return { outcome: 'uncertain', error: 'Resend returned no message id' };
  }
  return { outcome: 'sent', messageId };
}

function stableHeaders(headers: Record<string, string>): string {
  return JSON.stringify(
    Object.keys(headers)
      .sort()
      .map((key) => [key, headers[key]]),
  );
}

export function emailPayloadsMatch(left: StoredEmailPayload, right: StoredEmailPayload): boolean {
  return (
    left.from === right.from &&
    left.to === right.to &&
    left.subject === right.subject &&
    left.html === right.html &&
    left.text === right.text &&
    stableHeaders(left.headers) === stableHeaders(right.headers)
  );
}

export function parseStoredEmailPayload(value: unknown): StoredEmailPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const headers = record.headers;
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return null;
  const headerEntries = Object.entries(headers);
  if (headerEntries.some(([, header]) => typeof header !== 'string')) return null;
  if (
    typeof record.from !== 'string' ||
    typeof record.to !== 'string' ||
    typeof record.subject !== 'string' ||
    typeof record.html !== 'string' ||
    typeof record.text !== 'string'
  ) {
    return null;
  }
  return {
    from: record.from,
    to: record.to,
    subject: record.subject,
    html: record.html,
    text: record.text,
    headers: Object.fromEntries(headerEntries) as Record<string, string>,
  };
}

export type ReminderPreSendDecision =
  | { action: 'skip'; status: 'skipped_opt_out' | 'skipped_suppressed' }
  | { action: 'release'; error: string }
  | { action: 'reconcile'; reason: string }
  | { action: 'send_fresh' }
  | { action: 'compare_stored' };

export function decideReminderPreSend(input: {
  previousStatus: string;
  hasPayload: boolean;
  usedAt: string | null;
  optedOut: boolean;
  suppressed: boolean;
  hasUnsubscribeSecret: boolean;
  now: Date;
}): ReminderPreSendDecision {
  if (input.optedOut) return { action: 'skip', status: 'skipped_opt_out' };
  if (input.suppressed) return { action: 'skip', status: 'skipped_suppressed' };

  if (input.hasPayload && input.previousStatus === 'processing') {
    return { action: 'reconcile', reason: 'uncertain_send' };
  }

  if (input.hasPayload && input.previousStatus === 'failed') {
    if (!input.usedAt) return { action: 'reconcile', reason: 'idempotency_key_not_recorded' };
    if (idempotencyKeyExpired(input.usedAt, input.now)) {
      return { action: 'reconcile', reason: 'idempotency_key_expired' };
    }
    if (!input.hasUnsubscribeSecret) {
      return { action: 'release', error: 'EMAIL_UNSUBSCRIBE_SECRET not configured' };
    }
    return { action: 'compare_stored' };
  }

  if (!input.hasPayload) {
    if (!input.hasUnsubscribeSecret) {
      return { action: 'release', error: 'EMAIL_UNSUBSCRIBE_SECRET not configured' };
    }
    return { action: 'send_fresh' };
  }

  return { action: 'reconcile', reason: 'unexpected_reminder_state' };
}

export function decideStoredRetry(input: {
  stored: StoredEmailPayload;
  fresh: StoredEmailPayload;
  usedAt: string | null;
  now: Date;
}): { action: 'send_stored' } | { action: 'reconcile'; reason: string } {
  if (!input.usedAt) return { action: 'reconcile', reason: 'idempotency_key_not_recorded' };
  if (idempotencyKeyExpired(input.usedAt, input.now)) {
    return { action: 'reconcile', reason: 'idempotency_key_expired' };
  }
  if (!emailPayloadsMatch(input.stored, input.fresh)) {
    return { action: 'reconcile', reason: 'payload_changed' };
  }
  return { action: 'send_stored' };
}

export type ConfirmationPreSendDecision =
  | { action: 'suppress' }
  | { action: 'send_fresh' }
  | { action: 'compare_stored' }
  | { action: 'reconcile'; reason: string };

export function decideConfirmationPreSend(input: {
  suppressed: boolean;
  hasPayload: boolean;
  attemptState: string | null;
  usedAt: string | null;
  now: Date;
}): ConfirmationPreSendDecision {
  if (input.suppressed) return { action: 'suppress' };
  if (!input.hasPayload) return { action: 'send_fresh' };
  if (input.attemptState !== 'definite_failure') {
    return { action: 'reconcile', reason: 'uncertain_send' };
  }
  if (!input.usedAt) return { action: 'reconcile', reason: 'idempotency_key_not_recorded' };
  if (idempotencyKeyExpired(input.usedAt, input.now)) {
    return { action: 'reconcile', reason: 'idempotency_key_expired' };
  }
  return { action: 'compare_stored' };
}

export function decideAfterSend(
  result: EmailSendOutcome,
):
  | { action: 'complete'; messageId: string }
  | { action: 'suppress'; error: string }
  | { action: 'fail'; error: string }
  | { action: 'reconcile'; reason: string } {
  if (result.outcome === 'sent') return { action: 'complete', messageId: result.messageId };
  if (result.outcome === 'suppressed') return { action: 'suppress', error: result.error };
  if (result.outcome === 'definite_failure') return { action: 'fail', error: result.error };
  if (result.outcome === 'payload_mismatch') {
    return { action: 'reconcile', reason: 'invalid_idempotent_request' };
  }
  return { action: 'reconcile', reason: 'uncertain_send' };
}
