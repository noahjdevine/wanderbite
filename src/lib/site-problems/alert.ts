import 'server-only';

import { after } from 'next/server';
import { normalizeMailbox } from '@/lib/email-address';
import { EMAIL_FROM, type StoredEmailPayload } from '@/lib/email-send';
import { sendStoredEmail } from '@/lib/resend';
import { formatChicagoReportTime } from '@/lib/site-problems/report';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/** First this many code points of the report. Longer text keeps an ellipsis. */
export const PROBLEM_ALERT_EXCERPT_CHARS = 300;

const FALLBACK_ORIGIN = 'https://wanderbite.co';
const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export type ProblemAlertKind = 'site' | 'visit';

/** Fields the email may contain. No account email, user id, or user agent. */
export type ProblemAlertContent = {
  kind: ProblemAlertKind;
  reportId: string;
  occurredAt: string;
  place: string | null;
  categoryLabel: string | null;
  whatHappened: string;
  reporter: 'member' | 'visitor';
};

export type ScheduledProblemAlert =
  | {
      kind: 'site';
      reportId: string;
      occurredAt: string;
      pagePath: string | null;
      whatHappened: string;
      reporter: 'member' | 'visitor';
    }
  | {
      kind: 'visit';
      reportId: string;
      occurredAt: string;
      challengeItemId: string;
      categoryLabel: string;
      whatHappened: string;
    };

export type ProblemAlertDelivery =
  | { outcome: 'skipped'; reason: 'recipient_unset' | 'recipient_invalid' | 'api_key_unset' | 'missing_report' }
  | { outcome: 'sent'; messageId: string }
  | { outcome: 'failed'; error: string };

export function escapeProblemAlertHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPE[char] ?? char);
}

export function excerptProblemText(value: string): { text: string; truncated: boolean } {
  const chars = Array.from(value);
  if (chars.length <= PROBLEM_ALERT_EXCERPT_CHARS) return { text: value, truncated: false };
  return { text: chars.slice(0, PROBLEM_ALERT_EXCERPT_CHARS).join(''), truncated: true };
}

/** Resend key for this one report. A retry of the same report collapses for 24 hours. */
export function problemAlertIdempotencyKey(kind: ProblemAlertKind, reportId: string): string {
  const id = reportId.replace(/[^A-Za-z0-9-]/g, '').slice(0, 80);
  return `problem-alert/${kind}/${id}`;
}

export function problemAlertAdminUrl(kind: ProblemAlertKind): string {
  const path = kind === 'site' ? '/admin/site-problems' : '/admin/visit-problems';
  const raw = process.env.NEXT_PUBLIC_BASE_URL?.trim().replace(/\/+$/, '') || FALLBACK_ORIGIN;
  try {
    const url = new URL(raw);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
      return `${FALLBACK_ORIGIN}${path}`;
    }
    return `${url.origin}${path}`;
  } catch {
    return `${FALLBACK_ORIGIN}${path}`;
  }
}

function kindLabel(kind: ProblemAlertKind): string {
  return kind === 'site' ? 'Site problem' : 'Visit problem';
}

function subjectPlace(kind: ProblemAlertKind, place: string | null): string {
  const cleaned = (place ?? '').replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || (kind === 'site' ? 'site' : 'visit');
}

export function problemAlertSubject(kind: ProblemAlertKind, place: string | null): string {
  const subject = `New problem report: ${subjectPlace(kind, place)}`;
  const chars = Array.from(subject);
  if (chars.length <= 120) return subject;
  return `${chars.slice(0, 119).join('')}…`;
}

function reporterLabel(reporter: ProblemAlertContent['reporter']): string {
  return reporter === 'member' ? 'Signed-in member' : 'Visitor';
}

/**
 * Plain text and simple HTML for one owner alert.
 * The excerpt is cut first, then HTML-escaped, so a tag cannot survive truncation.
 */
export function buildProblemAlertEmail(
  input: ProblemAlertContent,
  options: { to: string; adminUrl: string },
): StoredEmailPayload {
  const excerpt = excerptProblemText(input.whatHappened);
  const story = excerpt.truncated ? `${excerpt.text}…` : excerpt.text;
  const when = formatChicagoReportTime(input.occurredAt) ?? 'Unknown time';
  const header = [
    kindLabel(input.kind),
    `Time: ${when} (America/Chicago)`,
    input.kind === 'site'
      ? `Page: ${input.place?.trim() || '(none)'}`
      : `Restaurant: ${input.place?.trim() || '(unknown)'}`,
  ];
  if (input.kind === 'visit') header.push(`Category: ${input.categoryLabel?.trim() || '(none)'}`);
  header.push(`Reporter: ${reporterLabel(input.reporter)}`);

  const text = [...header, '', 'What happened:', story, '', options.adminUrl].join('\n');
  const escapedUrl = escapeProblemAlertHtml(options.adminUrl);
  const html = [
    ...header.map((line) => `<p>${escapeProblemAlertHtml(line)}</p>`),
    '<p>What happened:</p>',
    `<p style="white-space:pre-wrap">${escapeProblemAlertHtml(story)}</p>`,
    `<p><a href="${escapedUrl}">${escapedUrl}</a></p>`,
  ].join('');

  return {
    from: EMAIL_FROM,
    to: options.to,
    subject: problemAlertSubject(input.kind, input.place),
    html,
    text,
    headers: {},
  };
}

function logSkip(reason: ProblemAlertDelivery & { outcome: 'skipped' }): void {
  console.warn(`[problem-alert] skipped count=1 reason=${reason.reason}`);
}

export async function deliverProblemAlert(input: ProblemAlertContent): Promise<ProblemAlertDelivery> {
  if (!input.reportId.trim()) {
    const skipped = { outcome: 'skipped', reason: 'missing_report' } as const;
    logSkip(skipped);
    return skipped;
  }

  const rawRecipient = process.env.SITE_PROBLEM_ALERT_EMAIL;
  if (typeof rawRecipient !== 'string' || rawRecipient.trim() === '') {
    const skipped = { outcome: 'skipped', reason: 'recipient_unset' } as const;
    logSkip(skipped);
    return skipped;
  }
  const to = normalizeMailbox(rawRecipient);
  if (!to) {
    const skipped = { outcome: 'skipped', reason: 'recipient_invalid' } as const;
    logSkip(skipped);
    return skipped;
  }
  if (!process.env.RESEND_API_KEY?.trim()) {
    const skipped = { outcome: 'skipped', reason: 'api_key_unset' } as const;
    logSkip(skipped);
    return skipped;
  }

  const payload = buildProblemAlertEmail(input, { to, adminUrl: problemAlertAdminUrl(input.kind) });
  try {
    const result = await sendStoredEmail(payload, problemAlertIdempotencyKey(input.kind, input.reportId));
    if (result.outcome === 'sent') return { outcome: 'sent', messageId: result.messageId };
    console.error(`[problem-alert] send failed outcome=${result.outcome}`);
    return { outcome: 'failed', error: result.error };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    console.error('[problem-alert] send threw');
    return { outcome: 'failed', error: message };
  }
}

async function readRestaurantName(challengeItemId: string): Promise<string | null> {
  const admin = getSupabaseAdmin();
  const item = await admin
    .from('challenge_items')
    .select('restaurant_id')
    .eq('id', challengeItemId)
    .maybeSingle();
  if (item.error || !item.data?.restaurant_id) return null;
  const restaurant = await admin
    .from('restaurants')
    .select('name')
    .eq('id', item.data.restaurant_id)
    .maybeSingle();
  if (restaurant.error) return null;
  const name = restaurant.data?.name?.trim();
  return name || null;
}

/** Resolve the restaurant name, then send. A lookup failure still sends, without a name. */
export async function runProblemAlert(input: ScheduledProblemAlert): Promise<ProblemAlertDelivery> {
  try {
    let place: string | null = null;
    if (input.kind === 'site') {
      place = input.pagePath;
    } else {
      try {
        place = await readRestaurantName(input.challengeItemId);
      } catch (error) {
        console.error(
          '[problem-alert] restaurant lookup failed',
          error instanceof Error ? error.message : 'unknown',
        );
        place = null;
      }
    }
    return await deliverProblemAlert({
      kind: input.kind,
      reportId: input.reportId,
      occurredAt: input.occurredAt,
      place,
      categoryLabel: input.kind === 'visit' ? input.categoryLabel : null,
      whatHappened: input.whatHappened,
      reporter: input.kind === 'visit' ? 'member' : input.reporter,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    console.error('[problem-alert] isolated', message);
    return { outcome: 'failed', error: message };
  }
}

/**
 * Send after the response. `after` keeps the invocation alive without making
 * the member wait. If it cannot schedule, the send is still attempted and
 * any error stays inside this function.
 */
export function scheduleProblemAlert(input: ScheduledProblemAlert): void {
  try {
    after(() => runProblemAlert(input));
  } catch (error) {
    console.error(
      '[problem-alert] after unavailable',
      error instanceof Error ? error.message : 'unknown',
    );
    void runProblemAlert(input);
  }
}
