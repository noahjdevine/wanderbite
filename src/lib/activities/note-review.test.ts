import { describe, expect, it } from 'vitest';
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
  'After dinner, you could wander through Chestnut Square Village and let the meal settle while you walk. It is a small detour that keeps the night easy.';
const EDITED =
  'After dinner, you could wander through Chestnut Square Village and let the meal settle while you walk. Save the second stop for a night when you want to sit down.';

function activity(): ReviewActivity {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: PLACE,
    status: 'active',
    is_sample: false,
    source_url: 'https://example.com/chestnut-square',
    valid_from: null,
    valid_until: null,
    last_verified_at: '2026-11-02T18:00:00.000Z',
  };
}

function memory(notes: StoredActivityNote[]): ActivityNoteStore {
  return {
    async loadNote(id) {
      return notes.find((note) => note.id === id) ?? null;
    },
    async loadActivities() {
      return [activity()];
    },
    async listApproved(restaurantId) {
      return notes.filter((note) => note.restaurantId === restaurantId && note.status === 'approved');
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

  it('does not approve a draft whose cited activity is paused', async () => {
    const notes = [draft('note-1')];
    const store = memory(notes);
    store.loadActivities = async () => [{ ...activity(), status: 'paused' }];
    const approved = await approveRestaurantActivityNote(store, { noteId: 'note-1', adminId: 'admin', now: NOW });
    expect(approved).toEqual({ ok: false, error: 'A cited activity is not currently showing.' });
    expect(notes[0]?.status).toBe('draft');
  });
});
