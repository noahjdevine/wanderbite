import { chicagoCalendarDate } from '@/lib/activities/match';
import { ACTIVITY_STALE_AFTER_MS } from '@/lib/activities/types';

export type NoteVisibleActivity = {
  id: string;
  status: string;
  is_sample: boolean;
  source_url: string | null;
  valid_from: string | null;
  valid_until: string | null;
  last_verified_at: string | null;
};

export type NoteVisibilityInput = {
  status: string;
  isSample: boolean;
  activityIds: readonly string[];
};

function officialUrl(sourceUrl: string | null): boolean {
  if (!sourceUrl) return false;
  return /^https:\/\/\S+$/.test(sourceUrl.trim());
}

function freshEnough(lastVerifiedAt: string | null, now: Date): boolean {
  if (!lastVerifiedAt) return false;
  const verified = new Date(lastVerifiedAt);
  if (Number.isNaN(verified.getTime())) return false;
  return now.getTime() - verified.getTime() <= ACTIVITY_STALE_AFTER_MS;
}

function calendarCurrent(activity: NoteVisibleActivity, today: string): boolean {
  if (!today) return false;
  if (activity.valid_from && activity.valid_from > today) return false;
  if (activity.valid_until && activity.valid_until < today) return false;
  return true;
}

/** Same showing rules as match.ts, plus not a sample row. */
export function activityIsNoteVisible(activity: NoteVisibleActivity, now: Date): boolean {
  if (activity.status !== 'active' || activity.is_sample) return false;
  if (!officialUrl(activity.source_url)) return false;
  if (!calendarCurrent(activity, chicagoCalendarDate(now))) return false;
  return freshEnough(activity.last_verified_at, now);
}

export function noteCanShow(
  note: NoteVisibilityInput,
  activities: ReadonlyMap<string, NoteVisibleActivity>,
  now: Date,
): boolean {
  if (note.status !== 'approved' || note.isSample) return false;
  if (note.activityIds.length < 1 || note.activityIds.length > 2) return false;
  return note.activityIds.every((id) => {
    const activity = activities.get(id);
    return activity ? activityIsNoteVisible(activity, now) : false;
  });
}

/** Approved notes maintenance may pause. A paused note is not returned here. */
export function approvedNotesToPause<T extends NoteVisibilityInput>(
  notes: readonly T[],
  activities: ReadonlyMap<string, NoteVisibleActivity>,
  now: Date,
): T[] {
  return notes.filter((note) => note.status === 'approved' && !noteCanShow(note, activities, now));
}
