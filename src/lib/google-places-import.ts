export type PlaceDetails = {
  name: string;
  address: string;
  neighborhood: string | null;
  lat: number | null;
  lon: number | null;
  phoneNumber: string | null;
  website: string | null;
  priceLevel: string | null;
  cuisineTags: string[];
  photoUrl: string | null;
  googlePlaceId: string;
  rating: number | null;
};

export type ImportCityOption = {
  id: string;
  label: string;
  /** Used in Text Search query: "{query} restaurant {cityQuery}" */
  cityQuery: string;
  lat: number;
  lng: number;
};

/** Cities for admin import dropdown; bias circle matches each market. */
export const GOOGLE_IMPORT_CITIES: ImportCityOption[] = [
  {
    id: 'mckinney',
    label: 'McKinney, TX',
    cityQuery: 'McKinney TX',
    lat: 33.1984,
    lng: -96.6397,
  },
  {
    id: 'dallas',
    label: 'Dallas, TX',
    cityQuery: 'Dallas TX',
    lat: 32.7767,
    lng: -96.797,
  },
  {
    id: 'austin',
    label: 'Austin, TX',
    cityQuery: 'Austin TX',
    lat: 30.2672,
    lng: -97.7431,
  },
];

const DEFAULT_CENTER = { lat: 33.1984, lng: -96.6397 };
const DEFAULT_CITY = 'McKinney TX';

const GOOGLE_TYPE_TO_CUISINE: Record<string, string> = {
  pizza_restaurant: 'pizza',
  mexican_restaurant: 'mexican',
  american_restaurant: 'american',
  italian_restaurant: 'italian',
  japanese_restaurant: 'japanese',
  chinese_restaurant: 'chinese',
  thai_restaurant: 'thai',
  indian_restaurant: 'indian',
  mediterranean_restaurant: 'mediterranean',
  seafood_restaurant: 'seafood',
  steak_house: 'steakhouse',
  barbecue_restaurant: 'bbq',
  bar: 'bar',
  cafe: 'cafe',
  bakery: 'bakery',
  fine_dining_restaurant: 'fine-dining',
  fast_food_restaurant: 'fast-food',
};

const IGNORED_TYPES = new Set([
  'establishment',
  'point_of_interest',
  'food',
  'restaurant',
  'meal_takeaway',
  'meal_delivery',
]);

function mapPriceLevel(level: number | undefined | null): string | null {
  if (level == null || Number.isNaN(level)) return null;
  const n = Math.round(Number(level));
  if (n <= 1) return '$';
  if (n === 2) return '$$';
  if (n === 3) return '$$$';
  if (n >= 4) return '$$$$';
  return '$';
}

function cuisineTagsFromTypes(types: string[] | undefined): string[] {
  if (!types?.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of types) {
    if (!t || IGNORED_TYPES.has(t)) continue;
    const mapped = GOOGLE_TYPE_TO_CUISINE[t];
    if (mapped && !seen.has(mapped)) {
      seen.add(mapped);
      out.push(mapped);
    }
  }
  return out;
}

function neighborhoodFromComponents(
  components: { long_name?: string; types?: string[] }[] | undefined
): string | null {
  if (!components?.length) return null;
  for (const c of components) {
    const types = c.types ?? [];
    if (
      types.includes('neighborhood') ||
      types.includes('sublocality') ||
      types.includes('sublocality_level_1')
    ) {
      const name = c.long_name?.trim();
      if (name) return name;
    }
  }
  return null;
}

/**
 * Text Search (Legacy). Never throws; returns [] on missing key or failure.
 */
export async function searchPlaces(
  query: string,
  city: string = DEFAULT_CITY,
  center: { lat: number; lng: number } = DEFAULT_CENTER
): Promise<{ placeId: string; name: string; address: string }[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!key) return [];

  const q = query.trim();
  if (!q) return [];

  const fullQuery = `${q} restaurant ${city}`.trim();

  try {
    const params = new URLSearchParams({
      query: fullQuery,
      /** Biases results to ~50km around the selected city (legacy Text Search API). */
      location: `${center.lat},${center.lng}`,
      radius: '50000',
      key,
    });
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?${params.toString()}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return [];

    const data = (await res.json()) as {
      status?: string;
      results?: {
        place_id?: string;
        name?: string;
        formatted_address?: string;
      }[];
    };

    if (data.status !== 'OK' || !data.results?.length) {
      return [];
    }

    return data.results
      .filter((r) => r.place_id && r.name)
      .slice(0, 5)
      .map((r) => ({
        placeId: r.place_id as string,
        name: r.name as string,
        address: (r.formatted_address ?? '').trim() || '—',
      }));
  } catch {
    return [];
  }
}

/**
 * Place Details (Legacy). Returns null on failure; never throws.
 */
export async function getPlaceDetails(
  placeId: string
): Promise<PlaceDetails | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!key || !placeId.trim()) return null;

  const fields =
    'name,formatted_address,geometry,formatted_phone_number,website,price_level,types,photos,rating,address_components';

  try {
    const params = new URLSearchParams({
      place_id: placeId.trim(),
      fields,
      key,
    });
    const url = `https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      status?: string;
      result?: {
        name?: string;
        formatted_address?: string;
        geometry?: { location?: { lat?: number; lng?: number } };
        formatted_phone_number?: string;
        website?: string;
        price_level?: number;
        types?: string[];
        photos?: { photo_reference?: string }[];
        rating?: number;
        address_components?: { long_name?: string; types?: string[] }[];
      };
    };

    if (data.status !== 'OK' || !data.result) return null;

    const r = data.result;
    const name = (r.name ?? '').trim();
    if (!name) return null;

    const lat = r.geometry?.location?.lat ?? null;
    const lon = r.geometry?.location?.lng ?? null;
    const ref = r.photos?.[0]?.photo_reference;
    let photoUrl: string | null = null;
    if (ref) {
      const photoParams = new URLSearchParams({
        maxwidth: '800',
        photo_reference: ref,
        key,
      });
      photoUrl = `https://maps.googleapis.com/maps/api/place/photo?${photoParams.toString()}`;
    }

    return {
      name,
      address: (r.formatted_address ?? '').trim() || '',
      neighborhood: neighborhoodFromComponents(r.address_components),
      lat,
      lon,
      phoneNumber: r.formatted_phone_number?.trim() ?? null,
      website: r.website?.trim() ?? null,
      priceLevel: mapPriceLevel(r.price_level),
      cuisineTags: cuisineTagsFromTypes(r.types),
      photoUrl,
      googlePlaceId: placeId.trim(),
      rating: typeof r.rating === 'number' && !Number.isNaN(r.rating) ? r.rating : null,
    };
  } catch {
    return null;
  }
}
