/** Public path for restaurant cards when no Google or manual image is set. */
export const RESTAURANT_IMAGE_PLACEHOLDER = '/images/restaurant-placeholder.jpg';

export type RestaurantImageFields = {
  id: string;
  google_place_id?: string | null;
  google_photo_url?: string | null;
  image_url?: string | null;
};

/** Builds the path for the server proxy that resolves a fresh Google photo by place id. */
export function restaurantImageProxyUrl(restaurantId: string): string {
  return `/api/restaurant-image/${restaurantId}`;
}

/**
 * Image src for restaurant cards.
 * Manual image_url wins; then proxy via google_place_id (fresh photo_reference each time);
 * legacy stored google_photo_url; else placeholder.
 */
export function restaurantDisplayImageUrl(row: RestaurantImageFields): string {
  const manual = row.image_url?.trim();
  if (manual) return manual;

  if (
    row.id &&
    (row.google_place_id?.trim() || row.google_photo_url?.trim())
  ) {
    return restaurantImageProxyUrl(row.id);
  }

  return RESTAURANT_IMAGE_PLACEHOLDER;
}
