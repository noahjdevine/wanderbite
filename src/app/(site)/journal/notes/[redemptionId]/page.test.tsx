import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JournalReflection } from '@/app/actions/journal-reflections';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const REDEMPTION = '22222222-2222-4222-8222-222222222222';

const { requireUser, getJournalReflection, tables } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getJournalReflection: vi.fn(),
  tables: [] as string[],
}));

const db = vi.hoisted(() => ({
  redemption: null as null | {
    id: string;
    user_id: string;
    status?: string | null;
    verified_at?: string | null;
    restaurants: { name: string } | null;
  },
  note: null as null | {
    id: string;
    note: string | null;
    rating: number | null;
    is_public: boolean | null;
  },
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/auth/require-user', () => ({
  requireUser: () => requireUser(),
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      tables.push(table);
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        maybeSingle: async () => {
          if (table === 'redemptions') return { data: db.redemption, error: null };
          if (table === 'bite_notes') return { data: db.note, error: null };
          return { data: null, error: { message: `unexpected ${table}` } };
        },
      };
      return builder;
    },
  }),
}));

vi.mock('@/app/actions/bite-notes', () => ({
  saveBiteNote: vi.fn(),
  toggleNoteVisibility: vi.fn(),
}));

vi.mock('@/app/actions/journal-reflections', () => ({
  getJournalReflection: (...args: unknown[]) => getJournalReflection(...args),
  saveJournalReflection: vi.fn(),
  getGoogleReviewHandoffForRedemption: vi.fn(),
  publishJournalReflection: vi.fn(),
}));

import NoteEditorPage from './page';

const saved: JournalReflection = {
  id: '77777777-7777-4777-8777-777777777777',
  redemption_id: REDEMPTION,
  bite_note_id: null,
  favorite_bite: 'Tacos',
  atmosphere: 'Quiet patio',
  return_interest: 'yes',
  companion_label: 'Alex',
  unpublished_review_draft: 'Draft stays here',
  created_at: '2026-11-06T00:00:00.000Z',
  updated_at: '2026-11-06T00:00:00.000Z',
};

function page() {
  return NoteEditorPage({
    params: Promise.resolve({ redemptionId: REDEMPTION }),
    searchParams: Promise.resolve({}),
  });
}

describe('note editor page reflection gate', () => {
  beforeEach(() => {
    tables.length = 0;
    requireUser.mockReset();
    getJournalReflection.mockReset();
    requireUser.mockResolvedValue({ ok: true, userId: USER, email: null });
    getJournalReflection.mockResolvedValue({ ok: true, reflection: null });
    db.redemption = {
      id: REDEMPTION,
      user_id: USER,
      restaurants: { name: 'North Grill' },
    };
    db.note = { id: '55555555-5555-4555-8555-555555555555', note: 'Tacos', rating: 4, is_public: false };
    delete process.env.E08_JOURNAL_REFLECTIONS_ENABLED;
  });

  afterEach(() => {
    cleanup();
    delete process.env.E08_JOURNAL_REFLECTIONS_ENABLED;
  });

  it('keeps the bite-note editor and skips journal reflections when the flag is not true', async () => {
    for (const value of [undefined, '', 'True', '1'] as const) {
      tables.length = 0;
      getJournalReflection.mockClear();
      if (value === undefined) delete process.env.E08_JOURNAL_REFLECTIONS_ENABLED;
      else process.env.E08_JOURNAL_REFLECTIONS_ENABLED = value;

      const view = render(await page());
      expect(screen.getByRole('heading', { name: 'Edit memory' })).toBeTruthy();
      expect(screen.getByDisplayValue('Tacos')).toBeTruthy();
      expect(screen.queryByRole('heading', { name: 'Private reflection' })).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Publish on WanderBite' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Get Google review link' })).toBeNull();
      expect(getJournalReflection).not.toHaveBeenCalled();
      expect(tables).toEqual(['redemptions', 'bite_notes']);
      expect(tables).not.toContain('journal_reflections');
      view.unmount();
    }
  });

  it('loads the owned reflection when the flag is true', async () => {
    process.env.E08_JOURNAL_REFLECTIONS_ENABLED = 'true';
    getJournalReflection.mockResolvedValue({ ok: true, reflection: saved });
    render(await page());
    expect(getJournalReflection).toHaveBeenCalledTimes(1);
    expect(getJournalReflection).toHaveBeenCalledWith(REDEMPTION);
    expect(screen.getByRole('heading', { name: 'Private reflection' })).toBeTruthy();
    expect((screen.getByLabelText('Favorite bite') as HTMLTextAreaElement).value).toBe('Tacos');
    expect((screen.getByLabelText('Review draft') as HTMLTextAreaElement).value).toBe('Draft stays here');
    expect((screen.getByLabelText('Would you go back?') as HTMLSelectElement).value).toBe('yes');
    expect(tables).not.toContain('journal_reflections');
    expect(screen.getByRole('heading', { name: 'Edit memory' })).toBeTruthy();
    expect(screen.getByText('Only a verified visit can be shared publicly.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publish' })).toHaveProperty('disabled', true);
  });

  it('shows Publish for a verified visit when the flag is true', async () => {
    process.env.E08_JOURNAL_REFLECTIONS_ENABLED = 'true';
    db.redemption = {
      id: REDEMPTION,
      user_id: USER,
      status: 'verified',
      verified_at: '2026-11-06T18:00:00.000Z',
      restaurants: { name: 'North Grill' },
    };
    getJournalReflection.mockResolvedValue({ ok: true, reflection: saved });
    render(await page());
    expect(screen.getByRole('heading', { name: 'Publish on WanderBite' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publish' })).toHaveProperty('disabled', false);
    expect(screen.queryByText('Only a verified visit can be shared publicly.')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Edit memory' })).toBeTruthy();
    expect(tables).toEqual(['redemptions', 'bite_notes']);
  });

  it('does not load a reflection for someone else even when the flag is true', async () => {
    process.env.E08_JOURNAL_REFLECTIONS_ENABLED = 'true';
    db.redemption = {
      id: REDEMPTION,
      user_id: OTHER,
      restaurants: { name: 'North Grill' },
    };
    render(await page());
    expect(screen.getByText('You can only add notes to your own visits.')).toBeTruthy();
    expect(getJournalReflection).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Favorite bite')).toBeNull();
    expect(screen.queryByText('Draft stays here')).toBeNull();
    expect(tables).toEqual(['redemptions']);
  });

  it('leaves the note editor in place when the reflection read fails', async () => {
    process.env.E08_JOURNAL_REFLECTIONS_ENABLED = 'true';
    getJournalReflection.mockResolvedValue({ ok: false, code: 'read_failed' });
    render(await page());
    expect(screen.getByRole('heading', { name: 'Edit memory' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Your private reflection could not be loaded.');
    expect(screen.queryByLabelText('Favorite bite')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Get Google review link' })).toBeNull();
  });
});
