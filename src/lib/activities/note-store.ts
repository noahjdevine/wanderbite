import 'server-only';

import { logAdminAction, type AdminAuditAction } from '@/lib/audit/log-admin-action';
import {
  activityNoteWalkable,
  downtownWanderKind,
  isHistoricDowntownNeighborhood,
} from '@/lib/activities/note-copy';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { haversineMiles, toGeoPoint } from '@/lib/launch-market';
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

/** Raised by approve_restaurant_activity_note for a stale version or a non-draft. */
const STALE_DRAFT_SQLSTATE = '22023';
const STALE_DRAFT_MESSAGE = 'activity note is not a current draft';
const APPROVE_UNAVAILABLE_LOG = '[activity-note] approve unavailable';

function isStaleDraftRefusal(error: { code?: string | null; message?: string | null }): boolean {
  return error.code === STALE_DRAFT_SQLSTATE || error.message === STALE_DRAFT_MESSAGE;
}

function approveErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return 'unknown';
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && /^[A-Za-z0-9]{1,16}$/.test(code)) return code;
  return 'unknown';
}

function approveRefusal(error: unknown): { ok: false; reason: 'stale' | 'unavailable' } {
  if (
    error
    && typeof error === 'object'
    && isStaleDraftRefusal(error as { code?: string | null; message?: string | null })
  ) {
    return { ok: false, reason: 'stale' };
  }
  console.error(APPROVE_UNAVAILABLE_LOG, approveErrorCode(error));
  return { ok: false, reason: 'unavailable' };
}

const ACTIVITY_COLUMNS =
  'id, name, status, is_sample, source_url, valid_from, valid_until, last_verified_at, lat, lon';

/**
 * Missing coordinates are not walkable. A downtown wander in Historic Downtown
 * McKinney is not walkable from its pin. Other places use the half-mile distance.
 */
function activityWalkableFromRestaurant(args: {
  name: string;
  neighborhood: string | null | undefined;
  origin: { lat: number; lon: number } | null;
  lat: number | null;
  lon: number | null;
}): boolean {
  const point = toGeoPoint(args.lat, args.lon);
  const miles = args.origin && point ? haversineMiles(args.origin, point) : null;
  return activityNoteWalkable({
    name: args.name,
    neighborhood: args.neighborhood,
    miles,
  });
}

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
    async loadActivities(ids, restaurantId) {
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from('activities')
        .select(ACTIVITY_COLUMNS)
        .in('id', [...ids]);
      if (error) throw new Error('Activity lookup failed.');
      const place = await supabase
        .from('restaurants')
        .select('lat, lon, neighborhood')
        .eq('id', restaurantId)
        .maybeSingle();
      if (place.error) throw new Error('Restaurant lookup failed.');
      const origin = toGeoPoint(place.data?.lat, place.data?.lon);
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
          walkable: activityWalkableFromRestaurant({
            name: row.name,
            neighborhood: place.data?.neighborhood,
            origin,
            lat: row.lat,
            lon: row.lon,
          }),
          areaWander: downtownWanderKind(row.name) != null
            && isHistoricDowntownNeighborhood(place.data?.neighborhood),
        }];
      });
    },
    async approveDraft(args) {
      try {
        const { error } = await supabase.rpc('approve_restaurant_activity_note', {
          p_note_id: args.noteId,
          p_admin_id: args.adminId,
          p_now: args.now,
          p_expected_version: args.expectedVersion,
        });
        if (!error) return { ok: true };
        return approveRefusal(error);
      } catch (error) {
        return approveRefusal(error);
      }
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
