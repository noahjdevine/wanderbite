import { describe, expect, it } from 'vitest';
import { ACTIVITY_NOTE_WALK_DISTANCE_REASON } from '@/lib/activities/note-copy';
import {
  approveRestaurantActivityNote,
  editRestaurantActivityNote,
  rejectRestaurantActivityNote,
  type ActivityNoteStore,
  type ReviewActivity,
  type StoredActivityNote,
} from '@/lib/activities/note-review';

const NOW = new Date('2026-11-04T18:00:00.000Z');
const PLACE = 'Chestnut Square Village';
const BODY =
  'You could wander through Chestnut Square Village and let the meal settle while you walk. It is a small detour that keeps the night easy.';
const EDITED =
  'You could wander through Chestnut Square Village and let the meal settle while you walk. Save the second stop for a night when you want to sit down.';

function activity(overrides: Partial<ReviewActivity> = {}): ReviewActivity {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: PLACE,
    status: 'active',
    is_sample: false,
    source_url: 'https://example.com/chestnut-square',
    valid_from: null,
    valid_until: null,
    last_verified_at: '2026-11-02T18:00:00.000Z',
    walkable: true,
    ...overrides,
  };
}

function memory(notes: StoredActivityNote[]): ActivityNoteStore {
  return {
    async loadNote(id) {
      const found = notes.find((note) => note.id === id);
      return found ? { ...found } : null;
    },
    async loadActivities() {
      return [activity()];
    },
    async approveDraft(args) {
      const note = notes.find((row) => row.id === args.noteId);
      if (!note || note.status !== 'draft' || note.version !== args.expectedVersion) {
        return { ok: false, reason: 'stale' };
      }
      for (const prior of notes) {
        if (prior.restaurantId !== note.restaurantId || prior.status !== 'approved') continue;
        prior.status = 'paused';
        prior.version += 1;
        prior.reviewedAt = args.now;
        prior.reviewedBy = args.adminId;
      }
      note.status = 'approved';
      note.version += 1;
      note.reviewedAt = args.now;
      note.reviewedBy = args.adminId;
      return { ok: true };
    },
    async save(note, expectedStatus) {
      const current = notes.find((row) => row.id === note.id);
      if (!current || current.status !== expectedStatus) return false;
      Object.assign(current, note);
      return true;
    },
    async audit() {
      return undefined;
    },
  };
}

function draft(id: string, status: StoredActivityNote['status'] = 'draft'): StoredActivityNote {
  return {
    id,
    restaurantId: '11111111-1111-4111-8111-111111111111',
    body: BODY,
    status,
    activityIds: [activity().id],
    version: 1,
    reviewedAt: null,
    reviewedBy: null,
  };
}

describe('activity note review', () => {
  it('approves a draft, edits the wording, and rejects without showing it', async () => {
    const notes = [draft('note-1')];
    const store = memory(notes);
    const approved = await approveRestaurantActivityNote(store, { noteId: 'note-1', adminId: 'admin', now: NOW });
    expect(approved).toMatchObject({ ok: true, published: true });
    expect(notes[0]?.status).toBe('approved');
    notes[0]!.status = 'draft';
    const edited = await editRestaurantActivityNote(store, { noteId: 'note-1', adminId: 'admin', body: EDITED });
    expect(edited).toMatchObject({ ok: true, published: false });
    expect(notes[0]?.body).toBe(EDITED);
    expect(notes[0]?.status).toBe('draft');
    const rejected = await rejectRestaurantActivityNote(store, { noteId: 'note-1', adminId: 'admin', now: NOW });
    expect(rejected).toMatchObject({ ok: true, published: false });
    expect(notes[0]?.status).toBe('rejected');
  });

  it('leaves one approved note when a second draft is approved', async () => {
    const notes = [draft('note-1', 'approved'), draft('note-2')];
    const store = memory(notes);
    const approved = await approveRestaurantActivityNote(store, { noteId: 'note-2', adminId: 'admin', now: NOW });
    expect(approved.ok).toBe(true);
    expect(notes.filter((note) => note.status === 'approved').map((note) => note.id)).toEqual(['note-2']);
    expect(notes.find((note) => note.id === 'note-1')?.status).toBe('paused');
  });

  it('writes nothing and skips the audit when the draft version is stale', async () => {
    const notes = [draft('note-1', 'approved'), draft('note-2')];
    const store = memory(notes);
    const load = store.loadNote.bind(store);
    let audits = 0;
    store.loadNote = async (id) => {
      const note = await load(id);
      if (id === 'note-2') {
        const row = notes.find((item) => item.id === id);
        if (row) row.version = 9;
      }
      return note;
    };
    store.audit = async () => {
      audits += 1;
    };
    const approved = await approveRestaurantActivityNote(store, { noteId: 'note-2', adminId: 'admin', now: NOW });
    expect(approved).toEqual({ ok: false, error: 'This note changed before it could be approved.' });
    expect(notes.map((note) => note.status)).toEqual(['approved', 'draft']);
    expect(notes.find((note) => note.id === 'note-2')?.version).toBe(9);
    expect(audits).toBe(0);
  });

  it('blocks a short-walk review when the cited place is not walkable', async () => {
    const notes = [draft('note-1')];
    const store = memory(notes);
    const far = "Dinner is done, and it's a short walk to The Comedy Arena. The set is the easy way to let a heavy plate settle.";
    store.loadActivities = async () => [activity({ name: 'The Comedy Arena', walkable: false })];
    notes[0]!.body = far;
    const approved = await approveRestaurantActivityNote(store, { noteId: 'note-1', adminId: 'admin', now: NOW });
    expect(approved).toEqual({ ok: false, error: ACTIVITY_NOTE_WALK_DISTANCE_REASON });
    expect(notes[0]?.status).toBe('draft');
    const edited = await editRestaurantActivityNote(store, { noteId: 'note-1', adminId: 'admin', body: far });
    expect(edited).toEqual({ ok: false, error: ACTIVITY_NOTE_WALK_DISTANCE_REASON });
    expect(notes[0]?.body).toBe(far);
    store.loadActivities = async () => [activity({ name: 'The Comedy Arena', walkable: true })];
    const allowed = await editRestaurantActivityNote(store, { noteId: 'note-1', adminId: 'admin', body: far });
    expect(allowed).toMatchObject({ ok: true, published: false });
    expect(notes[0]?.body).toBe(far);
  });

  it('blocks a mixed pair when the walk sentence names the far place', async () => {
    const squareId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const arenaId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const notes = [draft('note-1')];
    notes[0]!.activityIds = [squareId, arenaId];
    const store = memory(notes);
    store.loadActivities = async () => [
      activity({ id: squareId, name: 'Chestnut Square Village', walkable: true }),
      activity({ id: arenaId, name: 'The Comedy Arena', walkable: false }),
    ];
    const farSentence =
      'It is a short walk to The Comedy Arena after the plates are cleared. Chestnut Square Village is the other stop if you want to wander.';
    const closeSentence =
      'It is a short walk to Chestnut Square Village after the plates are cleared. The Comedy Arena is the other stop if you want to sit.';
    notes[0]!.body = farSentence;
    const approved = await approveRestaurantActivityNote(store, { noteId: 'note-1', adminId: 'admin', now: NOW });
    expect(approved).toEqual({ ok: false, error: ACTIVITY_NOTE_WALK_DISTANCE_REASON });
    expect(notes[0]?.status).toBe('draft');
    const edited = await editRestaurantActivityNote(store, { noteId: 'note-1', adminId: 'admin', body: farSentence });
    expect(edited).toEqual({ ok: false, error: ACTIVITY_NOTE_WALK_DISTANCE_REASON });
    expect(notes[0]?.body).toBe(farSentence);
    const saved = await editRestaurantActivityNote(store, { noteId: 'note-1', adminId: 'admin', body: closeSentence });
    expect(saved).toMatchObject({ ok: true, published: false });
    expect(notes[0]?.body).toBe(closeSentence);
    expect(notes[0]?.status).toBe('draft');
    const published = await approveRestaurantActivityNote(store, { noteId: 'note-1', adminId: 'admin', now: NOW });
    expect(published).toMatchObject({ ok: true, published: true });
    expect(notes[0]?.status).toBe('approved');
  });

  it('writes one audit row only after the note is approved', async () => {
    const notes = [draft('note-1')];
    const store = memory(notes);
    let audits = 0;
    store.audit = async () => {
      audits += 1;
    };
    const approved = await approveRestaurantActivityNote(store, { noteId: 'note-1', adminId: 'admin', now: NOW });
    expect(approved).toMatchObject({ ok: true, published: true });
    expect(notes[0]?.status).toBe('approved');
    expect(audits).toBe(1);
  });

  it('reports that approving is unavailable and writes no audit for another failure', async () => {
    const notes = [draft('note-1')];
    const store = memory(notes);
    let audits = 0;
    store.approveDraft = async () => ({ ok: false, reason: 'unavailable' });
    store.audit = async () => {
      audits += 1;
    };
    const approved = await approveRestaurantActivityNote(store, { noteId: 'note-1', adminId: 'admin', now: NOW });
    expect(approved).toEqual({
      ok: false,
      error: "Approving notes isn't available right now. Nothing was changed.",
    });
    expect(notes[0]?.status).toBe('draft');
    expect(notes[0]?.version).toBe(1);
    expect(audits).toBe(0);
  });

  it('does not approve a draft whose cited activity is paused', async () => {
    const notes = [draft('note-1')];
    const store = memory(notes);
    store.loadActivities = async () => [{ ...activity(), status: 'paused' }];
    const approved = await approveRestaurantActivityNote(store, { noteId: 'note-1', adminId: 'admin', now: NOW });
    expect(approved).toEqual({ ok: false, error: 'A cited activity is not currently showing.' });
    expect(notes[0]?.status).toBe('draft');
  });
});
