import { RestaurantsDirectory } from '@/components/locations/locations-client';
import { requireLaunchMarketId } from '@/lib/launch-market-server';
import { mapDirectoryRestaurant, type DirectoryRestaurantRow } from '@/lib/restaurants/directory';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const revalidate = 1800;

/**
 * Restaurant directory. Signed-out and signed-in visitors both reach this
 * page: middleware treats /restaurants as public and does not redirect.
 * There is no subscription gate.
 */

const DIRECTORY_COLUMNS =
  'id, name, cuisine_tags, description, address, lat, lon, image_url, neighborhood, price_range';

export default async function RestaurantsPage() {
  const supabase = getSupabaseAdmin();
  const market = await requireLaunchMarketId(supabase);
  if (!market.ok) {
    console.error('[restaurants] launch market:', market.error);
    return <RestaurantsDirectory restaurants={[]} unavailable />;
  }

  const { data: rows, error } = await supabase
    .from('restaurants')
    .select(DIRECTORY_COLUMNS)
    .eq('status', 'active')
    .eq('market_id', market.marketId)
    .order('name');

  if (error) {
    console.error('[restaurants] directory query failed:', error.message);
    return <RestaurantsDirectory restaurants={[]} unavailable />;
  }

  const restaurants = ((rows ?? []) as DirectoryRestaurantRow[]).map(mapDirectoryRestaurant);
  return <RestaurantsDirectory restaurants={restaurants} />;
}
