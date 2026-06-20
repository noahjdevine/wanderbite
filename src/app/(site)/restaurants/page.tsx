import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { unwrapJoin } from '@/lib/supabase/unwrap-join';
import { LocationsClient } from '@/components/locations/locations-client';

export const revalidate = 1800;

/** Restaurants list: accessible to all logged-in users (including active/trial subscribers). No subscription gate. */

export type LocationRestaurant = {
  id: string;
  name: string;
  cuisine_tags: string[] | null;
  neighborhood: string | null;
  description: string | null;
  price_range: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  /** Optional thumbnail URL; when null, a placeholder is shown. */
  image_url?: string | null;
  google_photo_url?: string | null;
  google_place_id?: string | null;
};

export default async function RestaurantsPage() {
  const supabase = getSupabaseAdmin();

  const { data: rows, error } = await supabase
    .from('restaurants')
    .select(
      'id, name, cuisine_tags, description, address, lat, lon, market_id, image_url, google_photo_url, google_place_id, markets(name)'
    )
    .eq('status', 'active')
    .order('name');

  if (error) {
    return (
      <main className="min-h-screen bg-background px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <p className="text-destructive">Failed to load restaurants: {error.message}</p>
        </div>
      </main>
    );
  }

  const restaurants: LocationRestaurant[] = (rows ?? []).map((r) => {
    const row = r as {
      id: string;
      name: string;
      cuisine_tags: string[] | null;
      description: string | null;
      address: string | null;
      lat: number | null;
      lon: number | null;
      image_url: string | null;
      google_photo_url: string | null;
      google_place_id: string | null;
      markets: { name: string } | { name: string }[] | null;
    };
    const market = unwrapJoin(row.markets);
    return {
      id: row.id,
      name: row.name,
      cuisine_tags: row.cuisine_tags,
      neighborhood: market?.name ?? null,
      description: row.description?.trim() || null,
      price_range: null,
      address: row.address,
      lat: row.lat,
      lon: row.lon,
      image_url: row.image_url ?? null,
      google_photo_url: row.google_photo_url ?? null,
      google_place_id: row.google_place_id ?? null,
    };
  });

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <LocationsClient restaurants={restaurants} />
      </div>
    </main>
  );
}
