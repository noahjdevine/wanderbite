import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  enabled: true,
  auth: { ok: true as const, userId: 'admin-1', email: 'admin@example.com' } as
    | { ok: true; userId: string; email: string | null }
    | { ok: false; error: string; code: string },
  assertCalls: 0,
  row: { id: '5c1e0000-0000-4000-8000-000000000011', status: 'new', admin_note: null } as {
    id: string;
    status: string;
    admin_note: string | null;
  } | null,
  selectError: null as { message: string } | null,
  updateError: null as { message: string } | null,
  updates: [] as unknown[],
  audits: [] as unknown[],
}));

vi.mock('@/lib/site-problems/flag', () => ({
  siteProblemReportsEnabled: () => harness.enabled,
}));

vi.mock('@/lib/auth/assert-admin', () => ({
  assertAdmin: async () => {
    harness.assertCalls += 1;
    return harness.auth;
  },
}));

vi.mock('@/lib/audit/log-admin-action', () => ({
  logAdminAction: async (entry: unknown) => {
    harness.audits.push(entry);
    return true;
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      const api = {
        select: () => api,
        eq: () => api,
        maybeSingle: async () => ({ data: harness.row, error: harness.selectError }),
        update: (payload: unknown) => {
          harness.updates.push(payload);
          return {
            eq: async () => ({ error: harness.updateError }),
          };
        },
      };
      return api;
    },
  }),
}));

import { updateSiteProblemReport, type SiteProblemReviewState } from '@/app/(site)/admin/site-problem-actions';

const idle: SiteProblemReviewState = { ok: false, code: 'idle', message: '' };
const reportId = '5c1e0000-0000-4000-8000-000000000011';

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe('updateSiteProblemReport', () => {
  beforeEach(() => {
    harness.enabled = true;
    harness.auth = { ok: true, userId: 'admin-1', email: 'admin@example.com' };
    harness.assertCalls = 0;
    harness.row = { id: reportId, status: 'new', admin_note: null };
    harness.selectError = null;
    harness.updateError = null;
    harness.updates = [];
    harness.audits = [];
  });

  it('refuses when the flag is off before the admin check', async () => {
    harness.enabled = false;
    const result = await updateSiteProblemReport(idle, form({ id: reportId, status: 'reviewed' }));
    expect(result).toMatchObject({ ok: false, code: 'disabled' });
    expect(harness.assertCalls).toBe(0);
    expect(harness.updates).toEqual([]);
  });

  it('blocks someone who is not an admin', async () => {
    harness.auth = { ok: false, error: 'Unauthorized', code: 'not_admin' };
    const result = await updateSiteProblemReport(idle, form({ id: reportId, status: 'closed' }));
    expect(result).toMatchObject({ ok: false, code: 'forbidden' });
    expect(harness.updates).toEqual([]);
    expect(harness.audits).toEqual([]);
  });

  it('marks a report reviewed and writes an audit row', async () => {
    const result = await updateSiteProblemReport(idle, form({
      id: reportId,
      status: 'reviewed',
      admin_note: 'Saw it',
    }));
    expect(result).toEqual({ ok: true });
    expect(harness.updates[0]).toMatchObject({
      status: 'reviewed',
      admin_note: 'Saw it',
      reviewed_by: 'admin-1',
    });
    const update = harness.updates[0] as { reviewed_at: string };
    expect(update.reviewed_at).toEqual(expect.any(String));
    expect(harness.audits).toEqual([
      {
        actorUserId: 'admin-1',
        action: 'site_problem.review',
        targetType: 'site_problem_report',
        targetId: reportId,
        metadata: { from_status: 'new', to_status: 'reviewed', note_set: true },
      },
    ]);
  });

  it('rejects a status we do not use and a note that is too long', async () => {
    const status = await updateSiteProblemReport(idle, form({ id: reportId, status: 'open' }));
    expect(status).toMatchObject({ ok: false, code: 'invalid_status' });
    const note = await updateSiteProblemReport(idle, form({
      id: reportId,
      status: 'closed',
      admin_note: 'n'.repeat(501),
    }));
    expect(note).toMatchObject({ ok: false, code: 'invalid_note' });
    expect(harness.updates).toEqual([]);
    expect(harness.audits).toEqual([]);
  });
});
