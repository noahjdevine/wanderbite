import type { ReactElement, ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminPage from '@/app/(site)/admin/page';
import { AdminMfaGate } from '@/app/(site)/admin/admin-mfa-gate';
import AdminDrawingsPage from '@/app/(site)/admin/drawings/page';
import { DrawingsAdmin } from '@/app/(site)/admin/drawings/drawings-admin';
import { DRAWINGS_NOT_SET_UP, type DrawingsAdminView } from '@/lib/drawings/admin-read-model';

type Query = {
  table: string;
  select: string | null;
  eqId: string | null;
};

type QueryResult = { data: unknown; error: { message: string; code?: string } | null };

const harness = vi.hoisted(() => ({
  calls: [] as Query[],
  user: { ok: true as const, userId: 'user-a', email: 'a@example.com' } as
    | { ok: true; userId: string; email: string | null }
    | { ok: false; error: string },
  roles: { 'user-a': 'admin' } as Record<string, string>,
  aal: {
    data: {
      currentLevel: 'aal1' as string | null,
      nextLevel: 'aal1' as string | null,
      currentAuthenticationMethods: [] as string[],
    },
    error: null as { message: string } | null,
  },
  resolver: null as null | ((query: Query) => QueryResult),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (href: string) => {
    throw new Error(`REDIRECT:${href}`);
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/auth/require-user', () => ({
  requireUser: vi.fn(async () => harness.user),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: () => Promise.resolve(harness.aal),
      },
    },
  })),
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      let select: string | null = null;
      let eqId: string | null = null;
      const run = () => {
        const query: Query = { table, select, eqId };
        harness.calls.push(query);
        const resolve = harness.resolver ?? defaultResolver;
        return Promise.resolve(resolve(query));
      };
      const api = {
        select(columns?: string) {
          select = columns ?? null;
          return api;
        },
        eq(_column: string, value: string) {
          eqId = String(value);
          return api;
        },
        in() {
          return api;
        },
        gte() {
          return api;
        },
        order() {
          return api;
        },
        limit() {
          return api;
        },
        range: () => run(),
        maybeSingle: () => run(),
        single: () => run(),
        then(onFulfilled: (value: QueryResult) => unknown, onRejected?: (reason: unknown) => unknown) {
          return run().then(onFulfilled, onRejected);
        },
      };
      return api;
    },
  }),
}));

function defaultResolver(query: Query): QueryResult {
  if (query.table === 'user_profiles' && query.select === 'role') {
    const role = harness.roles[query.eqId ?? ''] ?? 'member';
    return { data: { role }, error: null };
  }
  throw new Error(`unexpected admin query ${query.table} ${query.select ?? ''}`);
}

function setAal(currentLevel: string | null, nextLevel: string | null) {
  harness.aal = {
    data: { currentLevel, nextLevel, currentAuthenticationMethods: ['password'] },
    error: null,
  };
}

function drawingTables(): string[] {
  return harness.calls.map((query) => query.table).filter((table) => table.startsWith('drawing_'));
}

type El = { type?: unknown; props?: { children?: El | El[] | string | null; href?: string; mode?: string } };

function walk(node: unknown, visit: (element: El) => void) {
  if (!node || typeof node !== 'object') return;
  const element = node as El;
  visit(element);
  const children = element.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) walk(child, visit);
  } else if (children && typeof children === 'object') {
    walk(children, visit);
  }
}

function hrefsOf(node: unknown): string[] {
  const hrefs: string[] = [];
  walk(node, (element) => {
    if (typeof element.props?.href === 'string') hrefs.push(element.props.href);
  });
  return hrefs;
}

const ROOT = path.resolve(__dirname, '../../../../..');

describe('admin drawings guard', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    harness.calls = [];
    harness.user = { ok: true, userId: 'user-a', email: 'a@example.com' };
    harness.roles = { 'user-a': 'admin' };
    harness.resolver = null;
    setAal('aal2', 'aal2');
    delete process.env.E09_DRAWINGS_ADMIN_ENABLED;
    delete process.env.E09_DRAWINGS_ADMIN_ACTIONS_ENABLED;
  });

  it('404s before any Supabase call unless the flag is exactly true', async () => {
    const page = readFileSync(path.join(ROOT, 'src/app/(site)/admin/drawings/page.tsx'), 'utf8');
    expect(page.indexOf('drawingsAdminEnabled()')).toBeLessThan(page.indexOf('assertAdmin()'));
    for (const value of [undefined, '', 'TRUE', '1', ' true', 'false'] as const) {
      if (value === undefined) delete process.env.E09_DRAWINGS_ADMIN_ENABLED;
      else process.env.E09_DRAWINGS_ADMIN_ENABLED = value;
      harness.calls = [];
      await expect(AdminDrawingsPage()).rejects.toThrow('NOT_FOUND');
      expect(harness.calls).toEqual([]);
    }
  });

  it('gives signed-out and non-admin visitors the existing admin response and does not query drawings', async () => {
    process.env.E09_DRAWINGS_ADMIN_ENABLED = 'true';
    harness.user = { ok: false, error: 'You must be signed in.' };
    await expect(AdminDrawingsPage()).rejects.toThrow('REDIRECT:/signin?redirectTo=/admin');
    expect(harness.calls).toEqual([]);

    harness.calls = [];
    harness.user = { ok: true, userId: 'user-a', email: 'member@example.com' };
    harness.roles = { 'user-a': 'member' };
    await expect(AdminDrawingsPage()).rejects.toThrow('REDIRECT:/challenges');
    expect(drawingTables()).toEqual([]);
    expect(harness.calls.every((query) => query.table === 'user_profiles' && query.select === 'role')).toBe(true);
  });

  it('shows the authenticator gate and does not query a drawing table', async () => {
    process.env.E09_DRAWINGS_ADMIN_ENABLED = 'true';
    setAal('aal1', 'aal1');
    const enroll = (await AdminDrawingsPage()) as El;
    expect(walkHas(enroll, AdminMfaGate, 'enroll')).toBe(true);
    expect(drawingTables()).toEqual([]);

    harness.calls = [];
    setAal('aal1', 'aal2');
    const challenge = (await AdminDrawingsPage()) as El;
    expect(walkHas(challenge, AdminMfaGate, 'challenge')).toBe(true);
    expect(drawingTables()).toEqual([]);
  });

  it('shows the not-set-up message for an MFA-passed admin when the tables are missing', async () => {
    process.env.E09_DRAWINGS_ADMIN_ENABLED = 'true';
    harness.resolver = (query) => {
      if (query.table === 'user_profiles' && query.select === 'role') return defaultResolver(query);
      if (query.table === 'drawing_campaigns') {
        return {
          data: null,
          error: {
            code: 'PGRST205',
            message: "Could not find the table 'public.drawing_campaigns' in the schema cache",
          },
        };
      }
      throw new Error(`unexpected ${query.table} ${query.select ?? ''}`);
    };
    const page = await AdminDrawingsPage();
    let view: DrawingsAdminView | null = null;
    walk(page, (element) => {
      const props = element.props as { view?: DrawingsAdminView } | undefined;
      if (element.type === DrawingsAdmin && props?.view) view = props.view;
    });
    expect(view).toEqual({ ok: false, reason: 'not_set_up' });
    render(page as ReactElement);
    expect(screen.getByText(DRAWINGS_NOT_SET_UP)).toBeTruthy();
    expect(screen.getByText(/This page only reads/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to admin' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(drawingTables()).toEqual(['drawing_campaigns']);
    expect(document.body.textContent ?? '').not.toMatch(/@/);

    cleanup();
    harness.calls = [];
    process.env.E09_DRAWINGS_ADMIN_ACTIONS_ENABLED = 'true';
    const withActions = await AdminDrawingsPage();
    render(withActions as ReactElement);
    expect(screen.getByText(DRAWINGS_NOT_SET_UP)).toBeTruthy();
    expect(screen.queryByText(/This page only reads/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Run simulated selection' })).toBeNull();
    expect(document.body.textContent ?? '').not.toMatch(/@/);
  });

  it('links Drawings from the admin page only when the flag is on, and does not query drawings there', async () => {
    setAal('aal2', 'aal2');
    harness.resolver = (query) => {
      if (query.table === 'user_profiles' && query.select === 'role') return defaultResolver(query);
      if (query.table === 'user_profiles') return { data: [], error: null };
      if (query.table === 'restaurants') return { data: [], error: null };
      if (query.table === 'admin_audit_log') return { data: [], error: null };
      throw new Error(`unexpected ${query.table}`);
    };
    const hidden = await AdminPage();
    expect(hrefsOf(hidden)).not.toContain('/admin/drawings');
    expect(drawingTables()).toEqual([]);

    harness.calls = [];
    process.env.E09_DRAWINGS_ADMIN_ENABLED = 'true';
    const shown = await AdminPage();
    expect(hrefsOf(shown)).toContain('/admin/drawings');
    expect(drawingTables()).toEqual([]);
  });
});

function walkHas(node: unknown, type: unknown, mode: string): boolean {
  let found = false;
  walk(node, (element) => {
    if (element.type === type && element.props?.mode === mode) found = true;
  });
  return found;
}
