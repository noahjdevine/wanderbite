import {
  activityDisplayName,
  activityNoteBodyError,
  type ActivityNoteCitedPlace,
} from '@/lib/activities/note-copy';
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

export type ReviewActivity = NoteVisibleActivity & {
  name: string;
  /** True when the unrounded distance from the restaurant is within a half mile. */
  walkable: boolean;
  /** Downtown wander at a Historic Downtown restaurant. The pin is not a walk. */
  areaWander?: boolean;
};

export type ActivityNoteStore = {
  loadNote(id: string): Promise<StoredActivityNote | null>;
  loadActivities(ids: readonly string[], restaurantId: string): Promise<ReviewActivity[]>;
  approveDraft(args: {
    noteId: string;
    expectedVersion: number;
    adminId: string;
    now: string;
  }): Promise<boolean>;
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
  const rows = await store.loadActivities(note.activityIds, note.restaurantId);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const chosen: ReviewActivity[] = [];
  for (const id of note.activityIds) {
    const row = byId.get(id);
    if (!row || !row.name.trim()) return null;
    chosen.push(row);
  }
  return chosen;
}

function citedPlaces(activities: readonly ReviewActivity[]): ActivityNoteCitedPlace[] {
  return activities.map((activity) => ({
    name: activity.name,
    displayName: activityDisplayName(activity.name),
    walkable: activity.walkable,
    areaWander: activity.areaWander,
  }));
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
    cited: citedPlaces(activities),
  });
  if (bodyError) return { ok: false, error: bodyError };
  const now = args.now ?? new Date();
  if (!activities.every((activity) => activityIsNoteVisible(activity, now))) {
    return { ok: false, error: 'A cited activity is not currently showing.' };
  }
  const reviewedAt = now.toISOString();
  const saved = await store.approveDraft({
    noteId: note.id,
    expectedVersion: note.version,
    adminId: args.adminId,
    now: reviewedAt,
  });
  if (!saved) return { ok: false, error: 'This note changed before it could be approved.' };
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
    cited: citedPlaces(activities),
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
