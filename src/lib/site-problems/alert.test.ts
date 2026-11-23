import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMAIL_FROM } from '@/lib/email-send';
import { formatChicagoReportTime } from '@/lib/site-problems/report';

const sendStoredEmail = vi.hoisted(() => vi.fn());
const lookup = vi.hoisted(() => ({
  name: 'Red Ash' as string | null,
  calls: 0,
  throwLookup: false,
}));
const afterHook = vi.hoisted(() => ({
  impl: ((_task: () => Promise<unknown>) => {
    throw new Error('after outside request');
  }) as (task: () => Promise<unknown>) => void,
}));

vi.mock('@/lib/resend', () => ({
  sendStoredEmail: (...args: unknown[]) => sendStoredEmail(...args),
}));

vi.mock('next/server', () => ({
  after: (task: () => Promise<unknown>) => afterHook.impl(task),
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => {
    lookup.calls += 1;
    if (lookup.throwLookup) throw new Error('db down');
    return {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              if (table === 'challenge_items') {
                return { data: { restaurant_id: 'rest-1' }, error: null };
              }
              if (!lookup.name) return { data: null, error: null };
              return { data: { name: lookup.name }, error: null };
            },
          }),
        }),
      }),
    };
  },
}));

import {
  buildProblemAlertEmail,
  deliverProblemAlert,
  problemAlertAdminUrl,
  problemAlertIdempotencyKey,
  runProblemAlert,
  scheduleProblemAlert,
  type ProblemAlertContent,
} from '@/lib/site-problems/alert';

const REPORT = '11111111-1111-4111-8111-111111111111';
const ITEM = '44444444-4444-4444-8444-444444444444';
const WHEN = '2026-01-15T05:30:00.000Z';

function siteContent(overrides: Partial<ProblemAlertContent> = {}): ProblemAlertContent {
  return {
    kind: 'site',
    reportId: REPORT,
    occurredAt: WHEN,
    place: '/challenges',
    categoryLabel: null,
    whatHappened: 'The button did nothing at all',
    reporter: 'visitor',
    ...overrides,
  };
}

describe('problem alert email', () => {
  beforeEach(() => {
    sendStoredEmail.mockReset();
    lookup.name = 'Red Ash';
    lookup.calls = 0;
    lookup.throwLookup = false;
    afterHook.impl = () => {
      throw new Error('after outside request');
    };
    vi.stubEnv('SITE_PROBLEM_ALERT_EMAIL', '');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://wanderbite.co');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://preview.example');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('builds a site alert in Chicago time with an escaped excerpt and no private fields', () => {
    const story = `Tom <b>waited</b> & said "no" at 'the door'`;
    const email = buildProblemAlertEmail(
      siteContent({ whatHappened: story, reporter: 'visitor' }),
      { to: 'owner@example.com', adminUrl: problemAlertAdminUrl('site') },
    );

    expect(email.from).toBe(EMAIL_FROM);
    expect(email.to).toBe('owner@example.com');
    expect(email.subject).toBe('New problem report: /challenges');
    expect(email.headers).toEqual({});
    expect(email.text).toContain('Site problem');
    expect(email.text).toContain('Page: /challenges');
    expect(email.text).toContain('Reporter: Visitor');
    expect(email.text).toContain(story);
    expect(email.text).not.toMatch(/^Category:/m);
    expect(email.text).toContain('https://wanderbite.co/admin/site-problems');
    expect(email.text).not.toContain('https://preview.example');
    expect(email.html.split('&lt;b&gt;waited&lt;/b&gt;')).toHaveLength(2);
    expect(email.html).toContain('&amp;');
    expect(email.html).toContain('&quot;no&quot;');
    expect(email.html).toContain('&#39;the door&#39;');
    expect(email.html).not.toContain('<b>');
    expect(email.html).toContain('https://wanderbite.co/admin/site-problems');

    const when = formatChicagoReportTime(WHEN);
    expect(when).toMatch(/Jan 14, 2026/);
    expect(when).toMatch(/11:30/);
    expect(email.text).toContain(`${when} (America/Chicago)`);
    expect(email.text).not.toContain('5:30');

    const packed = `${email.subject}\n${email.text}\n${email.html}`;
    expect(packed).not.toContain('member@example.com');
    expect(packed).not.toContain('user-1');
    expect(packed).not.toContain('Mozilla/5.0');
  });

  it('builds a visit alert with the restaurant, category, and member label', () => {
    const email = buildProblemAlertEmail(
      {
        kind: 'visit',
        reportId: REPORT,
        occurredAt: '2026-07-15T17:00:00.000Z',
        place: "Joe's & Grill",
        categoryLabel: "Restaurant wouldn't honor offer",
        whatHappened: 'The server refused the offer.',
        reporter: 'member',
      },
      { to: 'owner@example.com', adminUrl: problemAlertAdminUrl('visit') },
    );
    expect(email.subject).toBe("New problem report: Joe's & Grill");
    expect(email.text).toContain('Visit problem');
    expect(email.text).toContain("Restaurant: Joe's & Grill");
    expect(email.text).toContain("Category: Restaurant wouldn't honor offer");
    expect(email.text).toContain('Reporter: Signed-in member');
    expect(email.text).toContain('https://wanderbite.co/admin/visit-problems');
    expect(email.html).toContain('Joe&#39;s &amp; Grill');
    expect(email.html).toContain('wouldn&#39;t');
    const when = formatChicagoReportTime('2026-07-15T17:00:00.000Z');
    expect(when).toMatch(/Jul 15, 2026/);
    expect(when).toMatch(/12:00/);
    expect(email.text).toContain(when ?? '');
    expect(email.text).not.toContain(ITEM);
  });

  it('truncates to 300 code points before escaping', () => {
    const story = `${'a'.repeat(300)}<script>alert(1)</script>😀`;
    const email = buildProblemAlertEmail(siteContent({ whatHappened: story }), {
      to: 'owner@example.com',
      adminUrl: 'https://wanderbite.co/admin/site-problems',
    });
    expect(email.text).toContain(`${'a'.repeat(300)}…`);
    expect(email.text).not.toContain('<script>');
    expect(email.text).not.toContain('😀');
    expect(email.html).toContain(`${'a'.repeat(300)}…`);
    expect(email.html).not.toContain('<script>');
    expect(email.html).not.toContain('&lt;script&gt;');
  });

  it('keeps a short unsafe excerpt escaped and caps a long subject', () => {
    const email = buildProblemAlertEmail(
      siteContent({
        place: `<script>\n${'p'.repeat(140)}`,
        whatHappened: '<script>alert("x")</script>',
      }),
      { to: 'owner@example.com', adminUrl: 'https://wanderbite.co/admin/site-problems' },
    );
    expect(email.html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(email.text).toContain('<script>alert("x")</script>');
    expect(Array.from(email.subject).length).toBeLessThanOrEqual(120);
    expect(email.subject.startsWith('New problem report:')).toBe(true);
    expect(email.subject).not.toContain('\n');
  });

  it('skips without calling Resend when the recipient or API key is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('SITE_PROBLEM_ALERT_EMAIL', '');
    vi.stubEnv('RESEND_API_KEY', 're_test');
    await expect(deliverProblemAlert(siteContent())).resolves.toEqual({
      outcome: 'skipped',
      reason: 'recipient_unset',
    });

    vi.stubEnv('SITE_PROBLEM_ALERT_EMAIL', '   ');
    await expect(deliverProblemAlert(siteContent())).resolves.toEqual({
      outcome: 'skipped',
      reason: 'recipient_unset',
    });

    vi.stubEnv('SITE_PROBLEM_ALERT_EMAIL', 'owner@example.com, other@example.com');
    await expect(deliverProblemAlert(siteContent())).resolves.toEqual({
      outcome: 'skipped',
      reason: 'recipient_invalid',
    });

    vi.stubEnv('SITE_PROBLEM_ALERT_EMAIL', 'owner@example.com');
    vi.stubEnv('RESEND_API_KEY', '  ');
    await expect(deliverProblemAlert(siteContent())).resolves.toEqual({
      outcome: 'skipped',
      reason: 'api_key_unset',
    });

    expect(sendStoredEmail).not.toHaveBeenCalled();
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      '[problem-alert] skipped count=1 reason=recipient_unset',
      '[problem-alert] skipped count=1 reason=recipient_unset',
      '[problem-alert] skipped count=1 reason=recipient_invalid',
      '[problem-alert] skipped count=1 reason=api_key_unset',
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('The button did nothing');
  });

  it('sends once with a stable idempotency key and isolates provider errors', async () => {
    vi.stubEnv('SITE_PROBLEM_ALERT_EMAIL', ' Owner@Example.com ');
    vi.stubEnv('RESEND_API_KEY', 're_test');
    sendStoredEmail.mockResolvedValueOnce({ outcome: 'sent', messageId: 'msg_1' });

    await expect(deliverProblemAlert(siteContent())).resolves.toEqual({
      outcome: 'sent',
      messageId: 'msg_1',
    });
    expect(sendStoredEmail).toHaveBeenCalledTimes(1);
    const [payload, key] = sendStoredEmail.mock.calls[0] as [Record<string, unknown>, string];
    expect(payload.to).toBe('owner@example.com');
    expect(payload.from).toBe(EMAIL_FROM);
    expect(key).toBe(problemAlertIdempotencyKey('site', REPORT));

    sendStoredEmail.mockResolvedValueOnce({ outcome: 'sent', messageId: 'msg_2' });
    await deliverProblemAlert(siteContent());
    expect(sendStoredEmail.mock.calls[1]?.[1]).toBe(key);

    sendStoredEmail.mockResolvedValueOnce({ outcome: 'definite_failure', error: 'bad request' });
    await expect(deliverProblemAlert(siteContent())).resolves.toEqual({
      outcome: 'failed',
      error: 'bad request',
    });

    sendStoredEmail.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(deliverProblemAlert(siteContent())).resolves.toEqual({
      outcome: 'failed',
      error: 'socket hang up',
    });
    expect(sendStoredEmail).toHaveBeenCalledTimes(4);
  });

  it('looks up the restaurant for a visit case and still sends when that lookup fails', async () => {
    vi.stubEnv('SITE_PROBLEM_ALERT_EMAIL', 'owner@example.com');
    vi.stubEnv('RESEND_API_KEY', 're_test');
    sendStoredEmail.mockResolvedValue({ outcome: 'sent', messageId: 'msg_visit' });

    const visit = {
      kind: 'visit' as const,
      reportId: REPORT,
      occurredAt: WHEN,
      challengeItemId: ITEM,
      categoryLabel: 'Wrong discount',
      whatHappened: 'The discount was wrong on the bill.',
    };
    await expect(runProblemAlert(visit)).resolves.toEqual({ outcome: 'sent', messageId: 'msg_visit' });
    const payload = sendStoredEmail.mock.calls[0]?.[0] as { text: string; html: string; subject: string };
    expect(payload.subject).toBe('New problem report: Red Ash');
    expect(payload.text).toContain('Restaurant: Red Ash');
    expect(payload.text).toContain('Category: Wrong discount');
    expect(payload.text).toContain('Reporter: Signed-in member');
    expect(payload.text).not.toContain(ITEM);
    expect(payload.html).not.toContain(ITEM);
    expect(lookup.calls).toBe(1);
    expect(sendStoredEmail.mock.calls[0]?.[1]).toBe(problemAlertIdempotencyKey('visit', REPORT));

    lookup.throwLookup = true;
    await expect(runProblemAlert(visit)).resolves.toMatchObject({ outcome: 'sent' });
    const fallback = sendStoredEmail.mock.calls[1]?.[0] as { text: string };
    expect(fallback.text).toContain('Restaurant: (unknown)');
  });

  it('schedules the send on after() and does not throw when that cannot run', async () => {
    vi.stubEnv('SITE_PROBLEM_ALERT_EMAIL', 'owner@example.com');
    vi.stubEnv('RESEND_API_KEY', 're_test');
    sendStoredEmail.mockResolvedValue({ outcome: 'sent', messageId: 'msg_later' });

    const queued: { task: (() => Promise<unknown>) | null } = { task: null };
    afterHook.impl = (task) => {
      queued.task = task;
    };
    scheduleProblemAlert({
      kind: 'site',
      reportId: REPORT,
      occurredAt: WHEN,
      pagePath: '/challenges',
      whatHappened: 'The button did nothing at all',
      reporter: 'member',
    });
    expect(sendStoredEmail).not.toHaveBeenCalled();
    expect(lookup.calls).toBe(0);
    await queued.task?.();
    expect(sendStoredEmail).toHaveBeenCalledTimes(1);
    const held = sendStoredEmail.mock.calls[0]?.[0] as { text: string };
    expect(held.text).toContain('Reporter: Signed-in member');
    expect(held.text).toContain('Page: /challenges');

    sendStoredEmail.mockRejectedValueOnce(new Error('resend down'));
    await expect(queued.task?.()).resolves.toMatchObject({ outcome: 'failed', error: 'resend down' });

    afterHook.impl = () => {
      throw new Error('no request');
    };
    expect(() =>
      scheduleProblemAlert({
        kind: 'site',
        reportId: REPORT,
        occurredAt: WHEN,
        pagePath: '/journal',
        whatHappened: 'The page stayed blank.',
        reporter: 'visitor',
      }),
    ).not.toThrow();
    await vi.waitFor(() => expect(sendStoredEmail).toHaveBeenCalledTimes(3));
  });

  it('uses NEXT_PUBLIC_BASE_URL and ignores a non-http origin', () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://wanderbite.co/');
    expect(problemAlertAdminUrl('site')).toBe('https://wanderbite.co/admin/site-problems');
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'javascript:alert(1)');
    expect(problemAlertAdminUrl('visit')).toBe('https://wanderbite.co/admin/visit-problems');
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', '');
    expect(problemAlertAdminUrl('site')).toBe('https://wanderbite.co/admin/site-problems');
  });
});
