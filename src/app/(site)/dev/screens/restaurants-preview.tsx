import { RestaurantsDirectory } from '@/components/locations/locations-client';
import type { DirectoryRestaurant } from '@/lib/restaurants/directory';

const SAMPLE: DirectoryRestaurant[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'North Grill',
    cuisine_tags: ['Pizza'],
    neighborhood: null,
    description: 'Wood-fired plates and a long table.',
    price_range: '$$',
    address: '1 E Louisiana St, McKinney, TX',
    lat: 33.197,
    lon: -96.615,
    image_url: '/images/restaurant-placeholder.jpg',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'South Grill',
    cuisine_tags: ['Sushi'],
    neighborhood: '  Downtown ',
    description: null,
    price_range: null,
    address: null,
    lat: 33.158,
    lon: -96.699,
    image_url: '/images/restaurant-placeholder.jpg',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Hidden Grill',
    cuisine_tags: [],
    neighborhood: 'Craig Ranch',
    description: 'A quiet patio after dark.',
    price_range: null,
    address: '900 Craig Ranch, McKinney, TX',
    lat: 33.21,
    lon: -96.73,
    image_url: null,
  },
];

export function RestaurantsPreview({ state }: { state: 'ready' | 'empty' | 'error' }) {
  if (state === 'error') return <RestaurantsDirectory restaurants={[]} unavailable />;
  if (state === 'empty') return <RestaurantsDirectory restaurants={[]} />;
  return <RestaurantsDirectory restaurants={SAMPLE} />;
}
