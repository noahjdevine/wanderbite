import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const REDEMPTION = '22222222-2222-4222-8222-222222222222';
const OTHER_REDEMPTION = '33333333-3333-4333-8333-333333333333';
const RESTAURANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOTE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MISSING = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PLACE_ID = 'ChIJN1t_tDeuEmsRUsoyG83frY4';
const WRITEREVIEW = `https://search.google.com/local/writereview?placeid=${PLACE_ID}`;
const DRAFT = 'SECRET_DRAFT_TEXT_e08';
const OTHER_DRAFT = 'OTHER_MEMBER_DRAFT_e08';
const PUBLIC_NOTE = 'PUBLIC_SENTENCE_e08c';
const VERIFIED_AT = '2026-11-06T18:00:00.000Z';

type Row = Record<string, unknown>;
type Query = {
  table: string;
  op: 'select' | 'upsert';
  filters: { column: string; value: unknown }[];
  payload?: Row;
  options?: { onConflict?: string };
};

const db: Record<string, Row[]> = {
  redemptions: [],
  restaurants: [],
  journal_reflections: [],
  bite_notes: [],
};
const queries: Query[] = [];
const errors: Record<string, { message: string } | null> = {};
let ignoreUserEq = false;

const requireUser = vi.fn();

function matches(row: Row, filters: Query['filters']) {
  return filters.every((filter) => {
    if (ignoreUserEq && filter.column === 'user_id') return true;
    return row[filter.column] === filter.value;
  });
}

function from(table: string) {
  const filters: Query['filters'] = [];
  const builder = {
    select() {
      return builder;
    },
    eq(column: string, value: unknown) {
      filters.push({ column, value });
      return builder;
    },
    maybeSingle: async () => {
      queries.push({ table, op: 'select', filters: [...filters] });
      if (errors[table]) return { data: null, error: errors[table] };
      const found = (db[table] ?? []).filter((row) => matches(row, filters));
      return { data: found[0] ?? null, error: null };
    },
    upsert: async (payload: Row, options?: { onConflict?: string }) => {
      queries.push({ table, op: 'upsert', filters: [...filters], payload, options });
      if (errors[table]) return { error: errors[table] };
      const existing = (db[table] ?? []).find((row) => row.redemption_id === payload.redemption_id);
      if (existing) {
        Object.assign(existing, payload);
      } else {
        (db[table] ?? []).push({
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          bite_note_id: null,
          created_at: '2026-11-06T00:00:00.000Z',
          ...payload,
        });
      }
      return { error: null };
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

import { saveBiteNote } from '@/app/actions/bite-notes';
import {
  getGoogleReviewHandoffForRedemption,
  getJournalReflection,
  publishJournalReflection,
  saveJournalReflection,
} from '@/app/actions/journal-reflections';
import { NOTE_MAX } from '@/lib/notes/note-rules';

const consoleSpies = [
  vi.spyOn(console, 'log').mockImplementation(() => undefined),
  vi.spyOn(console, 'info').mockImplementation(() => undefined),
  vi.spyOn(console, 'warn').mockImplementation(() => undefined),
  vi.spyOn(console, 'error').mockImplementation(() => undefined),
  vi.spyOn(console, 'debug').mockImplementation(() => undefined),
];

function reflection(overrides: Row = {}): Row {
  return {
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    user_id: USER,
    redemption_id: REDEMPTION,
    bite_note_id: null,
    favorite_bite: 'brisket',
    atmosphere: 'warm room',
    return_interest: 'yes',
    companion_label: 'Ada',
    unpublished_review_draft: DRAFT,
    created_at: '2026-11-06T12:00:00.000Z',
    updated_at: '2026-11-06T12:00:00.000Z',
    ...overrides,
  };
}

function validFields(overrides: Row = {}) {
  return {
    favorite_bite: 'brisket',
    atmosphere: 'warm room',
    return_interest: 'yes',
    companion_label: 'Ada',
    unpublished_review_draft: DRAFT,
    ...overrides,
  };
}

function tablesTouched() {
  return queries.map((query) => query.table);
}

function consoleText() {
  return consoleSpies.flatMap((spy) => spy.mock.calls.map((call) => JSON.stringify(call))).join('\n');
}

describe('journal reflection actions', () => {
  beforeEach(() => {
    db.redemptions = [
      {
        id: REDEMPTION,
        user_id: USER,
        restaurant_id: RESTAURANT,
        status: 'verified',
        verified_at: VERIFIED_AT,
      },
      {
        id: OTHER_REDEMPTION,
        user_id: OTHER,
        restaurant_id: RESTAURANT,
        status: 'verified',
        verified_at: VERIFIED_AT,
      },
    ];
    db.restaurants = [{ id: RESTAURANT, google_place_id: PLACE_ID }];
    db.bite_notes = [];
    db.journal_reflections = [
      reflection(),
      reflection({
        id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        user_id: OTHER,
        redemption_id: OTHER_REDEMPTION,
        unpublished_review_draft: OTHER_DRAFT,
        favorite_bite: 'their taco',
      }),
    ];
    queries.length = 0;
    ignoreUserEq = false;
    errors.redemptions = null;
    errors.restaurants = null;
    errors.journal_reflections = null;
    errors.bite_notes = null;
    delete process.env.E08_JOURNAL_REFLECTIONS_ENABLED;
    requireUser.mockReset();
    requireUser.mockResolvedValue({ ok: true, userId: USER, email: 'member@example.com' });
    for (const spy of consoleSpies) spy.mockClear();
  });

  afterEach(() => {
    delete process.env.E08_JOURNAL_REFLECTIONS_ENABLED;
  });

  it('returns disabled and does not query when the flag is off', async () => {
    const off = [undefined, '', 'True', '1'] as const;
    for (const value of off) {
      queries.length = 0;
      requireUser.mockClear();
      if (value === undefined) delete process.env.E08_JOURNAL_REFLECTIONS_ENABLED;
      else process.env.E08_JOURNAL_REFLECTIONS_ENABLED = value;

      await expect(getJournalReflection(REDEMPTION)).resolves.toEqual({
        ok: false,
        code: 'disabled',
      });
      await expect(saveJournalReflection(REDEMPTION, validFields())).resolves.toEqual({
        ok: false,
        code: 'disabled',
      });
      await expect(getGoogleReviewHandoffForRedemption(REDEMPTION)).resolves.toEqual({
        ok: false,
        code: 'disabled',
      });
      await expect(
        publishJournalReflection(REDEMPTION, { publicNote: PUBLIC_NOTE, rating: 5 }),
      ).resolves.toEqual({ ok: false, code: 'disabled' });
      expect(queries).toEqual([]);
      expect(requireUser).not.toHaveBeenCalled();
      expect(tablesTouched()).not.toContain('journal_reflections');
    }
  });

  it('refuses a signed-out caller before reading a redemption', async () => {
    process.env.E08_JOURNAL_REFLECTIONS_ENABLED = 'true';
    requireUser.mockResolvedValue({ ok: false, error: 'You must be signed in.' });

    await expect(getJournalReflection(REDEMPTION)).resolves.toEqual({
      ok: false,
      code: 'unauthorized',
    });
    await expect(saveJournalReflection(REDEMPTION, validFields())).resolves.toEqual({
      ok: false,
      code: 'unauthorized',
    });
    await expect(getGoogleReviewHandoffForRedemption(REDEMPTION)).resolves.toEqual({
      ok: false,
      code: 'unauthorized',
    });
    await expect(
      publishJournalReflection(REDEMPTION, { publicNote: PUBLIC_NOTE, rating: 5 }),
    ).resolves.toEqual({ ok: false, code: 'unauthorized' });
    expect(queries).toEqual([]);
  });

  it('does not read a reflection for a missing or foreign redemption', async () => {
    process.env.E08_JOURNAL_REFLECTIONS_ENABLED = 'true';

    await expect(getJournalReflection('not-a-uuid')).resolves.toEqual({
      ok: false,
      code: 'not_found',
    });
    await expect(saveJournalReflection(MISSING, validFields())).resolves.toEqual({
      ok: false,
      code: 'not_found',
    });
    await expect(getGoogleReviewHandoffForRedemption(OTHER_REDEMPTION)).resolves.toEqual({
      ok: false,
      code: 'forbidden',
    });
    await expect(
      saveJournalReflection(OTHER_REDEMPTION, { atmosphere: `nope\n${OTHER_DRAFT}` }),
    ).resolves.toEqual({ ok: false, code: 'forbidden' });
    await expect(publishJournalReflection('not-a-uuid', { publicNote: PUBLIC_NOTE, rating: 5 })).resolves.toEqual({
      ok: false,
      code: 'not_found',
    });
    const foreign = await publishJournalReflection(OTHER_REDEMPTION, {
      publicNote: PUBLIC_NOTE,
      rating: 5,
      bite_note_id: NOTE,
    });
    expect(foreign).toEqual({ ok: false, code: 'forbidden' });
    expect(JSON.stringify(foreign)).not.toContain(OTHER_DRAFT);
    expect(JSON.stringify(foreign)).not.toContain(PUBLIC_NOTE);

    expect(tablesTouched()).not.toContain('journal_reflections');
    expect(tablesTouched()).not.toContain('bite_notes');
    expect(JSON.stringify(queries)).not.toContain(OTHER_DRAFT);
    expect(JSON.stringify(queries)).not.toContain(DRAFT);
  });

  it('returns only the signed-in member reflection', async () => {
    process.env.E08_JOURNAL_REFLECTIONS_ENABLED = 'true';

    await expect(getJournalReflection(REDEMPTION.toUpperCase())).resolves.toEqual({
      ok: true,
      reflection: {
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        redemption_id: REDEMPTION,
        bite_note_id: null,
        favorite_bite: 'brisket',
        atmosphere: 'warm room',
        return_interest: 'yes',
        companion_label: 'Ada',
        unpublished_review_draft: DRAFT,
        created_at: '2026-11-06T12:00:00.000Z',
        updated_at: '2026-11-06T12:00:00.000Z',
      },
    });

    const reflectionQuery = queries.find(
      (query) => query.table === 'journal_reflections' && query.op === 'select',
    );
    expect(reflectionQuery?.filters).toEqual([
      { column: 'redemption_id', value: REDEMPTION },
      { column: 'user_id', value: USER },
    ]);

    db.journal_reflections = db.journal_reflections.filter((row) => row.user_id !== USER);
    await expect(getJournalReflection(REDEMPTION)).resolves.toEqual({
      ok: true,
      reflection: null,
    });
  });

  it('refuses another member row even when the query filter is ignored', async () => {
    process.env.E08_JOURNAL_REFLECTIONS_ENABLED = 'true';
    ignoreUserEq = true;
    db.journal_reflections = [
      reflection({
        user_id: OTHER,
        unpublished_review_draft: OTHER_DRAFT,
        favorite_bite: 'their taco',
      }),
    ];

    const result = await getJournalReflection(REDEMPTION);
    expect(result).toEqual({ ok: false, code: 'forbidden' });
    expect(JSON.stringify(result)).not.toContain(OTHER_DRAFT);
    expect(JSON.stringify(result)).not.toContain('their taco');
  });

  it('upserts one owner row and leaves bite_note_id unchanged', async () => {
    process.env.E08_JOURNAL_REFLECTIONS_ENABLED = 'true';
    db.journal_reflections = [
      reflection({ bite_note_id: NOTE, unpublished_review_draft: 'old draft' }),
    ];

    await expect(
      saveJournalReflection(REDEMPTION, {
        ...validFields({ favorite_bite: '  brisket  ' }),
        user_id: OTHER,
        bite_note_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      }),
    ).resolves.toEqual({ ok: true });

    const write = queries.find((query) => query.op === 'upsert');
    expect(write).toEqual(
      expect.objectContaining({
        table: 'journal_reflections',
        options: { onConflict: 'redemption_id' },
      }),
    );
    expect(write?.payload).toEqual(
      expect.objectContaining({
        user_id: USER,
        redemption_id: REDEMPTION,
        favorite_bite: 'brisket',
        atmosphere: 'warm room',
        return_interest: 'yes',
        companion_label: 'Ada',
        unpublished_review_draft: DRAFT,
      }),
    );
    expect(write?.payload).not.toHaveProperty('bite_note_id');
    expect(typeof write?.payload?.updated_at).toBe('string');
    expect(queries.filter((query) => query.table === 'journal_reflections').map((query) => query.op)).toEqual([
      'upsert',
    ]);
    expect(db.journal_reflections).toHaveLength(1);
    expect(db.journal_reflections[0]).toEqual(
      expect.objectContaining({
        user_id: USER,
        redemption_id: REDEMPTION,
        bite_note_id: NOTE,
        favorite_bite: 'brisket',
        unpublished_review_draft: DRAFT,
      }),
    );
  });

  it('inserts a new row with bite_note_id null', async () => {
    process.env.E08_JOURNAL_REFLECTIONS_ENABLED = 'true';
    db.journal_reflections = [];

    await expect(saveJournalReflection(REDEMPTION, validFields())).resolves.toEqual({ ok: true });

    expect(db.journal_reflections).toHaveLength(1);
    expect(db.journal_reflections[0]?.bite_note_id).toBeNull();
    expect(db.journal_reflections[0]?.user_id).toBe(USER);
  });

  it('refuses invalid fields and does not write', async () => {
    process.env.E08_JOURNAL_REFLECTIONS_ENABLED = 'true';

    await expect(
      saveJournalReflection(REDEMPTION, validFields({ atmosphere: 'line\ntwo' })),
    ).resolves.toEqual({ ok: false, code: 'invalid_text', field: 'atmosphere' });
    await expect(
      saveJournalReflection(REDEMPTION, validFields({ favorite_bite: 'x'.repeat(121) })),
    ).resolves.toEqual({ ok: false, code: 'too_long', field: 'favorite_bite' });
    await expect(
      saveJournalReflection(REDEMPTION, validFields({ return_interest: 'Yes' })),
    ).resolves.toEqual({ ok: false, code: 'invalid_return_interest', field: 'return_interest' });
    await expect(saveJournalReflection(REDEMPTION, null)).resolves.toEqual({
      ok: false,
      code: 'invalid_input',
    });

    expect(queries.filter((query) => query.op === 'upsert')).toEqual([]);
    expect(db.journal_reflections[0]?.favorite_bite).toBe('brisket');
    expect(db.journal_reflections[0]?.atmosphere).toBe('warm room');
  });

  it('hides database messages that might contain reflection text', async () => {
    process.env.E08_JOURNAL_REFLECTIONS_ENABLED = 'true';
    errors.redemptions = { message: `read ${DRAFT}` };
    await expect(getJournalReflection(REDEMPTION)).resolves.toEqual({
      ok: false,
      code: 'read_failed',
    });
    expect(tablesTouched()).not.toContain('journal_reflections');

    errors.redemptions = null;
    errors.journal_reflections = { message: `write ${DRAFT} ${PLACE_ID}` };
    const saved = await saveJournalReflection(REDEMPTION, validFields());
    expect(saved).toEqual({ ok: false, code: 'save_failed' });
    expect(JSON.stringify(saved)).not.toContain(DRAFT);
    expect(JSON.stringify(saved)).not.toContain(PLACE_ID);
  });

  it('builds a writereview URL and does not append the draft', async () => {
    process.env.E08_JOURNAL_REFLECTIONS_ENABLED = 'true';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await getGoogleReviewHandoffForRedemption(REDEMPTION);
    expect(result).toEqual({ ok: true, url: WRITEREVIEW, source: 'place_id' });
    if (result.ok) {
      const url = new URL(result.url);
      expect(url.origin + url.pathname).toBe('https://search.google.com/local/writereview');
      expect([...url.searchParams.keys()]).toEqual(['placeid']);
      expect(url.searchParams.get('placeid')).toBe(PLACE_ID);
      expect(result.url).not.toContain(DRAFT);
    }
    expect(tablesTouched()).toEqual(['redemptions', 'restaurants']);
    expect(tablesTouched()).not.toContain('bite_notes');
    expect(tablesTouched()).not.toContain('journal_reflections');
    expect(db.journal_reflections.find((row) => row.user_id === USER)?.bite_note_id).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('refuses a handoff when the place id is missing or invalid', async () => {
    process.env.E08_JOURNAL_REFLECTIONS_ENABLED = 'true';

    db.restaurants = [{ id: RESTAURANT, google_place_id: null }];
    await expect(getGoogleReviewHandoffForRedemption(REDEMPTION)).resolves.toEqual({
      ok: false,
      code: 'missing_destination',
    });

    db.restaurants = [{ id: RESTAURANT, google_place_id: 'short' }];
    await expect(getGoogleReviewHandoffForRedemption(REDEMPTION)).resolves.toEqual({
      ok: false,
      code: 'invalid_place_id',
    });

    db.redemptions = [{ id: REDEMPTION, user_id: USER, restaurant_id: null }];
    queries.length = 0;
    await expect(getGoogleReviewHandoffForRedemption(REDEMPTION)).resolves.toEqual({
      ok: false,
      code: 'missing_destination',
    });
    expect(tablesTouched()).toEqual(['redemptions']);
    expect(tablesTouched()).not.toContain('journal_reflections');
  });

  it('does not log reflection text, place ids, or handoff URLs', async () => {
    process.env.E08_JOURNAL_REFLECTIONS_ENABLED = 'true';
    await getJournalReflection(REDEMPTION);
    await saveJournalReflection(REDEMPTION, validFields());
    await getGoogleReviewHandoffForRedemption(REDEMPTION);
    await getJournalReflection(OTHER_REDEMPTION);
    await publishJournalReflection(REDEMPTION, {
      publicNote: PUBLIC_NOTE,
      rating: 4,
      unpublished_review_draft: DRAFT,
    });

    const logged = consoleText();
    expect(logged).not.toContain(DRAFT);
    expect(logged).not.toContain(OTHER_DRAFT);
    expect(logged).not.toContain(PUBLIC_NOTE);
    expect(logged).not.toContain(PLACE_ID);
    expect(logged).not.toContain('writereview');
    expect(logged).not.toContain('search.google.com');
  });

  it('refuses an unverified redemption before any public write', async () => {
    process.env.E08_JOURNAL_REFLECTIONS_ENABLED = 'true';
    db.bite_notes = [
      {
        id: NOTE,
        user_id: USER,
        redemption_id: REDEMPTION,
        restaurant_id: RESTAURANT,
        note: 'private memory',
        rating: 2,
        is_public: false,
      },
    ];
    db.journal_reflections = [reflection({ bite_note_id: null })];

    db.redemptions[0] = {
      id: REDEMPTION,
      user_id: USER,
      restaurant_id: RESTAURANT,
      status: 'issued',
      verified_at: VERIFIED_AT,
    };
    await expect(
      publishJournalReflection(REDEMPTION, { publicNote: PUBLIC_NOTE, rating: 5 }),
    ).resolves.toEqual({ ok: false, code: 'unverified' });

    db.redemptions[0] = {
      id: REDEMPTION,
      user_id: USER,
      restaurant_id: RESTAURANT,
      status: 'verified',
      verified_at: null,
    };
    await expect(
      publishJournalReflection(REDEMPTION, { publicNote: `line\n${PUBLIC_NOTE}`, rating: 5 }),
    ).resolves.toEqual({ ok: false, code: 'unverified' });

    expect(queries.filter((query) => query.op === 'upsert')).toEqual([]);
    expect(tablesTouched()).not.toContain('bite_notes');
    expect(tablesTouched()).not.toContain('journal_reflections');
    expect(db.bite_notes[0]).toEqual(
      expect.objectContaining({ note: 'private memory', is_public: false, rating: 2 }),
    );
    expect(db.journal_reflections[0]?.bite_note_id).toBeNull();
  });

  it('refuses an over-long note and a newline without truncating or writing', async () => {
    process.env.E08_JOURNAL_REFLECTIONS_ENABLED = 'true';
    const tooLong = 'p'.repeat(NOTE_MAX + 1);

    const longResult = await publishJournalReflection(REDEMPTION, {
      publicNote: tooLong,
      rating: 3,
      unpublished_review_draft: DRAFT,
    });
    expect(longResult).toEqual({ ok: false, code: 'too_long' });
    expect(JSON.stringify(longResult)).not.toContain('pppppppppp');

    const newline = await publishJournalReflection(REDEMPTION, {
      publicNote: 'Hi\nthere',
      rating: 3,
    });
    expect(newline).toEqual({ ok: false, code: 'invalid_text' });

    await expect(
      publishJournalReflection(REDEMPTION, { publicNote: PUBLIC_NOTE, rating: 3.5 }),
    ).resolves.toEqual({ ok: false, code: 'invalid_rating' });

    expect(queries.filter((query) => query.op === 'upsert')).toEqual([]);
    expect(tablesTouched()).not.toContain('bite_notes');
    expect(db.journal_reflections[0]?.bite_note_id).toBeNull();
    expect(db.journal_reflections[0]?.unpublished_review_draft).toBe(DRAFT);
  });

  it('publishes the chosen sentence and links bite_note_id without copying private fields', async () => {
    process.env.E08_JOURNAL_REFLECTIONS_ENABLED = 'true';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    db.bite_notes = [
      {
        id: NOTE,
        user_id: USER,
        redemption_id: REDEMPTION,
        restaurant_id: RESTAURANT,
        note: 'old private memory',
        rating: 2,
        is_public: false,
      },
    ];
    db.journal_reflections = [
      reflection({
        bite_note_id: null,
        favorite_bite: 'brisket',
        atmosphere: 'warm room',
        return_interest: 'yes',
        companion_label: 'Ada',
        unpublished_review_draft: DRAFT,
      }),
    ];

    const result = await publishJournalReflection(REDEMPTION, {
      publicNote: `  ${PUBLIC_NOTE}  `,
      rating: 5,
      bite_note_id: MISSING,
      user_id: OTHER,
      favorite_bite: DRAFT,
      atmosphere: DRAFT,
      unpublished_review_draft: DRAFT,
      fromReflection: { unpublished_review_draft: DRAFT, favorite_bite: 'brisket' },
    });

    expect(result).toEqual({ ok: true, biteNoteId: NOTE });
    expect(JSON.stringify(result)).not.toContain(PUBLIC_NOTE);
    expect(JSON.stringify(result)).not.toContain(DRAFT);

    const noteWrite = queries.find((query) => query.table === 'bite_notes' && query.op === 'upsert');
    expect(noteWrite?.options).toEqual({ onConflict: 'redemption_id' });
    expect(noteWrite?.payload).toEqual({
      user_id: USER,
      redemption_id: REDEMPTION,
      restaurant_id: RESTAURANT,
      note: PUBLIC_NOTE,
      rating: 5,
      is_public: true,
      updated_at: expect.any(String),
    });
    expect(noteWrite?.payload).not.toHaveProperty('favorite_bite');
    expect(noteWrite?.payload).not.toHaveProperty('unpublished_review_draft');
    expect(JSON.stringify(noteWrite?.payload)).not.toContain(DRAFT);

    const linkWrite = queries.find(
      (query) => query.table === 'journal_reflections' && query.op === 'upsert',
    );
    expect(linkWrite?.payload).toEqual({
      user_id: USER,
      redemption_id: REDEMPTION,
      bite_note_id: NOTE,
      updated_at: expect.any(String),
    });
    expect(linkWrite?.payload).not.toHaveProperty('favorite_bite');
    expect(linkWrite?.payload).not.toHaveProperty('unpublished_review_draft');

    expect(db.bite_notes[0]).toEqual(
      expect.objectContaining({
        id: NOTE,
        user_id: USER,
        note: PUBLIC_NOTE,
        rating: 5,
        is_public: true,
      }),
    );
    expect(db.bite_notes[0]).not.toHaveProperty('favorite_bite');
    expect(JSON.stringify(db.bite_notes[0])).not.toContain(DRAFT);
    expect(db.journal_reflections[0]).toEqual(
      expect.objectContaining({
        bite_note_id: NOTE,
        favorite_bite: 'brisket',
        atmosphere: 'warm room',
        return_interest: 'yes',
        companion_label: 'Ada',
        unpublished_review_draft: DRAFT,
      }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('creates a reflection row when publish is the first write', async () => {
    process.env.E08_JOURNAL_REFLECTIONS_ENABLED = 'true';
    db.journal_reflections = [];
    db.bite_notes = [];

    const result = await publishJournalReflection(REDEMPTION, {
      publicNote: '',
      rating: 1,
      unpublished_review_draft: DRAFT,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);

    expect(db.bite_notes).toHaveLength(1);
    expect(db.bite_notes[0]).toEqual(
      expect.objectContaining({
        user_id: USER,
        redemption_id: REDEMPTION,
        restaurant_id: RESTAURANT,
        note: null,
        rating: 1,
        is_public: true,
      }),
    );
    expect(result.biteNoteId).toBe(db.bite_notes[0]?.id);
    expect(db.journal_reflections).toHaveLength(1);
    expect(db.journal_reflections[0]).toEqual(
      expect.objectContaining({
        user_id: USER,
        redemption_id: REDEMPTION,
        bite_note_id: result.biteNoteId,
      }),
    );
    expect(db.journal_reflections[0]).not.toHaveProperty('favorite_bite');
    expect(db.journal_reflections[0]).not.toHaveProperty('unpublished_review_draft');
    expect(JSON.stringify(db.journal_reflections[0])).not.toContain(DRAFT);
  });

  it('hides save and link failures and does not link a note that failed to write', async () => {
    process.env.E08_JOURNAL_REFLECTIONS_ENABLED = 'true';
    db.journal_reflections = [reflection({ bite_note_id: null, unpublished_review_draft: DRAFT })];
    errors.bite_notes = { message: `write ${DRAFT} ${PUBLIC_NOTE}` };

    const saved = await publishJournalReflection(REDEMPTION, { publicNote: PUBLIC_NOTE, rating: 4 });
    expect(saved).toEqual({ ok: false, code: 'save_failed' });
    expect(JSON.stringify(saved)).not.toContain(DRAFT);
    expect(JSON.stringify(saved)).not.toContain(PUBLIC_NOTE);
    expect(queries.filter((query) => query.table === 'journal_reflections')).toEqual([]);
    expect(db.journal_reflections[0]?.bite_note_id).toBeNull();

    errors.bite_notes = null;
    errors.journal_reflections = { message: `link ${DRAFT} ${PLACE_ID}` };
    const linked = await publishJournalReflection(REDEMPTION, { publicNote: PUBLIC_NOTE, rating: 4 });
    expect(linked).toEqual({ ok: false, code: 'link_failed' });
    expect(JSON.stringify(linked)).not.toContain(DRAFT);
    expect(JSON.stringify(linked)).not.toContain(PLACE_ID);
    expect(JSON.stringify(linked)).not.toContain(PUBLIC_NOTE);
    expect(db.bite_notes[0]).toEqual(expect.objectContaining({ note: PUBLIC_NOTE, is_public: true }));
    expect(db.journal_reflections[0]?.bite_note_id).toBeNull();
    expect(db.journal_reflections[0]?.unpublished_review_draft).toBe(DRAFT);
  });

  it('refuses a publish when the visit has no restaurant', async () => {
    process.env.E08_JOURNAL_REFLECTIONS_ENABLED = 'true';
    db.redemptions = [
      {
        id: REDEMPTION,
        user_id: USER,
        restaurant_id: null,
        status: 'verified',
        verified_at: VERIFIED_AT,
      },
    ];

    await expect(
      publishJournalReflection(REDEMPTION, { publicNote: PUBLIC_NOTE, rating: 4 }),
    ).resolves.toEqual({ ok: false, code: 'save_failed' });
    expect(queries.filter((query) => query.op === 'upsert')).toEqual([]);
    expect(tablesTouched()).toEqual(['redemptions']);
  });

  it('keeps saveBiteNote off the journal reflection and off the publish flag', async () => {
    delete process.env.E08_JOURNAL_REFLECTIONS_ENABLED;
    db.journal_reflections = [reflection({ bite_note_id: NOTE, unpublished_review_draft: DRAFT })];
    queries.length = 0;

    await expect(saveBiteNote(REDEMPTION, 'Private memory', 4, false)).resolves.toEqual({ ok: true });

    expect(tablesTouched()).toEqual(['redemptions', 'bite_notes']);
    const write = queries.find((query) => query.op === 'upsert');
    expect(write?.table).toBe('bite_notes');
    expect(write?.payload).toEqual(
      expect.objectContaining({
        user_id: USER,
        redemption_id: REDEMPTION,
        note: 'Private memory',
        rating: 4,
        is_public: false,
      }),
    );
    expect(write?.payload).not.toHaveProperty('favorite_bite');
    expect(write?.payload).not.toHaveProperty('unpublished_review_draft');
    expect(db.journal_reflections[0]?.bite_note_id).toBe(NOTE);
    expect(db.journal_reflections[0]?.unpublished_review_draft).toBe(DRAFT);
    expect(queries.some((query) => query.table === 'journal_reflections')).toBe(false);
  });
});
