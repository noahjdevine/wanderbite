import 'server-only';

import { logAdminAction, type AdminAuditAction } from '@/lib/audit/log-admin-action';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import type { ActivityNoteStore, ActivityNoteStatus, StoredActivityNote } from '@/lib/activities/note-review';
import type { ReviewActivity } from '@/lib/activities/note-review';

function asStatus(value: string): ActivityNoteStatus | null {
  if (value === 'draft' || value === 'approved' || value === 'rejected' || value === 'paused') return value;
  return null;
}

function mapNote(row: {
  id: string;
  restaurant_id: string;
  body: string;
  status: string;
  activity_ids: string[];
  version: number;
  reviewed_at: string | null;
  reviewed_by: string | null;
}): StoredActivityNote | null {
  const status = asStatus(row.status);
  if (!status) return null;
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    body: row.body,
    status,
    activityIds: row.activity_ids,
    version: row.version,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
  };
}

const NOTE_COLUMNS =
  'id, restaurant_id, body, status, activity_ids, version, reviewed_at, reviewed_by';

export function activityNoteStore(supabase = getSupabaseAdmin()): ActivityNoteStore {
  return {
    async loadNote(id) {
      const { data, error } = await supabase
        .from('restaurant_activity_notes')
        .select(NOTE_COLUMNS)
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error('Activity note lookup failed.');
      return data ? mapNote(data) : null;
    },
    async loadActivities(ids) {
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from('activities')
        .select('id, name, status, is_sample, source_url, valid_from, valid_until, last_verified_at')
        .in('id', [...ids]);
      if (error) throw new Error('Activity lookup failed.');
      return (data ?? []).flatMap((row): ReviewActivity[] => {
        if (!row.name.trim()) return [];
        return [{
          id: row.id,
          name: row.name,
          status: row.status,
          is_sample: row.is_sample,
          source_url: row.source_url,
          valid_from: row.valid_from,
          valid_until: row.valid_until,
          last_verified_at: row.last_verified_at,
        }];
      });
    },
    async listApproved(restaurantId) {
      const { data, error } = await supabase
        .from('restaurant_activity_notes')
        .select(NOTE_COLUMNS)
        .eq('restaurant_id', restaurantId)
        .eq('status', 'approved');
      if (error) throw new Error('Approved note lookup failed.');
      return (data ?? []).flatMap((row) => {
        const note = mapNote(row);
        return note ? [note] : [];
      });
    },
    async save(note, expectedStatus) {
      const { data, error } = await supabase
        .from('restaurant_activity_notes')
        .update({
          body: note.body,
          status: note.status,
          version: note.version,
          reviewed_at: note.reviewedAt,
          reviewed_by: note.reviewedBy,
        })
        .eq('id', note.id)
        .eq('status', expectedStatus)
        .select('id');
      if (error) return false;
      return (data ?? []).length === 1;
    },
    async audit(entry) {
      const action = entry.action as AdminAuditAction;
      const wrote = await logAdminAction({
        actorUserId: entry.adminId,
        action,
        targetType: 'restaurant_activity_note',
        targetId: entry.noteId,
        metadata: entry.metadata,
      });
      if (!wrote) throw new Error('Audit row was not written.');
    },
  };
}
