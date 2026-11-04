import 'server-only';

import { requireLaunchMarketId } from '@/lib/launch-market-server';
import {
  mapDirectoryRestaurant,
  PUBLIC_DIRECTORY_COLUMNS,
  type DirectoryRestaurant,
  type DirectoryRestaurantRow,
} from '@/lib/restaurants/directory';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export type PublicDirectoryResult =
  | { ok: true; restaurants: DirectoryRestaurant[] }
  | { ok: false; error: string };

/**
 * Active restaurants in the launch market. Same read as `/restaurants`:
 * the service role on the server, not the signed-out browser client.
 * A missing env var or a failed query returns `ok: false` and no rows.
 */
export async function loadPublicDirectory(): Promise<PublicDirectoryResult> {
  try {
    const supabase = getSupabaseAdmin();
    const market = await requireLaunchMarketId(supabase);
    if (!market.ok) return { ok: false, error: market.error };

    const { data, error } = await supabase
      .from('restaurants')
      .select(PUBLIC_DIRECTORY_COLUMNS)
      .eq('status', 'active')
      .eq('market_id', market.marketId)
      .order('name');

    if (error) return { ok: false, error: error.message };
    const restaurants = ((data ?? []) as DirectoryRestaurantRow[]).map(mapDirectoryRestaurant);
    return { ok: true, restaurants };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'directory unavailable';
    return { ok: false, error: message };
  }
}
