import { recipeQaEnabled } from '@/lib/recipes/flag';

export type DiscoveryQaIntent = 'exact_recipe' | 'recipe' | 'visit';

const EXACT_RECIPE =
  /\bexact recipe\b|\bsecret recipe\b|\bofficial recipe\b|\brestaurant['’]?s (?:exact )?recipe\b/i;

const RECIPE_QUESTION =
  /\brecipe\b|\bat home\b|\bhow (?:can|do) i make\b|\bswap for\b|\bsubstitut(?:e|ion|ions)\b|\bingredients?\b/i;

const VISIT_QUESTION =
  /\bbefore (?:i |we )?go(?:ing)?\b|\bwhat should i know\b|\bhours\b|\bwhen i visit\b|\badventure\b/i;

/** Recipe and visit questions the Discover assistant can ground. Ordinary picks stay null. */
export function classifyDiscoveryQaIntent(message: string): DiscoveryQaIntent | null {
  const text = message.trim();
  if (!text) return null;
  if (EXACT_RECIPE.test(text)) return 'exact_recipe';
  if (RECIPE_QUESTION.test(text)) return 'recipe';
  if (VISIT_QUESTION.test(text)) return 'visit';
  return null;
}

/** Null when either recipe flag is unset, so the Discover prompt path does not load recipes. */
export function discoveryRecipeQaIntent(
  message: string,
  enabled: boolean = recipeQaEnabled(),
): DiscoveryQaIntent | null {
  if (!enabled) return null;
  return classifyDiscoveryQaIntent(message);
}
