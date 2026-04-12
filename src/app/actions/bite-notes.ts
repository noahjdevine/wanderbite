'use server';

import { getSupabaseAdmin } from '@/lib/supabase-admin';

/** Minimal fields for dashboard cards (keyed by redemption). */
export type BiteNoteSummary = {
  redemption_id: string;
  note: string | null;
  rating: number;
};

export type BiteNoteRow = {
  id: string;
  redemption_id: string;
  restaurant_id: string;
  note: string | null;
  rating: number;
  created_at: string;
  updated_at: string;
  restaurant: { name: string; address: string | null };
};

export type SaveBiteNoteResult = { ok: true } | { ok: false; error: string };

const NOTE_MAX = 280;

/**
 * Upserts the user's bite note for a redemption (one per redemption).
 * Verifies the redemption belongs to the user before writing.
 */
export async function saveBiteNote(
  redemptionId: string,
  userId: string,
  note: string,
  rating: number
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
      updated_at: now,
    },
    { onConflict: 'redemption_id' }
  );

  if (upsertErr) {
    return { ok: false, error: upsertErr.message };
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
