import { normalizeMenuUrl, type MenuSource } from '@/lib/recipes/menu-sources';

export type SeedSource = {
  kind: 'public_menu';
  url: string;
  restaurantSlug: string;
  notes: string;
};

/** The #88 registry is the only seed. SQL does not insert these URLs. */
export function seedSourcesFromRegistry(sources: readonly MenuSource[]): SeedSource[] {
  return sources.map((source) => ({
    kind: 'public_menu',
    url: source.menuUrl,
    restaurantSlug: source.restaurantSlug,
    notes: source.notes,
  }));
}

export function activeMenuSource(source: { status: string; kind: string; url: string }): string | null {
  if (source.kind !== 'public_menu') return `kind ${source.kind} is not fetched by this runner`;
  if (source.status !== 'active') return `status ${source.status} is not active`;
  if (!normalizeMenuUrl(source.url)) return 'URL is not an https menu URL';
  return null;
}
