export type CuisineId =
  | 'american'
  | 'italian'
  | 'mexican'
  | 'chinese'
  | 'japanese'
  | 'thai'
  | 'vietnamese'
  | 'korean'
  | 'indian'
  | 'mediterranean'
  | 'middle_eastern'
  | 'french'
  | 'tex_mex'
  | 'cajun'
  | 'pizza'
  | 'steakhouse'
  | 'seafood'
  | 'vegetarian_forward'
  | 'cafe'
  | 'tapas';

export type CuisineOption = {
  id: CuisineId;
  label: string;
  /** Lowercase keywords matched against restaurants.cuisine_tags joined text. */
  keywords: readonly string[];
};

export const CUISINES: readonly CuisineOption[] = [
  {
    id: 'american',
    label: 'American — BBQ, Burgers, Diner',
    keywords: ['american', 'bbq', 'barbecue', 'burger', 'burgers', 'diner', 'southern', 'smokehouse'],
  },
  { id: 'italian', label: 'Italian', keywords: ['italian', 'pasta', 'trattoria'] },
  { id: 'mexican', label: 'Mexican', keywords: ['mexican', 'taqueria', 'tacos'] },
  { id: 'chinese', label: 'Chinese', keywords: ['chinese', 'dim sum', 'szechuan', 'sichuan', 'cantonese'] },
  { id: 'japanese', label: 'Japanese / Sushi', keywords: ['japanese', 'sushi', 'ramen', 'izakaya', 'yakitori'] },
  { id: 'thai', label: 'Thai', keywords: ['thai'] },
  { id: 'vietnamese', label: 'Vietnamese', keywords: ['vietnamese', 'pho', 'banh mi'] },
  { id: 'korean', label: 'Korean', keywords: ['korean', 'bbq korean', 'k-bbq'] },
  { id: 'indian', label: 'Indian', keywords: ['indian'] },
  { id: 'mediterranean', label: 'Mediterranean / Greek', keywords: ['mediterranean', 'greek'] },
  { id: 'middle_eastern', label: 'Middle Eastern', keywords: ['middle eastern', 'levant', 'shawarma', 'falafel'] },
  { id: 'french', label: 'French', keywords: ['french', 'bistro', 'brasserie'] },
  { id: 'tex_mex', label: 'Tex-Mex', keywords: ['tex-mex', 'tex mex'] },
  { id: 'cajun', label: 'Cajun / Creole', keywords: ['cajun', 'creole'] },
  { id: 'pizza', label: 'Pizza', keywords: ['pizza', 'pizzeria'] },
  { id: 'steakhouse', label: 'Steakhouse', keywords: ['steakhouse', 'steak'] },
  { id: 'seafood', label: 'Seafood', keywords: ['seafood', 'oyster', 'oysters'] },
  {
    id: 'vegetarian_forward',
    label: 'Vegetarian-Forward',
    keywords: ['vegetarian', 'plant-based', 'plant based', 'vegan'],
  },
  { id: 'cafe', label: 'Cafe / Bakery', keywords: ['cafe', 'coffee', 'bakery', 'bakeshop', 'brunch'] },
  { id: 'tapas', label: 'Tapas / Small Plates', keywords: ['tapas', 'small plates', 'small-plates', 'shared plates'] },
] as const;

const CUISINE_IDS = new Set<CuisineId>(CUISINES.map((c) => c.id));
const CUISINE_LABEL_BY_ID = new Map<CuisineId, string>(CUISINES.map((c) => [c.id, c.label]));

export function isCuisineId(value: string): value is CuisineId {
  return CUISINE_IDS.has(value as CuisineId);
}

export function normalizeCuisineIds(values: string[] | null | undefined): CuisineId[] {
  if (!values?.length) return [];
  const out: CuisineId[] = [];
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const t = v.trim() as CuisineId;
    if (!t) continue;
    if (!isCuisineId(t)) continue;
    out.push(t);
  }
  return Array.from(new Set(out));
}

export function cuisineLabel(id: CuisineId): string {
  return CUISINE_LABEL_BY_ID.get(id) ?? id;
}

/**
 * Map a restaurant's cuisine_tags into canonical cuisine IDs using keyword matching.
 * This intentionally allows multiple IDs for one restaurant.
 */
export function cuisineIdsFromRestaurantTags(tags: string[] | null | undefined): CuisineId[] {
  const text = (tags ?? [])
    .map((t) => String(t).toLowerCase().trim())
    .filter(Boolean)
    .join(' | ');

  if (!text) return [];

  const out: CuisineId[] = [];
  for (const cuisine of CUISINES) {
    if (cuisine.keywords.some((kw) => text.includes(kw))) {
      out.push(cuisine.id);
    }
  }
  return out;
}

export function restaurantHasExcludedCuisine(args: {
  restaurantCuisineTags: string[] | null | undefined;
  excludedCuisineIds: string[] | null | undefined;
}): boolean {
  const excluded = new Set(normalizeCuisineIds(args.excludedCuisineIds));
  if (excluded.size === 0) return false;
  const mapped = cuisineIdsFromRestaurantTags(args.restaurantCuisineTags);
  return mapped.some((id) => excluded.has(id));
}

