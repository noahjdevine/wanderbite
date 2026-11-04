/**
 * Local sample activities for scripts/seed.ts.
 * Fictional names and example.com links. Not real venues and not official claims.
 * is_sample stays true. The migration does not insert these rows.
 */
export type SampleActivitySeed = {
  name: string;
  category: 'museum' | 'walk' | 'class' | 'sports' | 'arts';
  sourceUrl: string;
  lat: number | null;
  lon: number | null;
  zip: string | null;
  typicalDurationMinutes: number;
  costCategory: 'free' | '$' | '$$' | '$$$' | 'unknown';
  dated: boolean;
  weatherDependent: boolean;
  bookingRequired: boolean;
};

export const SAMPLE_ACTIVITY_SEEDS: readonly SampleActivitySeed[] = [
  {
    name: 'Sample Square Walk',
    category: 'walk',
    sourceUrl: 'https://example.com/sample-square-walk',
    lat: 33.198,
    lon: -96.616,
    zip: '75069',
    typicalDurationMinutes: 40,
    costCategory: 'free',
    dated: false,
    weatherDependent: true,
    bookingRequired: false,
  },
  {
    name: 'Sample Dated Fair',
    category: 'arts',
    sourceUrl: 'https://example.com/sample-dated-fair',
    lat: 33.2,
    lon: -96.616,
    zip: '75069',
    typicalDurationMinutes: 90,
    costCategory: '$$',
    dated: true,
    weatherDependent: false,
    bookingRequired: true,
  },
  {
    name: 'Sample Hall Museum',
    category: 'museum',
    sourceUrl: 'https://example.com/sample-hall-museum',
    lat: 33.5,
    lon: -96.62,
    zip: '75069',
    typicalDurationMinutes: 75,
    costCategory: '$',
    dated: false,
    weatherDependent: false,
    bookingRequired: false,
  },
  {
    name: 'Sample Sports Lot',
    category: 'sports',
    sourceUrl: 'https://example.com/sample-sports-lot',
    lat: null,
    lon: null,
    zip: '75069',
    typicalDurationMinutes: 60,
    costCategory: 'free',
    dated: false,
    weatherDependent: false,
    bookingRequired: false,
  },
];
