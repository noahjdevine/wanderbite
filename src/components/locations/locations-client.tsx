'use client';

import { useMemo, useState } from 'react';
import { MapPin } from 'lucide-react';
import { RestaurantPhoto } from '@/components/restaurants/restaurant-photo';
import { ChallengeTicket } from '@/components/wb/challenge-ticket';
import { Chip } from '@/components/wb/chip';
import { CtaButton } from '@/components/wb/cta-button';
import { PillLabel } from '@/components/wb/pill-label';
import { StatTile } from '@/components/wb/stat-tile';
import { pluralNoun } from '@/lib/format/text';
import { LAUNCH_MARKET } from '@/lib/launch-market';
import type { DirectoryRestaurant } from '@/lib/restaurants/directory';

/** Same fixed frame on every card. A portrait photo cannot change the height. */
export const DIRECTORY_PHOTO_HEIGHT = 180;

export const RESTAURANTS_UNAVAILABLE_MESSAGE = 'Restaurants temporarily unavailable';
export const RESTAURANTS_EMPTY_MESSAGE = 'No partner restaurants are listed right now.';
export const RESTAURANTS_SEARCH_EMPTY = 'No restaurants match your search.';
export const RESTAURANTS_RETRY_HREF = '/restaurants';

type RestaurantsDirectoryProps = {
  restaurants: DirectoryRestaurant[];
  /** Query or launch-market read failed. The raw error stays off the page. */
  unavailable?: boolean;
};

function mapsUrl(restaurant: DirectoryRestaurant): string | null {
  if (restaurant.address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(restaurant.address)}`;
  }
  if (restaurant.lat != null && restaurant.lon != null) {
    return `https://www.google.com/maps/search/?api=1&query=${restaurant.lat},${restaurant.lon}`;
  }
  return null;
}

function DirectoryTicket({ restaurant }: { restaurant: DirectoryRestaurant }) {
  const neighborhood = restaurant.neighborhood?.trim() || null;
  const description = restaurant.description?.trim() || null;
  const price = restaurant.price_range?.trim() || null;
  const cuisines = restaurant.cuisine_tags.filter((tag) => tag.trim());
  const directions = mapsUrl(restaurant);

  return (
    <ChallengeTicket
      name={restaurant.name}
      area={neighborhood ?? ''}
      photo={
        <RestaurantPhoto
          restaurantId={restaurant.id}
          imageUrl={restaurant.image_url}
          className="h-full w-full object-cover"
        />
      }
      photoHeight={DIRECTORY_PHOTO_HEIGHT}
    >
      {cuisines.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" data-cuisine-row="">
          {cuisines.map((tag, index) => (
            <Chip key={`${tag}-${index}`} variant="tinted">
              {tag}
            </Chip>
          ))}
        </div>
      ) : null}
      {price ? (
        <p className="m-0 text-sm font-semibold text-wb-ink" data-price="">
          <span className="sr-only">Price range </span>
          {price}
        </p>
      ) : null}
      {description ? (
        <p className="m-0 line-clamp-2 text-sm text-wb-muted" data-reason="">
          {description}
        </p>
      ) : null}
      {directions ? (
        <a
          href={directions}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-wb-plum"
        >
          <MapPin className="size-4" aria-hidden="true" />
          Directions
        </a>
      ) : null}
    </ChallengeTicket>
  );
}

function RestaurantBrowser({ restaurants }: { restaurants: DirectoryRestaurant[] }) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return restaurants;
    return restaurants.filter((restaurant) => {
      const name = restaurant.name.toLowerCase();
      const neighborhood = (restaurant.neighborhood ?? '').toLowerCase();
      const cuisines = restaurant.cuisine_tags.join(' ').toLowerCase();
      const address = (restaurant.address ?? '').toLowerCase();
      return (
        name.includes(query) ||
        neighborhood.includes(query) ||
        cuisines.includes(query) ||
        address.includes(query)
      );
    });
  }, [restaurants, search]);

  return (
    <>
      <div className="max-w-md">
        <label htmlFor="restaurant-search" className="sr-only">
          Search restaurants
        </label>
        <input
          id="restaurant-search"
          type="search"
          placeholder="Search by name, cuisine, or neighborhood…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="min-h-11 w-full rounded-full border border-wb-line bg-white px-4 text-sm text-wb-ink placeholder:text-wb-muted"
          aria-label="Search restaurants"
        />
      </div>
      {filtered.length === 0 ? (
        <p className="m-0 text-center text-sm text-wb-muted">{RESTAURANTS_SEARCH_EMPTY}</p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((restaurant) => (
            <DirectoryTicket key={restaurant.id} restaurant={restaurant} />
          ))}
        </div>
      )}
    </>
  );
}

export function RestaurantsDirectory({ restaurants, unavailable = false }: RestaurantsDirectoryProps) {
  return (
    <main>
      <header className="wb-dark relative overflow-hidden">
        <div
          aria-hidden="true"
          className="wb-aurora pointer-events-none absolute -left-24 -top-20 h-80 w-80 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.55) 0%, rgba(139,92,246,0) 70%)' }}
        />
        <div
          aria-hidden="true"
          className="wb-aurora-2 pointer-events-none absolute -right-28 top-8 h-80 w-80 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(251,113,133,0.42) 0%, rgba(251,113,133,0) 70%)' }}
        />
        <div className="relative mx-auto flex max-w-5xl flex-col gap-3 px-5 pt-4 pb-16 sm:px-8 sm:pt-8">
          <PillLabel>{LAUNCH_MARKET.displayName}</PillLabel>
          <h1 className="wb-display m-0 text-[42px] text-white sm:text-[56px]">
            Partner <em>restaurants</em>
          </h1>
          {unavailable ? null : (
            <div className="mt-1 grid max-w-xs grid-cols-1" data-partner-count={restaurants.length}>
              <StatTile
                value={String(restaurants.length)}
                label={pluralNoun(restaurants.length, 'partner spot')}
              />
            </div>
          )}
        </div>
      </header>
      <div className="wb-sheet">
        <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 pt-6 pb-16 sm:px-8">
          {unavailable ? (
            <div className="flex flex-col items-start gap-3" data-directory-error="">
              <p className="m-0 text-base text-wb-ink" role="alert">
                {RESTAURANTS_UNAVAILABLE_MESSAGE}
              </p>
              <CtaButton href={RESTAURANTS_RETRY_HREF}>Retry</CtaButton>
            </div>
          ) : restaurants.length === 0 ? (
            <p className="m-0 text-base text-wb-ink" data-directory-empty="">
              {RESTAURANTS_EMPTY_MESSAGE}
            </p>
          ) : (
            <RestaurantBrowser restaurants={restaurants} />
          )}
        </div>
      </div>
    </main>
  );
}
