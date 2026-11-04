import type { Json } from '@/types/database.types';
import type { DiscoveryQaIntent } from '@/lib/recipes/qa-intent';
import type { PublishedRecipeRow } from '@/lib/recipes/load';

export const RECIPE_QA_MAX_RECIPES = 3;

const STOP_WORDS = new Set([
  'what',
  'whats',
  'how',
  'can',
  'make',
  'something',
  'like',
  'this',
  'that',
  'from',
  'with',
  'home',
  'recipe',
  'exact',
  'secret',
  'official',
  'restaurant',
  'restaurants',
  'swap',
  'know',
  'before',
  'going',
  'should',
  'your',
  'have',
  'does',
  'the',
  'and',
  'for',
  'you',
  'please',
  'want',
  'need',
  'about',
  'visit',
  'there',
  'they',
  'them',
  'into',
  'onto',
  'dish',
  'food',
  'when',
]);

const TYPE_RANK: Record<string, number> = {
  restaurant_approved: 0,
  sourced_published: 1,
  inspired_by: 2,
};

export type NamedRestaurant = {
  id: string;
  name: string;
};

function ingredientNames(value: Json): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const name = item.name;
    if (typeof name === 'string' && name.trim()) names.push(name.trim());
  }
  return names;
}

export function recipeSearchKeywords(message: string): string[] {
  const tokens = message
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const keywords: string[] = [];
  for (const token of tokens) {
    if (token.length < 3 || STOP_WORDS.has(token) || keywords.includes(token)) continue;
    keywords.push(token);
    if (keywords.length === 6) break;
  }
  return keywords;
}

export function matchRestaurantName<T extends NamedRestaurant>(
  message: string,
  restaurants: readonly T[],
): T | null {
  const haystack = message.toLowerCase();
  let best: T | null = null;
  let bestLength = 0;
  for (const restaurant of restaurants) {
    const name = restaurant.name.trim().toLowerCase();
    if (name.length < 3 || !haystack.includes(name)) continue;
    if (name.length > bestLength) {
      best = restaurant;
      bestLength = name.length;
    }
  }
  return best;
}

function searchText(row: PublishedRecipeRow): string {
  return [
    row.title,
    row.description ?? '',
    ingredientNames(row.ingredients).join(' '),
    (row.dietary_tags ?? []).join(' '),
  ]
    .join(' ')
    .toLowerCase();
}

function isOfficial(row: PublishedRecipeRow): boolean {
  return row.recipe_type === 'restaurant_approved' || row.recipe_type === 'sourced_published';
}

export type RecipeSelection = {
  rows: PublishedRecipeRow[];
  hasOfficial: boolean;
};

/**
 * Published rows only. A named restaurant never borrows another restaurant's recipe.
 * At most {@link RECIPE_QA_MAX_RECIPES} rows, with restaurant-approved and sourced rows first.
 */
export function selectPublishedRecipes(args: {
  rows: readonly PublishedRecipeRow[];
  restaurantId: string | null;
  keywords: readonly string[];
  intent: DiscoveryQaIntent;
}): RecipeSelection {
  const published = args.rows.filter((row) => row.visibility === 'published');
  const scoped = args.restaurantId
    ? published.filter((row) => row.restaurant_id === args.restaurantId)
    : published;
  const hasOfficial = args.restaurantId ? scoped.some(isOfficial) : false;

  let pool = scoped;
  if (args.intent === 'exact_recipe' && !args.restaurantId) {
    pool = scoped.filter((row) => row.recipe_type === 'inspired_by');
  }

  const keywords = args.keywords.map((keyword) => keyword.toLowerCase());
  const scored = pool.flatMap((row) => {
    if (keywords.length === 0) {
      return args.restaurantId ? [{ row, score: 1 }] : [];
    }
    const text = searchText(row);
    const score = keywords.filter((keyword) => text.includes(keyword)).length;
    if (!args.restaurantId && score === 0) return [];
    return [{ row, score: score || (args.restaurantId ? 1 : 0) }];
  });

  scored.sort((a, b) => {
    const rank = (TYPE_RANK[a.row.recipe_type] ?? 9) - (TYPE_RANK[b.row.recipe_type] ?? 9);
    if (rank !== 0) return rank;
    if (b.score !== a.score) return b.score - a.score;
    return a.row.title.localeCompare(b.row.title);
  });

  return {
    rows: scored.slice(0, RECIPE_QA_MAX_RECIPES).map((item) => item.row),
    hasOfficial,
  };
}
