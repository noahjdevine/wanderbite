import { createClient } from '@supabase/supabase-js';

/**
 * Server-only Supabase client with service role.
 * Use only in Server Actions / API routes / server components for admin operations
 * (e.g. assignment, inserting challenge_cycles/challenge_items).
 */
export function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, key);
}
