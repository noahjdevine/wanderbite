'use server';

import { createClient } from '@/lib/supabase/server';

const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? '';

export type SendPasswordResetResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Sends a password reset email via Supabase Auth.
 * User will receive a link to /reset-password to set a new password.
 */
export async function sendPasswordResetEmail(
  email: string
): Promise<SendPasswordResetResult> {
  const trimmed = email?.trim();
  if (!trimmed) {
    return { ok: false, error: 'Please enter your email address.' };
  }
  if (!baseUrl) {
    return { ok: false, error: 'NEXT_PUBLIC_BASE_URL is not set.' };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: `${baseUrl}/reset-password`,
    });
    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to send reset email.';
    return { ok: false, error: message };
  }
}

export type DeleteAccountResult = { ok: true } | { ok: false; error: string };

/**
 * Permanently deletes the current user's account using Supabase Admin (service role).
 * Must be called from the server; the authenticated user is identified by the session.
 */
export async function deleteAccount(): Promise<DeleteAccountResult> {
  const { createClient } = await import('@/lib/supabase/server');
  const { getSupabaseAdmin } = await import('@/lib/supabase-admin');

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { ok: false, error: 'You must be signed in to delete your account.' };
    }

    const admin = getSupabaseAdmin();
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);

    if (deleteError) {
      return { ok: false, error: deleteError.message };
    }
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to delete account.';
    return { ok: false, error: message };
  }
}
