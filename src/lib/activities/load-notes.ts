import 'server-only';

import { createClient } from '@/lib/supabase/server';
import {
  activitiesEnabled,
  activityNotesEnabled,
  activitySchemaMissing,
  logActivityNotesReadFailedOnce,
  logActivityNotesUnavailableOnce,
} from '@/lib/activities/flag';
import { noteCanShow, type NoteVisibleActivity } from '@/lib/activities/note-visibility';
import type { ActivityNoteMap } from '@/lib/activities/types';

const EMPTY: ActivityNoteMap = { byRestaurantId: {} };

const NOTE_COLUMNS = 'id, restaurant_id, body, status, activity_ids, is_sample';
const ACTIVITY_COLUMNS =
  'id, status, is_sample, source_url, valid_from, valid_until, last_verified_at';

type NoteRow = {
  id: string;
  restaurant_id: string;
  body: string;
  status: string;
  activity_ids: string[];
  is_sample: boolean;
};

function isNoteRow(value: NoteRow): boolean {
  return (
    typeof value.id === 'string' &&
    typeof value.restaurant_id === 'string' &&
    typeof value.body === 'string' &&
    Array.isArray(value.activity_ids)
  );
}

/**
 * Both flags must be the exact string true. Otherwise this returns before
 * opening a client, so the member path does not read restaurant_activity_notes.
 * A missing table also returns nothing. This function does not write.
 */
export async function loadActivityNotes(args: {
  restaurantIds: readonly string[];
  now?: Date;
}): Promise<ActivityNoteMap> {
  if (!activitiesEnabled() || !activityNotesEnabled()) return EMPTY;
  const restaurantIds = [...new Set(args.restaurantIds.filter(Boolean))];
  if (restaurantIds.length === 0) return EMPTY;
  const supabase = await createClient();
  const notesResult = await supabase
    .from('restaurant_activity_notes')
    .select(NOTE_COLUMNS)
    .in('restaurant_id', restaurantIds)
    .eq('status', 'approved')
    .eq('is_sample', false);
  if (notesResult.error) {
    if (activitySchemaMissing(notesResult.error)) logActivityNotesUnavailableOnce();
    else logActivityNotesReadFailedOnce();
    return EMPTY;
  }
  const notes = (notesResult.data ?? []).filter(isNoteRow);
  const activityIds = [...new Set(notes.flatMap((note) => note.activity_ids))];
  if (notes.length === 0 || activityIds.length === 0) return EMPTY;
  const activitiesResult = await supabase
    .from('activities')
    .select(ACTIVITY_COLUMNS)
    .in('id', activityIds);
  if (activitiesResult.error) {
    logActivityNotesReadFailedOnce();
    return EMPTY;
  }
  const activities = new Map<string, NoteVisibleActivity>();
  for (const row of activitiesResult.data ?? []) {
    activities.set(row.id, row);
  }
  const now = args.now ?? new Date();
  const byRestaurantId: Record<string, string> = {};
  for (const note of notes) {
    if (byRestaurantId[note.restaurant_id]) continue;
    const visible = noteCanShow(
      { status: note.status, isSample: note.is_sample, activityIds: note.activity_ids },
      activities,
      now,
    );
    if (!visible) continue;
    const body = note.body.trim();
    if (body) byRestaurantId[note.restaurant_id] = body;
  }
  return { byRestaurantId };
}
