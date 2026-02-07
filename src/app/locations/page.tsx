import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { LocationsClient } from '@/components/locations/locations-client';

export const dynamic = 'force-dynamic';

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
};

export default async function LocationsPage() {
  const supabase = getSupabaseAdmin();

  const { data: rows, error } = await supabase
    .from('restaurants')
    .select('id, name, cuisine_tags, address, lat, lon, market_id, markets(name)')
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
    const row = r as unknown as {
      id: string;
      name: string;
      cuisine_tags: string[] | null;
      address: string | null;
      lat: number | null;
      lon: number | null;
      markets: { name: string } | { name: string }[] | null;
    };
    const market = Array.isArray(row.markets) ? row.markets[0] : row.markets;
    return {
      id: row.id,
      name: row.name,
      cuisine_tags: row.cuisine_tags,
      neighborhood: market?.name ?? null,
      description: null,
      price_range: null,
      address: row.address,
      lat: row.lat,
      lon: row.lon,
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
