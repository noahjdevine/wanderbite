'use server';

import { captureEvent } from '@/lib/posthog-server';
import { createClient } from '@/lib/supabase/server';
import { passwordResetLimiter } from '@/lib/ratelimit';

const baseUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
  process.env.NEXT_PUBLIC_BASE_URL?.trim() ||
  '';

export type SendPasswordResetResult =
  | { ok: true }
  | { ok: false; error: string };

/** Fired when email confirmation completes and the user lands with a session. */
export async function trackSignupCompleted(userId: string): Promise<void> {
  await captureEvent(userId, 'signup_completed');
}

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
    return { ok: false, error: 'NEXT_PUBLIC_SITE_URL or NEXT_PUBLIC_BASE_URL is not set.' };
  }

  if (passwordResetLimiter) {
    const { success } = await passwordResetLimiter.limit(trimmed);
    if (!success) {
      return {
        ok: false,
        error: 'Too many attempts. Please try again later.',
      };
    }
  }

  try {
    const supabase = await createClient();
    // Recovery emails use redirectTo pointing at /auth/recovery (no query params —
    // survives Supabase redirect URL allow-list matching).
    const recoveryUrl = `${baseUrl.replace(/\/$/, '')}/auth/recovery`;
    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: recoveryUrl,
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
