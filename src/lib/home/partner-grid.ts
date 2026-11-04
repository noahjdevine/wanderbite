import {
  RESTAURANT_IMAGE_PLACEHOLDER,
  restaurantDisplayImageUrl,
} from '@/lib/restaurant-image';
import type { DirectoryRestaurant } from '@/lib/restaurants/directory';

/** Homepage partner grid. Fewer photos show as-is; the section hides at zero. */
export const PARTNER_PHOTO_CAP = 8;

/**
 * A tile needs a photo other than the local placeholder. A safe manual
 * `image_url` wins, including when that path is the placeholder itself.
 * Otherwise a trimmed `google_place_id` counts, because `RestaurantPhoto`
 * loads it through `/api/restaurant-image/[id]`.
 */
export function restaurantHasPartnerPhoto(restaurant: DirectoryRestaurant): boolean {
  return restaurantDisplayImageUrl(restaurant) !== RESTAURANT_IMAGE_PLACEHOLDER;
}

export function selectPartnerPhotos(
  restaurants: readonly DirectoryRestaurant[],
  cap = PARTNER_PHOTO_CAP,
): DirectoryRestaurant[] {
  return restaurants.filter(restaurantHasPartnerPhoto).slice(0, cap);
}
