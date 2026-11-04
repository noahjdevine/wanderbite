'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/require-user';
import { evaluateRecipeSaveLimit } from '@/lib/ratelimit';
import {
  logRecipesSaveFailedOnce,
  logRecipesUnavailableOnce,
  recipeSchemaMissing,
  recipesEnabled,
} from '@/lib/recipes/flag';
import { createClient } from '@/lib/supabase/server';

export type SaveRecipeResult = { ok: true } | { ok: false; error: string };

const UNAVAILABLE = 'Recipes are not available.';
const WAIT = 'Please wait a moment and try again.';
const NOT_AVAILABLE = 'That recipe is not available.';
const SAVE_FAILED = 'Recipe could not be saved.';
const REMOVE_FAILED = 'Recipe could not be removed.';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function refreshRecipePages(): void {
  revalidatePath('/challenges');
  revalidatePath('/dashboard');
  revalidatePath('/journey');
}

export async function setSavedRecipe(
  recipeId: string,
  saved: boolean,
): Promise<SaveRecipeResult> {
  if (!recipesEnabled()) return { ok: false, error: UNAVAILABLE };

  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  if (!UUID_RE.test(recipeId)) return { ok: false, error: NOT_AVAILABLE };

  const limit = await evaluateRecipeSaveLimit(auth.userId);
  if (limit !== 'allowed') {
    logRecipesSaveFailedOnce();
    return { ok: false, error: WAIT };
  }

  const supabase = await createClient();
  if (!saved) {
    const { error } = await supabase
      .from('saved_recipes')
      .delete()
      .eq('user_id', auth.userId)
      .eq('recipe_id', recipeId);
    if (error) {
      if (recipeSchemaMissing(error)) {
        logRecipesUnavailableOnce();
        return { ok: false, error: UNAVAILABLE };
      }
      logRecipesSaveFailedOnce();
      return { ok: false, error: REMOVE_FAILED };
    }
    refreshRecipePages();
    return { ok: true };
  }

  const { data: recipe, error: readError } = await supabase
    .from('recipes')
    .select('id, version, visibility')
    .eq('id', recipeId)
    .eq('visibility', 'published')
    .maybeSingle();
  if (readError) {
    if (recipeSchemaMissing(readError)) {
      logRecipesUnavailableOnce();
      return { ok: false, error: UNAVAILABLE };
    }
    logRecipesSaveFailedOnce();
    return { ok: false, error: SAVE_FAILED };
  }
  if (!recipe || recipe.visibility !== 'published') {
    return { ok: false, error: NOT_AVAILABLE };
  }

  const { error: insertError } = await supabase.from('saved_recipes').insert({
    user_id: auth.userId,
    recipe_id: recipe.id,
    recipe_version: recipe.version,
  });
  if (insertError) {
    if (insertError.code === '23505') {
      refreshRecipePages();
      return { ok: true };
    }
    if (recipeSchemaMissing(insertError) || insertError.code === '42501') {
      if (recipeSchemaMissing(insertError)) logRecipesUnavailableOnce();
      return { ok: false, error: insertError.code === '42501' ? NOT_AVAILABLE : UNAVAILABLE };
    }
    logRecipesSaveFailedOnce();
    return { ok: false, error: SAVE_FAILED };
  }
  refreshRecipePages();
  return { ok: true };
}
