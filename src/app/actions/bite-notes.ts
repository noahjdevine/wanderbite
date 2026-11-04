'use server';

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requireUser } from '@/lib/auth/require-user';
import {
  NOTE_MAX,
  PUBLIC_REVIEW_REQUIRES_VERIFIED,
  redemptionIsVerified,
} from '@/lib/notes/note-rules';

/** Minimal fields for dashboard cards (keyed by redemption). */
export type BiteNoteSummary = {
  id: string;
  redemption_id: string;
  note: string | null;
  rating: number;
  is_public: boolean;
};

export type BiteNoteRow = {
  id: string;
  redemption_id: string;
  restaurant_id: string;
  note: string | null;
  rating: number;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  restaurant: { name: string; address: string | null };
};

export type PublicReview = {
  id: string;
  rating: number;
  note: string | null;
  created_at: string;
  maskedAuthor: string;
};

export type GetPublicReviewsResult =
  | { ok: true; data: PublicReview[] }
  | { ok: false; error: string };

export type ToggleNoteVisibilityResult = { ok: true } | { ok: false; error: string };

export type SaveBiteNoteResult = { ok: true } | { ok: false; error: string };

function maskAuthorLabel(username: string | null, email: string | null): string {
  const base =
    (username && username.trim()) ||
    (email && email.split('@')[0]?.trim()) ||
    'Wa';
  const s = base.length >= 2 ? base.slice(0, 2) : `${base}*`.slice(0, 2);
  return `${s}***`;
}

/**
 * Upserts the user's bite note for a redemption (one per redemption).
 * Verifies the redemption belongs to the user before writing.
 * A public note also requires a verified redemption. Note text is not logged.
 */
export async function saveBiteNote(
  redemptionId: string,
  note: string,
  rating: number,
  isPublic?: boolean
): Promise<SaveBiteNoteResult> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  const trimmed = note?.trim() ?? '';
  if (trimmed.length > NOTE_MAX) {
    return { ok: false, error: `Note must be ${NOTE_MAX} characters or less.` };
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: 'Pick a rating from 1 to 5 stars.' };
  }

  const admin = getSupabaseAdmin();
  const { data: redemption, error: redErr } = await admin
    .from('redemptions')
    .select('id, user_id, restaurant_id, status, verified_at')
    .eq('id', redemptionId)
    .maybeSingle();

  if (redErr || !redemption) {
    return { ok: false, error: 'Redemption not found.' };
  }
  const r = redemption as {
    id: string;
    user_id: string;
    restaurant_id: string;
    status: string | null;
    verified_at: string | null;
  };
  if (r.user_id !== auth.userId) {
    return { ok: false, error: 'You can only add notes to your own visits.' };
  }
  if (isPublic && !redemptionIsVerified(r.status, r.verified_at)) {
    return { ok: false, error: PUBLIC_REVIEW_REQUIRES_VERIFIED };
  }

  const now = new Date().toISOString();
  const { error: upsertErr } = await admin.from('bite_notes').upsert(
    {
      user_id: auth.userId,
      redemption_id: r.id,
      restaurant_id: r.restaurant_id,
      note: trimmed.length ? trimmed : null,
      rating,
      is_public: Boolean(isPublic),
      updated_at: now,
    },
    { onConflict: 'redemption_id' }
  );

  if (upsertErr) {
    return { ok: false, error: upsertErr.message };
  }
  return { ok: true };
}

type PublicNoteRow = {
  id: string;
  rating: number;
  note: string | null;
  created_at: string;
  user_profiles:
    | { username: string | null; email: string | null }
    | { username: string | null; email: string | null }[]
    | null;
};

function toPublicReview(row: PublicNoteRow): PublicReview {
  const rel = row.user_profiles;
  const prof = Array.isArray(rel) ? rel[0] : rel;
  return {
    id: row.id,
    rating: row.rating,
    note: row.note,
    created_at: row.created_at,
    maskedAuthor: maskAuthorLabel(prof?.username ?? null, prof?.email ?? null),
  };
}

export async function getPublicReviews(
  restaurantId: string
): Promise<GetPublicReviewsResult> {
  const admin = getSupabaseAdmin();
  const { data: indexRows, error: indexError } = await admin
    .from('bite_notes')
    .select('id, redemption_id, created_at')
    .eq('restaurant_id', restaurantId)
    .eq('is_public', true)
    .order('created_at', { ascending: false });

  if (indexError) {
    return { ok: false, error: indexError.message };
  }

  const index = (indexRows ?? []) as {
    id: string;
    redemption_id: string;
    created_at: string;
  }[];
  if (index.length === 0) return { ok: true, data: [] };

  const { data: redemptionRows, error: redemptionError } = await admin
    .from('redemptions')
    .select('id, status, verified_at')
    .in('id', [...new Set(index.map((row) => row.redemption_id))]);

  if (redemptionError) {
    return { ok: false, error: redemptionError.message };
  }

  const verifiedIds = new Set(
    (redemptionRows ?? [])
      .filter((row) => redemptionIsVerified(row.status, row.verified_at))
      .map((row) => row.id),
  );
  const noteIds = index
    .filter((row) => verifiedIds.has(row.redemption_id))
    .slice(0, 20)
    .map((row) => row.id);
  if (noteIds.length === 0) return { ok: true, data: [] };

  const { data: rows, error } = await admin
    .from('bite_notes')
    .select(
      `
      id,
      rating,
      note,
      created_at,
      user_profiles ( username, email )
    `
    )
    .in('id', noteIds);

  if (error) {
    return { ok: false, error: error.message };
  }

  const byId = new Map(
    ((rows ?? []) as unknown as PublicNoteRow[]).map((row) => [row.id, row]),
  );
  const data = noteIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [toPublicReview(row)] : [];
  });

  return { ok: true, data };
}

export async function toggleNoteVisibility(
  noteId: string,
  isPublic: boolean
): Promise<ToggleNoteVisibilityResult> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  const admin = getSupabaseAdmin();
  const { data: row, error: selErr } = await admin
    .from('bite_notes')
    .select('id, user_id, redemption_id')
    .eq('id', noteId)
    .maybeSingle();

  if (selErr || !row) {
    return { ok: false, error: 'Note not found.' };
  }
  const n = row as { id: string; user_id: string; redemption_id: string };
  if (n.user_id !== auth.userId) {
    return { ok: false, error: 'You can only change visibility on your own notes.' };
  }

  if (isPublic) {
    const { data: redemption, error: redErr } = await admin
      .from('redemptions')
      .select('id, status, verified_at')
      .eq('id', n.redemption_id)
      .maybeSingle();
    if (redErr || !redemption) {
      return { ok: false, error: 'Redemption not found.' };
    }
    const redemptionRow = redemption as {
      status: string | null;
      verified_at: string | null;
    };
    if (!redemptionIsVerified(redemptionRow.status, redemptionRow.verified_at)) {
      return { ok: false, error: PUBLIC_REVIEW_REQUIRES_VERIFIED };
    }
  }

  const now = new Date().toISOString();
  const { error: updErr } = await admin
    .from('bite_notes')
    .update({ is_public: isPublic, updated_at: now })
    .eq('id', noteId)
    .eq('user_id', auth.userId);

  if (updErr) {
    return { ok: false, error: updErr.message };
  }
  return { ok: true };
}

export type GetBiteNotesResult =
  | { ok: true; data: BiteNoteRow[] }
  | { ok: false; error: string };

/** All bite notes for the user with restaurant name and address. */
export async function getBiteNotes(): Promise<GetBiteNotesResult> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  const admin = getSupabaseAdmin();
  const { data: rows, error } = await admin
    .from('bite_notes')
    .select(
      `
      id,
      redemption_id,
      restaurant_id,
      note,
      rating,
      is_public,
      created_at,
      updated_at,
      restaurants (
        name,
        address
      )
    `
    )
    .eq('user_id', auth.userId)
    .order('created_at', { ascending: false });

  if (error) {
    return { ok: false, error: error.message };
  }

  const data: BiteNoteRow[] = (rows ?? []).map((row: unknown) => {
    const x = row as {
      id: string;
      redemption_id: string;
      restaurant_id: string;
      note: string | null;
      rating: number;
      is_public: boolean | null;
      created_at: string;
      updated_at: string;
      restaurants:
        | { name: string; address: string | null }
        | { name: string; address: string | null }[]
        | null;
    };
    const rel = x.restaurants;
    const rest = Array.isArray(rel) ? rel[0] : rel;
    return {
      id: x.id,
      redemption_id: x.redemption_id,
      restaurant_id: x.restaurant_id,
      note: x.note,
      rating: x.rating,
      is_public: Boolean(x.is_public),
      created_at: x.created_at,
      updated_at: x.updated_at,
      restaurant: {
        name: rest?.name ?? 'Restaurant',
        address: rest?.address ?? null,
      },
    };
  });

  return { ok: true, data };
}
