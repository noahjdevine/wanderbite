'use server';

import { headers } from 'next/headers';
import { captureEvent } from '@/lib/posthog-server';
import { createClient } from '@/lib/supabase/server';
import { allowPasswordReset } from '@/lib/ratelimit';
import { trustedClientIpFromHeaders } from '@/lib/client-ip';
import { hashClientIp, hashResetEmail, hasIpHashSecret } from '@/lib/ai-ip-hash';
import {
  isPasswordResetDisabled,
  parseResetEmail,
  passwordResetRecoveryUrl,
  PASSWORD_RESET_UNAVAILABLE_MESSAGE,
  PASSWORD_RESET_VALIDATION_MESSAGE,
} from '@/lib/password-reset';

export type SendPasswordResetResult =
  | { ok: true }
  | { ok: false; error: string };

/** Fired when email confirmation completes and the user lands with a session. */
export async function trackSignupCompleted(userId: string): Promise<void> {
  await captureEvent(userId, 'signup_completed');
}

function unavailable(): SendPasswordResetResult {
  return { ok: false, error: PASSWORD_RESET_UNAVAILABLE_MESSAGE };
}

function logResetOps(event: string): void {
  console.warn(`[password-reset] ${event}`);
}

function supabasePublicConfigReady(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim(),
  );
}

/**
 * Three-state password reset request.
 * Validation and Unavailable never call Auth. After Auth is invoked, always
 * generic success — including `{ error }` and throw — so accounts cannot be enumerated.
 */
export async function sendPasswordResetEmail(
  email: string,
): Promise<SendPasswordResetResult> {
  const normalized = parseResetEmail(email);
  if (!normalized) {
    return { ok: false, error: PASSWORD_RESET_VALIDATION_MESSAGE };
  }

  if (isPasswordResetDisabled()) {
    logResetOps('unavailable_kill_switch');
    return unavailable();
  }

  const recoveryUrl = passwordResetRecoveryUrl();
  if (!recoveryUrl) {
    logResetOps('unavailable_recovery_url');
    return unavailable();
  }

  if (!hasIpHashSecret()) {
    logResetOps('unavailable_ip_hash_secret');
    return unavailable();
  }

  if (!supabasePublicConfigReady()) {
    logResetOps('unavailable_supabase_config');
    return unavailable();
  }

  let ip: string | null = null;
  try {
    ip = trustedClientIpFromHeaders(await headers());
  } catch {
    logResetOps('unavailable_headers');
    return unavailable();
  }
  if (!ip) {
    logResetOps('unavailable_client_ip');
    return unavailable();
  }

  const emailDigest = hashResetEmail(normalized);
  const ipDigest = hashClientIp(ip);
  if (!emailDigest || !ipDigest) {
    logResetOps('unavailable_digest');
    return unavailable();
  }

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    logResetOps('unavailable_client');
    return unavailable();
  }

  const allowed = await allowPasswordReset(emailDigest, ipDigest);
  if (!allowed) {
    logResetOps('unavailable_limiter');
    return unavailable();
  }

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(normalized, {
      redirectTo: recoveryUrl,
    });
    if (error) {
      logResetOps('provider_error');
    }
  } catch {
    logResetOps('provider_throw');
  }

  return { ok: true };
}

export type DeleteAccountResult = { ok: true } | { ok: false; error: string };

/**
 * Permanently deletes the current user's account using Supabase Admin (service role).
 * Must be called from the server; the authenticated user is identified by the session.
 */
export async function deleteAccount(): Promise<DeleteAccountResult> {
  const { createClient: createUserClient } = await import('@/lib/supabase/server');
  const { getSupabaseAdmin } = await import('@/lib/supabase-admin');

  try {
    const supabase = await createUserClient();
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
