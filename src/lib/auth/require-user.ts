import 'server-only';

import { createClient } from '@/lib/supabase/server';

export type RequireUserResult =
  | { ok: true; userId: string; email: string | null }
  | { ok: false; error: string };

/**
 * Reads the current Supabase session and returns the authenticated user.
 * Use at the top of every Server Action that needs to act on user-specific data.
 * Never trust a `userId` argument passed from the client.
 */
export async function requireUser(): Promise<RequireUserResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'You must be signed in.' };
  }

  return { ok: true, userId: user.id, email: user.email ?? null };
}
