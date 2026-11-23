import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  enabled: false,
  user: null as { id: string } | null,
  getUserCalls: 0,
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/lib/site-problems/flag', () => ({
  siteProblemReportsEnabled: () => harness.enabled,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    harness.getUserCalls += 1;
    return {
      auth: {
        getUser: async () => ({ data: { user: harness.user } }),
      },
    };
  },
}));

import ReportProblemPage from './page';

describe('/report-a-problem', () => {
  beforeEach(() => {
    harness.enabled = false;
    harness.user = null;
    harness.getUserCalls = 0;
  });

  afterEach(() => {
    cleanup();
  });

  it('is not found when the flag is off', async () => {
    await expect(ReportProblemPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NOT_FOUND');
    expect(harness.getUserCalls).toBe(0);
  });

  it('shows an optional email when signed out and drops a bad from path', async () => {
    harness.enabled = true;
    render(await ReportProblemPage({
      searchParams: Promise.resolve({ from: 'https://evil.example' }),
    }));
    expect(screen.getByRole('heading', { name: 'Report a problem' })).toBeTruthy();
    const main = document.querySelector('main');
    expect(main?.className).toContain('report-problem-page');
    expect(main?.className).toContain('px-4');
    const css = readFileSync(
      path.join(process.cwd(), 'src/app/styles/wanderbite-theme.css'),
      'utf8',
    );
    expect(css).toContain('body:has(.report-problem-page) nextjs-portal');
    expect(css).not.toContain('padding-inline: 5rem');
    expect(css).not.toContain('.report-problem-page {');
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect((screen.getByLabelText('Which page?') as HTMLInputElement).value).toBe('');
  });

  it('hides the email and prefills a safe from path for a signed-in member', async () => {
    harness.enabled = true;
    harness.user = { id: 'user-1' };
    render(await ReportProblemPage({
      searchParams: Promise.resolve({ from: '/challenges' }),
    }));
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect((screen.getByLabelText('Which page?') as HTMLInputElement).value).toBe('/challenges');
  });
});
