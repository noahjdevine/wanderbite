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
  /** Optional thumbnail URL; when null, a placeholder is shown. */
  image_url?: string | null;
};

export default async function RestaurantsPage() {
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

  /** Placeholder descriptions when DB has none (for layout preview). */
  const PLACEHOLDER_DESCRIPTIONS = [
    'Cozy spot known for handmade pasta and warm service.',
    'Hidden gem with a focus on seasonal, locally sourced dishes.',
    'Neighborhood favorite for brunch and creative cocktails.',
    'Upscale casual with a standout wine list and shareable plates.',
    'Family-run kitchen serving comfort food with a modern twist.',
    'Trendy eatery with rooftop seating and small plates.',
  ] as const;

  const restaurants: LocationRestaurant[] = (rows ?? []).map((r, i) => {
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
    const placeholderDesc = PLACEHOLDER_DESCRIPTIONS[i % PLACEHOLDER_DESCRIPTIONS.length];
    return {
      id: row.id,
      name: row.name,
      cuisine_tags: row.cuisine_tags,
      neighborhood: market?.name ?? null,
      description: placeholderDesc,
      price_range: null,
      address: row.address,
      lat: row.lat,
      lon: row.lon,
      image_url: null,
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
