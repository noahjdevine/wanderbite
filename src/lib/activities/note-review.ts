import { activityNoteBodyError } from '@/lib/activities/note-copy';
import { activityIsNoteVisible, type NoteVisibleActivity } from '@/lib/activities/note-visibility';

export type ActivityNoteStatus = 'draft' | 'approved' | 'rejected' | 'paused';

export type StoredActivityNote = {
  id: string;
  restaurantId: string;
  body: string;
  status: ActivityNoteStatus;
  activityIds: string[];
  version: number;
  reviewedAt: string | null;
  reviewedBy: string | null;
};

export type ReviewActivity = NoteVisibleActivity & { name: string };

export type ActivityNoteStore = {
  loadNote(id: string): Promise<StoredActivityNote | null>;
  loadActivities(ids: readonly string[]): Promise<ReviewActivity[]>;
  listApproved(restaurantId: string): Promise<StoredActivityNote[]>;
  save(note: StoredActivityNote, expectedStatus: ActivityNoteStatus): Promise<boolean>;
  audit(entry: { adminId: string; action: string; noteId: string; metadata: Record<string, unknown> }): Promise<void>;
};

export type ActivityNoteActionResult =
  | { ok: true; published: boolean; notice: string }
  | { ok: false; error: string };

async function citedActivities(
  store: ActivityNoteStore,
  note: StoredActivityNote,
): Promise<ReviewActivity[] | null> {
  const rows = await store.loadActivities(note.activityIds);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const chosen: ReviewActivity[] = [];
  for (const id of note.activityIds) {
    const row = byId.get(id);
    if (!row || !row.name.trim()) return null;
    chosen.push(row);
  }
  return chosen;
}

export async function approveRestaurantActivityNote(
  store: ActivityNoteStore,
  args: { noteId: string; adminId: string; now?: Date },
): Promise<ActivityNoteActionResult> {
  const note = await store.loadNote(args.noteId);
  if (!note || note.status !== 'draft') return { ok: false, error: 'Activity note not found.' };
  const activities = await citedActivities(store, note);
  if (!activities) return { ok: false, error: 'A cited activity is missing.' };
  const bodyError = activityNoteBodyError(note.body, {
    requiredNames: activities.map((activity) => activity.name),
  });
  if (bodyError) return { ok: false, error: bodyError };
  const now = args.now ?? new Date();
  if (!activities.every((activity) => activityIsNoteVisible(activity, now))) {
    return { ok: false, error: 'A cited activity is not currently showing.' };
  }
  const reviewedAt = now.toISOString();
  const approved = await store.listApproved(note.restaurantId);
  for (const prior of approved) {
    const paused = await store.save(
      {
        ...prior,
        status: 'paused',
        version: prior.version + 1,
        reviewedAt,
        reviewedBy: args.adminId,
      },
      'approved',
    );
    if (!paused) return { ok: false, error: 'The previous approved note could not be paused.' };
  }
  const saved = await store.save(
    {
      ...note,
      status: 'approved',
      version: note.version + 1,
      reviewedAt,
      reviewedBy: args.adminId,
    },
    'draft',
  );
  if (!saved) return { ok: false, error: 'Activity note could not be saved.' };
  await store.audit({
    adminId: args.adminId,
    action: 'content.activity_note_approve',
    noteId: note.id,
    metadata: { published: true },
  });
  return {
    ok: true,
    published: true,
    notice: 'Approved. Members can see this note while every cited place is still showing.',
  };
}

export async function editRestaurantActivityNote(
  store: ActivityNoteStore,
  args: { noteId: string; adminId: string; body: string },
): Promise<ActivityNoteActionResult> {
  const note = await store.loadNote(args.noteId);
  if (!note || note.status !== 'draft') return { ok: false, error: 'Only a draft note can be edited.' };
  const activities = await citedActivities(store, note);
  if (!activities) return { ok: false, error: 'A cited activity is missing.' };
  const bodyError = activityNoteBodyError(args.body, {
    requiredNames: activities.map((activity) => activity.name),
  });
  if (bodyError) return { ok: false, error: bodyError };
  const saved = await store.save(
    { ...note, body: args.body.trim(), version: note.version + 1 },
    'draft',
  );
  if (!saved) return { ok: false, error: 'Activity note could not be saved.' };
  await store.audit({
    adminId: args.adminId,
    action: 'content.activity_note_edit',
    noteId: note.id,
    metadata: { published: false },
  });
  return { ok: true, published: false, notice: 'Saved the edit. The note stays a draft until you approve it.' };
}

export async function rejectRestaurantActivityNote(
  store: ActivityNoteStore,
  args: { noteId: string; adminId: string; now?: Date },
): Promise<ActivityNoteActionResult> {
  const note = await store.loadNote(args.noteId);
  if (!note || note.status !== 'draft') return { ok: false, error: 'Only a draft note can be rejected.' };
  const now = args.now ?? new Date();
  const saved = await store.save(
    {
      ...note,
      status: 'rejected',
      version: note.version + 1,
      reviewedAt: now.toISOString(),
      reviewedBy: args.adminId,
    },
    'draft',
  );
  if (!saved) return { ok: false, error: 'Activity note could not be saved.' };
  await store.audit({
    adminId: args.adminId,
    action: 'content.activity_note_reject',
    noteId: note.id,
    metadata: { published: false },
  });
  return { ok: true, published: false, notice: 'Rejected. Members do not see this note.' };
}
