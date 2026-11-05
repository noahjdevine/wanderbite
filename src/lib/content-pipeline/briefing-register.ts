import { normalizeHttpsUrl } from '@/lib/briefings/research';

export const RESTAURANT_PAGE_NOTE = 'Official website registered for first-visit refresh.';

export type OfficialWebsiteRow = {
  id: string;
  name: string;
  officialWebsite: string | null;
};

export type RestaurantPageSeed = {
  restaurantId: string;
  restaurantName: string;
  url: string;
  notes: string;
};

/**
 * One restaurant_page seed per https official_website.
 * Null, blank, and non-https values are skipped. URLs are not invented.
 * A repeated URL keeps the first restaurant and skips the rest.
 */
export function restaurantPageSeedsFromWebsites(rows: readonly OfficialWebsiteRow[]): {
  seeds: RestaurantPageSeed[];
  skipped: number;
} {
  const seeds: RestaurantPageSeed[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const row of rows) {
    const url = normalizeHttpsUrl(row.officialWebsite);
    if (!url || url.length < 12 || url.length > 500) {
      skipped += 1;
      continue;
    }
    if (seen.has(url)) {
      skipped += 1;
      continue;
    }
    seen.add(url);
    seeds.push({
      restaurantId: row.id,
      restaurantName: row.name,
      url,
      notes: RESTAURANT_PAGE_NOTE,
    });
  }
  return { seeds, skipped };
}
