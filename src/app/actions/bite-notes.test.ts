import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_REVIEW_REQUIRES_VERIFIED } from '@/lib/notes/note-rules';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const RESTAURANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VERIFIED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ISSUED = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const EXPIRED = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const UNSTAMPED = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const NOTE = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const SECRET = 'SECRET_NOTE_TEXT';

type Row = Record<string, unknown>;

const db: Record<string, Row[]> = { bite_notes: [], redemptions: [] };
const writes: { op: string; table: string; payload: Row }[] = [];

const requireUser = vi.fn();

function matches(row: Row, filters: { op: 'eq' | 'in'; column: string; value: unknown }[]) {
  return filters.every((filter) => {
    if (filter.op === 'eq') return row[filter.column] === filter.value;
    return (filter.value as unknown[]).includes(row[filter.column]);
  });
}

function from(table: string) {
  const filters: { op: 'eq' | 'in'; column: string; value: unknown }[] = [];
  let limited: number | null = null;
  const rows = () => {
    const found = (db[table] ?? []).filter((row) => matches(row, filters));
    return limited == null ? found : found.slice(0, limited);
  };
  const builder = {
    select() {
      return builder;
    },
    eq(column: string, value: unknown) {
      filters.push({ op: 'eq', column, value });
      return builder;
    },
    in(column: string, value: unknown[]) {
      filters.push({ op: 'in', column, value });
      return builder;
    },
    order() {
      return builder;
    },
    limit(count: number) {
      limited = count;
      return builder;
    },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    upsert: async (payload: Row) => {
      writes.push({ op: 'upsert', table, payload });
      return { error: null };
    },
    update(payload: Row) {
      return {
        eq(column: string, value: unknown) {
          filters.push({ op: 'eq', column, value });
          return {
            eq: async (column2: string, value2: unknown) => {
              filters.push({ op: 'eq', column: column2, value: value2 });
              writes.push({ op: 'update', table, payload });
              return { error: null };
            },
          };
        },
      };
    },
    then(
      onFulfilled?: (value: { data: Row[]; error: null }) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) {
      return Promise.resolve({ data: rows(), error: null }).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

vi.mock('@/lib/auth/require-user', () => ({
  requireUser: () => requireUser(),
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ from }),
}));

import { getPublicReviews, saveBiteNote, toggleNoteVisibility } from '@/app/actions/bite-notes';

function redemption(id: string, status: string, verifiedAt: string | null, userId = USER): Row {
  return {
    id,
    user_id: userId,
    restaurant_id: RESTAURANT,
    status,
    verified_at: verifiedAt,
  };
}

function note(overrides: Row = {}): Row {
  return {
    id: NOTE,
    user_id: USER,
    redemption_id: VERIFIED,
    restaurant_id: RESTAURANT,
    note: SECRET,
    rating: 5,
    is_public: false,
    created_at: '2026-07-15T18:00:00.000Z',
    user_profiles: { username: 'Noah', email: 'noah@example.com' },
    ...overrides,
  };
}

describe('bite note actions', () => {
  const consoleSpies = [
    vi.spyOn(console, 'log').mockImplementation(() => undefined),
    vi.spyOn(console, 'info').mockImplementation(() => undefined),
    vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    vi.spyOn(console, 'error').mockImplementation(() => undefined),
    vi.spyOn(console, 'debug').mockImplementation(() => undefined),
  ];

  beforeEach(() => {
    db.bite_notes = [];
    db.redemptions = [
      redemption(VERIFIED, 'verified', '2026-07-15T18:00:00.000Z'),
      redemption(ISSUED, 'issued', null),
      redemption(EXPIRED, 'expired', null),
      redemption(UNSTAMPED, 'verified', null),
    ];
    writes.length = 0;
    requireUser.mockReset();
    requireUser.mockResolvedValue({ ok: true, userId: USER, email: 'noah@example.com' });
    for (const spy of consoleSpies) spy.mockClear();
  });

  it('keeps a private save on an issued redemption and refuses a public one', async () => {
    await expect(saveBiteNote(ISSUED, SECRET, 4, false)).resolves.toEqual({ ok: true });
    expect(writes).toEqual([
      expect.objectContaining({
        op: 'upsert',
        table: 'bite_notes',
        payload: expect.objectContaining({
          redemption_id: ISSUED,
          note: SECRET,
          rating: 4,
          is_public: false,
          user_id: USER,
        }),
      }),
    ]);

    writes.length = 0;
    await expect(saveBiteNote(ISSUED, SECRET, 4, true)).resolves.toEqual({
      ok: false,
      error: PUBLIC_REVIEW_REQUIRES_VERIFIED,
    });
    expect(writes).toEqual([]);
  });

  it('refuses a public save when the redemption is expired or verified_at is missing', async () => {
    await expect(saveBiteNote(EXPIRED, SECRET, 3, true)).resolves.toEqual({
      ok: false,
      error: PUBLIC_REVIEW_REQUIRES_VERIFIED,
    });
    await expect(saveBiteNote(UNSTAMPED, SECRET, 3, true)).resolves.toEqual({
      ok: false,
      error: PUBLIC_REVIEW_REQUIRES_VERIFIED,
    });
    expect(writes).toEqual([]);
  });

  it('writes a public note only for a verified redemption', async () => {
    await expect(saveBiteNote(VERIFIED, `  ${SECRET}  `, 5, true)).resolves.toEqual({ ok: true });
    expect(writes[0]?.payload).toMatchObject({
      redemption_id: VERIFIED,
      note: SECRET,
      rating: 5,
      is_public: true,
    });
  });

  it('refuses another member and enforces rating and length before any write', async () => {
    db.redemptions = [redemption(VERIFIED, 'verified', '2026-07-15T18:00:00.000Z', OTHER)];
    await expect(saveBiteNote(VERIFIED, SECRET, 5, false)).resolves.toEqual({
      ok: false,
      error: 'You can only add notes to your own visits.',
    });

    db.redemptions = [redemption(VERIFIED, 'verified', '2026-07-15T18:00:00.000Z')];
    await expect(saveBiteNote(VERIFIED, 'x'.repeat(280), 1, false)).resolves.toEqual({ ok: true });
    await expect(saveBiteNote(VERIFIED, 'x'.repeat(281), 1, false)).resolves.toEqual({
      ok: false,
      error: 'Note must be 280 characters or less.',
    });
    await expect(saveBiteNote(VERIFIED, SECRET, 0, false)).resolves.toEqual({
      ok: false,
      error: 'Pick a rating from 1 to 5 stars.',
    });
    await expect(saveBiteNote(VERIFIED, SECRET, 6, true)).resolves.toEqual({
      ok: false,
      error: 'Pick a rating from 1 to 5 stars.',
    });
    await expect(saveBiteNote(VERIFIED, SECRET, 1.5, false)).resolves.toEqual({
      ok: false,
      error: 'Pick a rating from 1 to 5 stars.',
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.payload).toMatchObject({ note: 'x'.repeat(280), rating: 1, is_public: false });
  });

  it('stores an empty private note as null', async () => {
    await expect(saveBiteNote(ISSUED, '   ', 2)).resolves.toEqual({ ok: true });
    expect(writes[0]?.payload).toMatchObject({ note: null, is_public: false, rating: 2 });
  });

  it('lets the owner make a note private and refuses a public toggle until verified', async () => {
    db.bite_notes = [note({ redemption_id: ISSUED, is_public: true })];
    await expect(toggleNoteVisibility(NOTE, false)).resolves.toEqual({ ok: true });
    expect(writes).toEqual([
      expect.objectContaining({
        op: 'update',
        payload: expect.objectContaining({ is_public: false }),
      }),
    ]);
    expect(db.bite_notes[0]?.note).toBe(SECRET);

    writes.length = 0;
    await expect(toggleNoteVisibility(NOTE, true)).resolves.toEqual({
      ok: false,
      error: PUBLIC_REVIEW_REQUIRES_VERIFIED,
    });
    expect(writes).toEqual([]);
    expect(db.bite_notes[0]).toMatchObject({ note: SECRET, is_public: true });

    db.bite_notes = [note({ redemption_id: EXPIRED })];
    await expect(toggleNoteVisibility(NOTE, true)).resolves.toEqual({
      ok: false,
      error: PUBLIC_REVIEW_REQUIRES_VERIFIED,
    });
    expect(writes).toEqual([]);
  });

  it('allows a public toggle for the owner of a verified visit and refuses other people', async () => {
    db.bite_notes = [note()];
    await expect(toggleNoteVisibility(NOTE, true)).resolves.toEqual({ ok: true });
    expect(writes[0]?.payload).toMatchObject({ is_public: true });

    writes.length = 0;
    db.bite_notes = [note({ user_id: OTHER })];
    await expect(toggleNoteVisibility(NOTE, false)).resolves.toEqual({
      ok: false,
      error: 'You can only change visibility on your own notes.',
    });
    expect(writes).toEqual([]);
  });

  it('hides a public note whose redemption is not verified and still returns a verified one', async () => {
    const issuedNote = note({
      id: '12121212-1212-4212-8212-121212121212',
      redemption_id: ISSUED,
      note: 'issued secret',
      is_public: true,
      created_at: '2026-07-16T18:00:00.000Z',
    });
    const verifiedNote = note({
      id: NOTE,
      redemption_id: VERIFIED,
      note: SECRET,
      is_public: true,
      created_at: '2026-07-15T18:00:00.000Z',
      user_profiles: { username: 'Noah', email: null },
    });
    db.bite_notes = [issuedNote, verifiedNote];

    await expect(getPublicReviews(RESTAURANT)).resolves.toEqual({
      ok: true,
      data: [
        {
          id: NOTE,
          rating: 5,
          note: SECRET,
          created_at: '2026-07-15T18:00:00.000Z',
          maskedAuthor: 'No***',
        },
      ],
    });
    expect(writes).toEqual([]);
    expect(db.bite_notes[0]).toMatchObject({ note: 'issued secret', is_public: true });
  });

  it('does not log note text', async () => {
    db.bite_notes = [note({ is_public: true })];
    await saveBiteNote(VERIFIED, SECRET, 5, true);
    await toggleNoteVisibility(NOTE, true);
    await getPublicReviews(RESTAURANT);
    const logged = consoleSpies.flatMap((spy) => spy.mock.calls.flat().map((value) => String(value)));
    expect(logged.join('\n')).not.toContain(SECRET);
  });
});
