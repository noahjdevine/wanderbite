'use server';

import { getSupabaseAdmin } from '@/lib/supabase-admin';

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

const NOTE_MAX = 280;

/**
 * Upserts the user's bite note for a redemption (one per redemption).
 * Verifies the redemption belongs to the user before writing.
 */
function maskAuthorLabel(username: string | null, email: string | null): string {
  const base =
    (username && username.trim()) ||
    (email && email.split('@')[0]?.trim()) ||
    'Wa';
  const s = base.length >= 2 ? base.slice(0, 2) : `${base}*`.slice(0, 2);
  return `${s}***`;
}

export async function saveBiteNote(
  redemptionId: string,
  userId: string,
  note: string,
  rating: number,
  isPublic?: boolean
): Promise<SaveBiteNoteResult> {
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
    .select('id, user_id, restaurant_id')
    .eq('id', redemptionId)
    .maybeSingle();

  if (redErr || !redemption) {
    return { ok: false, error: 'Redemption not found.' };
  }
  const r = redemption as { id: string; user_id: string; restaurant_id: string };
  if (r.user_id !== userId) {
    return { ok: false, error: 'You can only add notes to your own visits.' };
  }

  const now = new Date().toISOString();
  const { error: upsertErr } = await admin.from('bite_notes').upsert(
    {
      user_id: userId,
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

export async function getPublicReviews(
  restaurantId: string
): Promise<GetPublicReviewsResult> {
  const admin = getSupabaseAdmin();
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
    .eq('restaurant_id', restaurantId)
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    return { ok: false, error: error.message };
  }

  const data: PublicReview[] = (rows ?? []).map((row: unknown) => {
    const x = row as {
      id: string;
      rating: number;
      note: string | null;
      created_at: string;
      user_profiles:
        | { username: string | null; email: string | null }
        | { username: string | null; email: string | null }[]
        | null;
    };
    const rel = x.user_profiles;
    const prof = Array.isArray(rel) ? rel[0] : rel;
    return {
      id: x.id,
      rating: x.rating,
      note: x.note,
      created_at: x.created_at,
      maskedAuthor: maskAuthorLabel(
        prof?.username ?? null,
        prof?.email ?? null
      ),
    };
  });

  return { ok: true, data };
}

export async function toggleNoteVisibility(
  noteId: string,
  userId: string,
  isPublic: boolean
): Promise<ToggleNoteVisibilityResult> {
  const admin = getSupabaseAdmin();
  const { data: row, error: selErr } = await admin
    .from('bite_notes')
    .select('id, user_id')
    .eq('id', noteId)
    .maybeSingle();

  if (selErr || !row) {
    return { ok: false, error: 'Note not found.' };
  }
  const n = row as { id: string; user_id: string };
  if (n.user_id !== userId) {
    return { ok: false, error: 'You can only change visibility on your own notes.' };
  }

  const now = new Date().toISOString();
  const { error: updErr } = await admin
    .from('bite_notes')
    .update({ is_public: isPublic, updated_at: now })
    .eq('id', noteId)
    .eq('user_id', userId);

  if (updErr) {
    return { ok: false, error: updErr.message };
  }
  return { ok: true };
}

export type GetBiteNotesResult =
  | { ok: true; data: BiteNoteRow[] }
  | { ok: false; error: string };

/** All bite notes for the user with restaurant name and address. */
export async function getBiteNotes(userId: string): Promise<GetBiteNotesResult> {
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
    .eq('user_id', userId)
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
