import { safeManualImagePath } from '@/lib/restaurant-image';

export type DirectoryRestaurant = {
  id: string;
  name: string;
  cuisine_tags: string[];
  neighborhood: string | null;
  description: string | null;
  price_range: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  /** Safe `/images/` path. Null falls through to the place photo, then the placeholder. */
  image_url: string | null;
  /** Trimmed `restaurants.google_place_id` (migration 009). Blank is null. */
  google_place_id: string | null;
};

export type DirectoryRestaurantRow = {
  id: string;
  name: string;
  cuisine_tags: string[] | null;
  neighborhood: string | null;
  description: string | null;
  price_range: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  image_url: string | null;
  google_place_id: string | null;
};

function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed || null;
}

/**
 * Directory card fields. Neighborhood is `restaurants.neighborhood` only.
 * A blank value stays blank. The market name is never a stand-in.
 */
export function mapDirectoryRestaurant(row: DirectoryRestaurantRow): DirectoryRestaurant {
  const cuisine = (row.cuisine_tags ?? []).flatMap((tag) => {
    const trimmed = tag.trim();
    return trimmed ? [trimmed] : [];
  });
  return {
    id: row.id,
    name: row.name,
    cuisine_tags: cuisine,
    neighborhood: trimmedOrNull(row.neighborhood),
    description: trimmedOrNull(row.description),
    price_range: trimmedOrNull(row.price_range),
    address: trimmedOrNull(row.address),
    lat: row.lat,
    lon: row.lon,
    image_url: safeManualImagePath(row.image_url),
    google_place_id: trimmedOrNull(row.google_place_id),
  };
}
