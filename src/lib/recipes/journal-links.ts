import 'server-only';

import { requireUser } from '@/lib/auth/require-user';
import { createClient } from '@/lib/supabase/server';
import {
  logRecipesReadFailedOnce,
  logRecipesUnavailableOnce,
  recipeQaEnabled,
  recipeSchemaMissing,
} from '@/lib/recipes/flag';

export type JournalRecipeLink = {
  id: string;
  title: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Saved published recipes for the signed-in member, grouped by restaurant.
 * Another member's saves are not read. Flag off returns before any query.
 */
export async function loadJournalSavedRecipeLinks(
  restaurantIds: readonly string[],
): Promise<Record<string, JournalRecipeLink[]>> {
  if (!recipeQaEnabled()) return {};
  const ids = [...new Set(restaurantIds.filter((id) => UUID_RE.test(id)))];
  if (ids.length === 0) return {};
  const auth = await requireUser();
  if (!auth.ok) return {};

  const supabase = await createClient();
  const saved = await supabase.from('saved_recipes').select('recipe_id').eq('user_id', auth.userId);
  if (saved.error) {
    if (recipeSchemaMissing(saved.error)) logRecipesUnavailableOnce();
    else logRecipesReadFailedOnce();
    return {};
  }
  const recipeIds = (saved.data ?? []).map((row) => row.recipe_id);
  if (recipeIds.length === 0) return {};

  const recipes = await supabase
    .from('recipes')
    .select('id, title, restaurant_id')
    .in('id', recipeIds)
    .in('restaurant_id', ids)
    .eq('visibility', 'published')
    .order('title', { ascending: true });
  if (recipes.error) {
    if (recipeSchemaMissing(recipes.error)) logRecipesUnavailableOnce();
    else logRecipesReadFailedOnce();
    return {};
  }

  const byRestaurant: Record<string, JournalRecipeLink[]> = {};
  for (const row of recipes.data ?? []) {
    if (!row.restaurant_id) continue;
    const list = byRestaurant[row.restaurant_id] ?? [];
    list.push({ id: row.id, title: row.title });
    byRestaurant[row.restaurant_id] = list;
  }
  return byRestaurant;
}
