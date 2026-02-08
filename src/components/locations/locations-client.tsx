'use client';

import { useMemo, useState } from 'react';
import { MapPin, UtensilsCrossed } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { LocationRestaurant } from '@/app/restaurants/page';

type LocationsClientProps = {
  restaurants: LocationRestaurant[];
};

function buildMapsUrl(restaurant: LocationRestaurant): string | null {
  if (restaurant.address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(restaurant.address)}`;
  }
  if (restaurant.lat != null && restaurant.lon != null) {
    return `https://www.google.com/maps/search/?api=1&query=${restaurant.lat},${restaurant.lon}`;
  }
  return null;
}

const PLACEHOLDER_FOOD_IMAGE = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800&q=80';

function RestaurantCard({ restaurant }: { restaurant: LocationRestaurant }) {
  const mapsUrl = buildMapsUrl(restaurant);
  const tags = [
    ...(restaurant.cuisine_tags ?? []),
    ...(restaurant.neighborhood ? [restaurant.neighborhood] : []),
  ];
  const description = restaurant.description ?? restaurant.address ?? null;
  const [thumbSrc, setThumbSrc] = useState(restaurant.image_url ?? PLACEHOLDER_FOOD_IMAGE);

  return (
    <Card className="flex h-full flex-col overflow-hidden p-0">
      {/* Thumbnail: image or generic food placeholder (fallback when missing or on load error) */}
      <div className="relative aspect-[16/10] w-full shrink-0 bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumbSrc}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setThumbSrc(PLACEHOLDER_FOOD_IMAGE)}
        />
      </div>
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2 pt-4">
        <div className="min-w-0 flex-1">
          <h3 className="font-bold leading-tight">{restaurant.name}</h3>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {tags.length > 0 ? (
              tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))
            ) : null}
          </div>
        </div>
        {mapsUrl && (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            asChild
          >
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Get directions"
            >
              <MapPin className="size-4" />
            </a>
          </Button>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        {description && (
          <p className="text-sm text-muted-foreground line-clamp-3">
            {description}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function LocationsClient({ restaurants }: LocationsClientProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return restaurants;
    return restaurants.filter((r) => {
      const name = r.name.toLowerCase();
      const neighborhood = (r.neighborhood ?? '').toLowerCase();
      const cuisines = (r.cuisine_tags ?? []).join(' ').toLowerCase();
      const address = (r.address ?? '').toLowerCase();
      return (
        name.includes(q) ||
        neighborhood.includes(q) ||
        cuisines.includes(q) ||
        address.includes(q)
      );
    });
  }, [restaurants, search]);

  return (
    <>
      <header className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight">Our Curated Collection</h1>
        <p className="mt-2 text-muted-foreground">
          Partner restaurants where you can use your Wanderbite offers.
        </p>
        <div className="mt-6">
          <input
            type="search"
            placeholder="Search by name, cuisine, or neighborhood…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-md rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label="Search restaurants"
          />
        </div>
      </header>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.length === 0 ? (
          <p className="col-span-full text-center text-muted-foreground">
            No restaurants match your search.
          </p>
        ) : (
          filtered.map((restaurant) => (
            <RestaurantCard key={restaurant.id} restaurant={restaurant} />
          ))
        )}
      </div>
    </>
  );
}
