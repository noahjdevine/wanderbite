import { RestaurantPhoto } from '@/components/restaurants/restaurant-photo';
import { selectPartnerPhotos } from '@/lib/home/partner-grid';
import type { DirectoryRestaurant } from '@/lib/restaurants/directory';

type PartnerPhotoGridProps = {
  restaurants: readonly DirectoryRestaurant[];
};

export function PartnerPhotoGrid({ restaurants }: PartnerPhotoGridProps) {
  const tiles = selectPartnerPhotos(restaurants);
  if (tiles.length === 0) return null;

  return (
    <section aria-labelledby="partner-grid-heading" data-partner-grid="">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2
          id="partner-grid-heading"
          className="font-display m-0 text-[36px] leading-none text-wb-ink md:text-[48px]"
        >
          Partner spots
        </h2>
        <a href="/restaurants" className="text-sm font-semibold text-wb-plum">
          See all restaurants
        </a>
      </div>
      <ul className="mt-8 grid list-none grid-cols-2 gap-3 p-0 md:grid-cols-3 lg:grid-cols-4">
        {tiles.map((restaurant) => (
          <li key={restaurant.id}>
            <div className="relative aspect-[4/3] overflow-hidden rounded-[16px] bg-wb-line">
              <div className="absolute inset-0">
                <RestaurantPhoto
                  restaurantId={restaurant.id}
                  imageUrl={restaurant.image_url}
                  googlePlaceId={restaurant.google_place_id}
                  className="h-full w-full object-cover"
                />
              </div>
              <a
                href="/restaurants"
                data-partner-tile=""
                aria-label={`${restaurant.name}. Partner restaurants`}
                className="absolute inset-x-0 top-0 bottom-8 z-[1] bg-gradient-to-b from-wb-night/70 to-transparent px-3 pt-3 text-white no-underline"
              >
                <span className="font-display line-clamp-2 text-[22px] leading-none">{restaurant.name}</span>
              </a>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
