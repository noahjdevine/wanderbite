import { recipeQaEnabled } from '@/lib/recipes/flag';

export type DiscoveryQaIntent = 'exact_recipe' | 'recipe' | 'visit';

const EXACT_RECIPE =
  /\bexact recipe\b|\bsecret recipe\b|\bofficial recipe\b|\brestaurant['’]?s (?:exact )?recipe\b/i;

const RECIPE_QUESTION =
  /\brecipe\b|\bcook\b|\bat home\b|\bhow (?:can|do) i make\b|\bswap for\b|\bsubstitut(?:e|ion|ions)\b/i;

const BEFORE_VISIT =
  /\bbefore (?:i |we )?go(?:ing)?\b|\bwhat should i know\b|\bwhen i visit\b|\bbefore (?:i |we )?visit\b/i;

/** Too broad alone. Counts as a visit only together with a catalog restaurant name. */
const VISIT_WITH_RESTAURANT = /\b(?:hours|visit)\b/i;

function namesMatchedRestaurant(message: string, restaurantNames: readonly string[]): boolean {
  const haystack = message.toLowerCase();
  return restaurantNames.some((name) => {
    const trimmed = name.trim().toLowerCase();
    return trimmed.length >= 3 && haystack.includes(trimmed);
  });
}

/**
 * Recipe and visit questions the Discover assistant can ground.
 * Ordinary picks stay null. A visit needs a before-visit cue, or a visit
 * word plus a matched catalog restaurant name.
 */
export function classifyDiscoveryQaIntent(
  message: string,
  restaurantNames: readonly string[] = [],
): DiscoveryQaIntent | null {
  const text = message.trim();
  if (!text) return null;
  if (EXACT_RECIPE.test(text)) return 'exact_recipe';
  if (RECIPE_QUESTION.test(text)) return 'recipe';
  if (BEFORE_VISIT.test(text)) return 'visit';
  if (VISIT_WITH_RESTAURANT.test(text) && namesMatchedRestaurant(text, restaurantNames)) {
    return 'visit';
  }
  return null;
}

/** Null when either recipe flag is unset, so the Discover prompt path does not load recipes. */
export function discoveryRecipeQaIntent(
  message: string,
  options?: { restaurantNames?: readonly string[]; enabled?: boolean },
): DiscoveryQaIntent | null {
  const enabled = options?.enabled ?? recipeQaEnabled();
  if (!enabled) return null;
  return classifyDiscoveryQaIntent(message, options?.restaurantNames ?? []);
}
