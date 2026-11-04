import { RestaurantsDirectory } from '@/components/locations/locations-client';
import { loadPublicDirectory } from '@/lib/restaurants/load-directory';

export const revalidate = 1800;

/**
 * Restaurant directory. Signed-out and signed-in visitors both reach this
 * page: middleware treats /restaurants as public and does not redirect.
 * There is no subscription gate.
 */
export default async function RestaurantsPage() {
  const result = await loadPublicDirectory();
  if (!result.ok) {
    console.error('[restaurants]', result.error);
    return <RestaurantsDirectory restaurants={[]} unavailable />;
  }

  return <RestaurantsDirectory restaurants={result.restaurants} />;
}
