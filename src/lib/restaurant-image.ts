/** Public path for restaurant cards when no Google or manual image is set. */
export const RESTAURANT_IMAGE_PLACEHOLDER = '/images/restaurant-placeholder.jpg';

export function restaurantDisplayImageUrl(row: {
  google_photo_url?: string | null;
  image_url?: string | null;
}): string {
  const g = row.google_photo_url?.trim();
  if (g) return g;
  const u = row.image_url?.trim();
  if (u) return u;
  return RESTAURANT_IMAGE_PLACEHOLDER;
}
