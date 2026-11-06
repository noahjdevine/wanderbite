'use server';

import { requireUser } from '@/lib/auth/require-user';
import { journalReflectionsEnabled } from '@/lib/notes/flag';
import { redemptionIsVerified } from '@/lib/notes/note-rules';
import {
  buildGoogleReviewHandoff,
  composePublicNotePublishPlan,
  validateReflectionFields,
  type GoogleHandoffRefusalCode,
  type PublishPlanRefusalCode,
  type ReflectionRefusal,
  type ReturnInterest,
} from '@/lib/notes/reflection';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { parseUuid } from '@/lib/uuid';

/**
 * Member journal reflections. `E08_JOURNAL_REFLECTIONS_ENABLED` must be the
 * exact string `true`. Otherwise every action returns `disabled` and does not
 * query `journal_reflections`.
 *
 * Codes:
 * - `disabled` — flag unset or any value other than `true`. No table query.
 * - `unauthorized` — no member session. The browser does not supply the user id.
 * - `not_found` — redemption id is missing, not a uuid, or no such redemption.
 * - `forbidden` — redemption belongs to someone else. Reflection text is not read.
 * - `read_failed` / `save_failed` — database error. The message is not returned.
 * - save also returns `invalid_input`, `invalid_text`, `too_long`, and
 *   `invalid_return_interest` from `validateReflectionFields`, including `field`.
 *   Over-long text is refused. It is not truncated.
 * - handoff also returns `missing_destination`, `invalid_place_id`,
 *   `invalid_url`, `insecure_url`, and `disallowed_host`.
 * - `publishJournalReflection` also returns `unverified`, `link_failed`, and the
 *   plan codes `invalid_input`, `invalid_rating`, `invalid_text`, `too_long`,
 *   and `invalid_reflection`. A public write still requires a verified
 *   redemption. Over-long text is refused. It is not truncated.
 *
 * Nothing here is logged. Reflection text, drafts, place ids, note text, and
 * handoff URLs stay out of logs. Save does not set `bite_note_id`. Opening
 * Google does not publish. Publish writes `bite_notes` (`note`, `rating`,
 * `is_public: true`) and then sets `bite_note_id` on the owned reflection.
 * Private reflection columns are not arguments to that write. If no reflection
 * row exists yet, publish upserts one with those columns omitted so the
 * database stores nulls, and an existing row keeps its private fields.
 * `updated_at` is set on the upsert, matching `saveBiteNote`. The before-update
 * trigger `set_journal_reflections_updated_at` also assigns `now()` on UPDATE.
 */

export type JournalReflection = {
  id: string;
  redemption_id: string;
  bite_note_id: string | null;
  favorite_bite: string | null;
  atmosphere: string | null;
  return_interest: ReturnInterest | null;
  companion_label: string | null;
  unpublished_review_draft: string | null;
  created_at: string;
  updated_at: string;
};

export type JournalReflectionActionCode =
  | 'disabled'
  | 'unauthorized'
  | 'not_found'
  | 'forbidden'
  | 'read_failed'
  | 'save_failed';

export type GetJournalReflectionResult =
  | { ok: true; reflection: JournalReflection | null }
  | { ok: false; code: Exclude<JournalReflectionActionCode, 'save_failed'> };

export type SaveJournalReflectionResult =
  | { ok: true }
  | ReflectionRefusal
  | { ok: false; code: JournalReflectionActionCode };

export type GoogleReviewHandoffActionResult =
  | { ok: true; url: string; source: 'place_id' | 'maps_url' }
  | { ok: false; code: Exclude<JournalReflectionActionCode, 'save_failed'> | GoogleHandoffRefusalCode };

export type PublishJournalReflectionResult =
  | { ok: true; biteNoteId: string }
  | {
      ok: false;
      code:
        | JournalReflectionActionCode
        | 'unverified'
        | 'link_failed'
        | PublishPlanRefusalCode;
    };

type OwnedRedemption =
  | {
      ok: true;
      userId: string;
      redemptionId: string;
      restaurantId: string | null;
      status: string | null;
      verifiedAt: string | null;
    }
  | { ok: false; code: Exclude<JournalReflectionActionCode, 'save_failed'> };

type ReflectionRow = {
  id: string;
  user_id: string;
  redemption_id: string;
  bite_note_id: string | null;
  favorite_bite: string | null;
  atmosphere: string | null;
  companion_label: string | null;
  unpublished_review_draft: string | null;
  return_interest: string | null;
  created_at: string;
  updated_at: string;
};

function refuse(code: Exclude<JournalReflectionActionCode, 'save_failed'>) {
  return { ok: false as const, code };
}

/**
 * Flag, then `requireUser()`, then the redemption row. A failed check does not
 * read `journal_reflections`. `user_id` comes from the session.
 */
async function ownedRedemption(redemptionId: unknown): Promise<OwnedRedemption> {
  if (!journalReflectionsEnabled()) return refuse('disabled');

  const auth = await requireUser();
  if (!auth.ok) return refuse('unauthorized');

  const id = typeof redemptionId === 'string' ? parseUuid(redemptionId) : null;
  if (!id) return refuse('not_found');

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('redemptions')
    .select('id, user_id, restaurant_id, status, verified_at')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) {
    if (error) return refuse('read_failed');
    return refuse('not_found');
  }
  if (data.user_id !== auth.userId) return refuse('forbidden');

  return {
    ok: true,
    userId: auth.userId,
    redemptionId: id,
    restaurantId: data.restaurant_id,
    status: data.status,
    verifiedAt: data.verified_at,
  };
}

/** Only the member-chosen sentence and rating. Private fields are dropped. */
function publicNoteInput(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;
  return {
    publicNote: record.publicNote,
    rating: record.rating,
  };
}

function textOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  return undefined;
}

function returnInterestOrNull(value: unknown): ReturnInterest | null | undefined {
  if (value === null) return null;
  if (value === 'yes' || value === 'maybe' || value === 'no') return value;
  return undefined;
}

function toReflection(row: ReflectionRow, userId: string): JournalReflection | null {
  if (row.user_id !== userId) return null;
  const favorite = textOrNull(row.favorite_bite);
  const atmosphere = textOrNull(row.atmosphere);
  const companion = textOrNull(row.companion_label);
  const draft = textOrNull(row.unpublished_review_draft);
  const interest = returnInterestOrNull(row.return_interest);
  const biteNoteId = textOrNull(row.bite_note_id);
  if (
    favorite === undefined ||
    atmosphere === undefined ||
    companion === undefined ||
    draft === undefined ||
    interest === undefined ||
    biteNoteId === undefined ||
    typeof row.id !== 'string' ||
    typeof row.redemption_id !== 'string' ||
    typeof row.created_at !== 'string' ||
    typeof row.updated_at !== 'string'
  ) {
    return null;
  }
  return {
    id: row.id,
    redemption_id: row.redemption_id,
    bite_note_id: biteNoteId,
    favorite_bite: favorite,
    atmosphere,
    return_interest: interest,
    companion_label: companion,
    unpublished_review_draft: draft,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getJournalReflection(
  redemptionId: string,
): Promise<GetJournalReflectionResult> {
  const owned = await ownedRedemption(redemptionId);
  if (!owned.ok) return owned;

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('journal_reflections')
    .select(
      'id, user_id, redemption_id, bite_note_id, favorite_bite, atmosphere, return_interest, companion_label, unpublished_review_draft, created_at, updated_at',
    )
    .eq('redemption_id', owned.redemptionId)
    .eq('user_id', owned.userId)
    .maybeSingle();

  if (error) return refuse('read_failed');
  if (!data) return { ok: true, reflection: null };
  if (data.user_id !== owned.userId) return refuse('forbidden');

  const reflection = toReflection(data, owned.userId);
  if (!reflection || reflection.redemption_id !== owned.redemptionId) {
    return refuse('read_failed');
  }
  return { ok: true, reflection };
}

export async function saveJournalReflection(
  redemptionId: string,
  fields: unknown,
): Promise<SaveJournalReflectionResult> {
  const owned = await ownedRedemption(redemptionId);
  if (!owned.ok) return owned;

  const validated = validateReflectionFields(fields);
  if (!validated.ok) return validated;

  const admin = getSupabaseAdmin();
  const { error } = await admin.from('journal_reflections').upsert(
    {
      user_id: owned.userId,
      redemption_id: owned.redemptionId,
      favorite_bite: validated.fields.favorite_bite,
      atmosphere: validated.fields.atmosphere,
      return_interest: validated.fields.return_interest,
      companion_label: validated.fields.companion_label,
      unpublished_review_draft: validated.fields.unpublished_review_draft,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'redemption_id' },
  );

  if (error) return { ok: false, code: 'save_failed' };
  return { ok: true };
}

/**
 * Explicit public publish for one owned redemption.
 * Flag, session, and ownership run first. An unverified redemption is refused
 * before `composePublicNotePublishPlan` and before any write. The plan's
 * `note`, `rating`, and `is_public: true` are the only bite-note columns taken
 * from the member. `user_id`, `redemption_id`, and `restaurant_id` come from
 * the owned redemption, never from the browser. `bite_note_id` is the id of
 * the note just written for that redemption.
 */
export async function publishJournalReflection(
  redemptionId: string,
  input: unknown,
): Promise<PublishJournalReflectionResult> {
  const owned = await ownedRedemption(redemptionId);
  if (!owned.ok) return owned;

  if (!redemptionIsVerified(owned.status, owned.verifiedAt)) {
    return { ok: false, code: 'unverified' };
  }

  const plan = composePublicNotePublishPlan(publicNoteInput(input));
  if (!plan.ok) return plan;
  if (!owned.restaurantId) return { ok: false, code: 'save_failed' };

  const admin = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { error: upsertErr } = await admin.from('bite_notes').upsert(
    {
      user_id: owned.userId,
      redemption_id: owned.redemptionId,
      restaurant_id: owned.restaurantId,
      note: plan.write.note,
      rating: plan.write.rating,
      is_public: true,
      updated_at: now,
    },
    { onConflict: 'redemption_id' },
  );
  if (upsertErr) return { ok: false, code: 'save_failed' };

  const { data: note, error: noteErr } = await admin
    .from('bite_notes')
    .select('id, user_id, redemption_id, is_public')
    .eq('redemption_id', owned.redemptionId)
    .eq('user_id', owned.userId)
    .maybeSingle();

  if (
    noteErr ||
    !note ||
    note.user_id !== owned.userId ||
    note.redemption_id !== owned.redemptionId ||
    note.is_public !== true ||
    typeof note.id !== 'string' ||
    !parseUuid(note.id)
  ) {
    return { ok: false, code: 'link_failed' };
  }

  const { error: linkErr } = await admin.from('journal_reflections').upsert(
    {
      user_id: owned.userId,
      redemption_id: owned.redemptionId,
      bite_note_id: note.id,
      updated_at: now,
    },
    { onConflict: 'redemption_id' },
  );
  if (linkErr) return { ok: false, code: 'link_failed' };
  return { ok: true, biteNoteId: note.id };
}

export async function getGoogleReviewHandoffForRedemption(
  redemptionId: string,
): Promise<GoogleReviewHandoffActionResult> {
  const owned = await ownedRedemption(redemptionId);
  if (!owned.ok) return owned;
  if (!owned.restaurantId) {
    return buildGoogleReviewHandoff({ googlePlaceId: null });
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('restaurants')
    .select('google_place_id')
    .eq('id', owned.restaurantId)
    .maybeSingle();

  if (error) return refuse('read_failed');

  const handoff = buildGoogleReviewHandoff({
    googlePlaceId: data?.google_place_id ?? null,
  });
  if (!handoff.ok) return { ok: false, code: handoff.code };
  return { ok: true, url: handoff.url, source: handoff.source };
}
