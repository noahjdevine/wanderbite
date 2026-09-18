import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { LAUNCH_MARKET } from '@/lib/launch-market';
import type { Database } from '@/types/database.types';

const MARKET_UNAVAILABLE = 'Launch market is not configured.';

export async function requireLaunchMarketId(
  admin: SupabaseClient<Database>
): Promise<{ ok: true; marketId: string } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from('markets')
    .select('id')
    .eq('slug', LAUNCH_MARKET.slug)
    .eq('status', 'active')
    .limit(2);

  if (error) {
    return { ok: false, error: error.message };
  }
  const rows = (data ?? []) as { id: string }[];
  if (rows.length !== 1) {
    return { ok: false, error: MARKET_UNAVAILABLE };
  }
  return { ok: true, marketId: rows[0].id };
}
