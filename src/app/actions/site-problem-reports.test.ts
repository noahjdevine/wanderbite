import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RATE_LIMIT_MESSAGE, SAVE_FAILED_MESSAGE } from '@/lib/site-problems/report';

const harness = vi.hoisted(() => ({
  enabled: true,
  user: null as { id: string; email?: string } | null,
  getUserCalls: 0,
  headers: {} as Record<string, string>,
  ip: null as string | null,
  limit: 'allowed' as 'allowed' | 'rate_limited' | 'unavailable',
  limitIds: [] as string[],
  inserts: [] as unknown[],
  insertError: null as { message: string } | null,
}));

vi.mock('@/lib/site-problems/flag', () => ({
  siteProblemReportsEnabled: () => harness.enabled,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => {
        harness.getUserCalls += 1;
        return { data: { user: harness.user } };
      },
    },
  }),
}));

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) => harness.headers[name.toLowerCase()] ?? null,
  }),
}));

vi.mock('@/lib/client-ip', () => ({
  trustedClientIpFromHeaders: () => harness.ip,
}));

vi.mock('@/lib/ai-ip-hash', () => ({
  hashClientIp: (ip: string) => `v1:${ip}`,
}));

vi.mock('@/lib/ratelimit', () => ({
  evaluateSiteProblemReportLimit: async (id: string) => {
    harness.limitIds.push(id);
    return harness.limit;
  },
}));

const scheduleProblemAlert = vi.hoisted(() => vi.fn());

vi.mock('@/lib/site-problems/alert', () => ({
  scheduleProblemAlert: (...args: unknown[]) => scheduleProblemAlert(...args),
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => ({
      insert: (row: unknown) => {
        harness.inserts.push({ table, row });
        return {
          select: () => ({
            single: async () => ({
              data: harness.insertError
                ? null
                : {
                    id: '11111111-1111-4111-8111-111111111111',
                    created_at: '2026-11-23T18:41:00.000Z',
                  },
              error: harness.insertError,
            }),
          }),
        };
      },
    }),
  }),
}));

import { submitSiteProblemReport, type SiteProblemFormState } from './site-problem-reports';

const idle: SiteProblemFormState = { ok: false, code: 'idle', message: '' };
const story = 'The button did nothing at all';

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe('submitSiteProblemReport', () => {
  beforeEach(() => {
    harness.enabled = true;
    harness.user = null;
    harness.getUserCalls = 0;
    harness.headers = { 'user-agent': `Agent/${'u'.repeat(320)}` };
    harness.ip = '203.0.113.10';
    harness.limit = 'allowed';
    harness.limitIds = [];
    harness.inserts = [];
    harness.insertError = null;
    scheduleProblemAlert.mockReset();
    vi.stubEnv('NODE_ENV', 'test');
  });

  it('refuses when the flag is off before looking up a user', async () => {
    harness.enabled = false;
    const result = await submitSiteProblemReport(idle, form({ what_happened: story }));
    expect(result).toMatchObject({ ok: false, code: 'disabled' });
    expect(harness.getUserCalls).toBe(0);
    expect(harness.inserts).toEqual([]);
    expect(scheduleProblemAlert).not.toHaveBeenCalled();
  });

  it('stores a signed-out report with or without an email and no user id', async () => {
    const withEmail = await submitSiteProblemReport(idle, form({
      what_happened: story,
      contact_email: 'Guest@Example.com',
      page_path: '/challenges',
      trying_to_do: 'Open my challenge',
    }));
    expect(withEmail).toEqual({ ok: true, returnPath: '/challenges' });

    const withoutEmail = await submitSiteProblemReport(idle, form({
      what_happened: story,
      page_path: 'https://evil.example/phish',
    }));
    expect(withoutEmail).toEqual({ ok: true, returnPath: null });

    expect(harness.inserts).toEqual([
      {
        table: 'site_problem_reports',
        row: {
          user_id: null,
          contact_email: 'guest@example.com',
          page_path: '/challenges',
          what_happened: story,
          trying_to_do: 'Open my challenge',
          user_agent: 'u'.repeat(300).replace(/^/, 'Agent/').slice(0, 300),
        },
      },
      {
        table: 'site_problem_reports',
        row: {
          user_id: null,
          contact_email: null,
          page_path: null,
          what_happened: story,
          trying_to_do: null,
          user_agent: expect.any(String),
        },
      },
    ]);
    const first = harness.inserts[0] as { row: { user_agent: string } };
    expect(first.row.user_agent.length).toBe(300);
    expect(JSON.stringify(harness.inserts)).not.toContain('203.0.113.10');
    expect(harness.limitIds).toEqual(['ip:v1:203.0.113.10', 'ip:v1:203.0.113.10']);
    expect(scheduleProblemAlert).toHaveBeenCalledTimes(2);
    expect(scheduleProblemAlert).toHaveBeenNthCalledWith(1, {
      kind: 'site',
      reportId: '11111111-1111-4111-8111-111111111111',
      occurredAt: '2026-11-23T18:41:00.000Z',
      pagePath: '/challenges',
      whatHappened: story,
      reporter: 'visitor',
    });
    expect(JSON.stringify(scheduleProblemAlert.mock.calls)).not.toContain('guest@example.com');
    expect(JSON.stringify(scheduleProblemAlert.mock.calls)).not.toContain('Agent/');
  });

  it('stores the signed-in user id and ignores a posted email', async () => {
    harness.user = { id: 'user-1', email: 'member@example.com' };
    const result = await submitSiteProblemReport(idle, form({
      what_happened: story,
      contact_email: 'other@example.com',
      page_path: '/challenges',
    }));
    expect(result).toEqual({ ok: true, returnPath: '/challenges' });
    expect(harness.inserts[0]).toMatchObject({
      row: { user_id: 'user-1', contact_email: null, page_path: '/challenges' },
    });
    expect(harness.limitIds).toEqual(['user:user-1']);
    expect(scheduleProblemAlert).toHaveBeenCalledWith(expect.objectContaining({
      reporter: 'member',
      pagePath: '/challenges',
    }));
    expect(JSON.stringify(scheduleProblemAlert.mock.calls)).not.toContain('user-1');
    expect(JSON.stringify(scheduleProblemAlert.mock.calls)).not.toContain('member@example.com');
    expect(JSON.stringify(scheduleProblemAlert.mock.calls)).not.toContain('other@example.com');
  });

  it('rejects a short story and a filled honeypot without inserting', async () => {
    const short = await submitSiteProblemReport(idle, form({ what_happened: 'too short' }));
    expect(short).toMatchObject({ ok: false, code: 'what_happened' });

    const honeypot = await submitSiteProblemReport(idle, form({
      what_happened: story,
      company_website: 'https://spam.example',
    }));
    expect(honeypot).toMatchObject({ ok: false, code: 'rejected' });
    expect(harness.inserts).toEqual([]);
    expect(scheduleProblemAlert).not.toHaveBeenCalled();
  });

  it('returns a friendly message when the rate limit says no', async () => {
    harness.limit = 'rate_limited';
    const result = await submitSiteProblemReport(idle, form({ what_happened: story }));
    expect(result).toEqual({ ok: false, code: 'rate_limited', message: RATE_LIMIT_MESSAGE });
    expect(harness.inserts).toEqual([]);
  });

  it('refuses in production when the limiter is unavailable', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    harness.limit = 'unavailable';
    const result = await submitSiteProblemReport(idle, form({ what_happened: story }));
    expect(result).toMatchObject({ ok: false, code: 'rate_limited', message: RATE_LIMIT_MESSAGE });
    expect(harness.inserts).toEqual([]);
  });

  it('tells the visitor when the save fails', async () => {
    harness.insertError = { message: 'relation does not exist' };
    const result = await submitSiteProblemReport(idle, form({ what_happened: story }));
    expect(result).toEqual({ ok: false, code: 'unavailable', message: SAVE_FAILED_MESSAGE });
    expect(scheduleProblemAlert).not.toHaveBeenCalled();
  });

  it('still saves when scheduling the owner alert throws', async () => {
    scheduleProblemAlert.mockImplementation(() => {
      throw new Error('after blew up');
    });
    const result = await submitSiteProblemReport(idle, form({
      what_happened: story,
      page_path: '/challenges',
    }));
    expect(result).toEqual({ ok: true, returnPath: '/challenges' });
    expect(harness.inserts).toHaveLength(1);
  });
});
