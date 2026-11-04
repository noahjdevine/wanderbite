import 'server-only';

import type { Json } from '@/types/database.types';
import { requireUser } from '@/lib/auth/require-user';
import { createClient } from '@/lib/supabase/server';
import {
  inspiredByUncertainty,
  isRecipeType,
  listedDietaryExclusions,
  recipeDietaryWarning,
  recipeTypeLabel,
  formatCheckedAtChicago,
  DEMO_CONTENT_LABEL,
  type RecipeCardModel,
  type RecipeIngredient,
  type RecipeSections,
  type RecipeStep,
  type RecipeSubstitution,
  type RecipeType,
  type SavedRecipesView,
} from '@/lib/recipes/display';
import {
  logRecipesReadFailedOnce,
  logRecipesUnavailableOnce,
  recipeSchemaMissing,
  recipesEnabled,
} from '@/lib/recipes/flag';

const EMPTY_SECTIONS: RecipeSections = { exclusionLine: null, byRestaurantId: {} };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RecipeRow = {
  id: string;
  slug: string;
  title: string;
  recipe_type: string;
  restaurant_id: string | null;
  servings: number;
  est_minutes: number;
  ingredients: Json;
  steps: Json;
  substitutions: Json;
  dietary_tags: string[];
  source_url: string | null;
  source_name: string | null;
  rights_basis: string | null;
  visibility: string;
  checked_at: string | null;
  version: number;
  is_demo: boolean;
};

const RECIPE_COLUMNS =
  'id, slug, title, recipe_type, restaurant_id, servings, est_minutes, ingredients, steps, substitutions, dietary_tags, source_url, source_name, rights_basis, visibility, checked_at, version, is_demo';

function asRecord(value: Json): Record<string, Json | undefined> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

function textValue(value: Json | undefined): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function parseIngredients(value: Json): RecipeIngredient[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const ingredients: RecipeIngredient[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const name = record ? textValue(record.name) : null;
    const quantity = record ? textValue(record.quantity) : null;
    const unit = record ? textValue(record.unit) : null;
    if (!name || !quantity || !unit) return null;
    ingredients.push({ name, quantity, unit });
  }
  return ingredients;
}

function parseSteps(value: Json): RecipeStep[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const steps: RecipeStep[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const text = record ? textValue(record.text) : null;
    const order = record ? textValue(record.order) : null;
    if (!text || !order || !/^[1-9][0-9]{0,3}$/.test(order)) return null;
    steps.push({ order: Number(order), text });
  }
  steps.sort((a, b) => a.order - b.order);
  return steps;
}

function parseSubstitutions(value: Json): RecipeSubstitution[] | null {
  if (!Array.isArray(value)) return null;
  const substitutions: RecipeSubstitution[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const insteadOf = record ? textValue(record.instead_of) : null;
    const use = record ? textValue(record.use) : null;
    if (!insteadOf || !use) return null;
    substitutions.push({ insteadOf, use });
  }
  return substitutions;
}

export function toRecipeCard(
  row: RecipeRow,
  savedIds: ReadonlySet<string>,
  dietaryFlags: string[] | null,
  allergyFlags: string[] | null,
): RecipeCardModel | null {
  if (row.visibility !== 'published') return null;
  if (!isRecipeType(row.recipe_type)) return null;
  const ingredients = parseIngredients(row.ingredients);
  const steps = parseSteps(row.steps);
  const substitutions = parseSubstitutions(row.substitutions);
  if (!ingredients || !steps || !substitutions) return null;
  if (!Number.isInteger(row.servings) || !Number.isInteger(row.est_minutes) || !Number.isInteger(row.version)) {
    return null;
  }
  const recipeType: RecipeType = row.recipe_type;
  const dietaryTags = (row.dietary_tags ?? []).filter((tag) => tag.trim().length > 0);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    recipeType,
    typeLabel: recipeTypeLabel(recipeType),
    restaurantId: row.restaurant_id,
    servings: row.servings,
    estMinutes: row.est_minutes,
    ingredients,
    steps,
    substitutions,
    dietaryTags,
    sourceUrl: row.source_url,
    sourceName: row.source_name,
    rightsBasis: row.rights_basis,
    checkedAtLabel: formatCheckedAtChicago(row.checked_at),
    version: row.version,
    isDemo: row.is_demo,
    demoLabel: row.is_demo ? DEMO_CONTENT_LABEL : null,
    uncertaintyLine: inspiredByUncertainty(recipeType),
    dietaryWarning: recipeDietaryWarning(dietaryTags, dietaryFlags, allergyFlags),
    saved: savedIds.has(row.id),
  };
}

function sortRecipes(recipes: RecipeCardModel[]): RecipeCardModel[] {
  return [...recipes].sort((a, b) => {
    const conflict = Number(a.dietaryWarning != null) - Number(b.dietaryWarning != null);
    if (conflict !== 0) return conflict;
    return a.title.localeCompare(b.title);
  });
}

type MemberContext = {
  userId: string;
  dietaryFlags: string[] | null;
  allergyFlags: string[] | null;
  savedIds: Set<string>;
};

async function loadMemberContext(): Promise<MemberContext | null> {
  const auth = await requireUser();
  if (!auth.ok) return null;
  const supabase = await createClient();
  const [profileResult, savedResult] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('dietary_flags, allergy_flags')
      .eq('id', auth.userId)
      .maybeSingle(),
    supabase.from('saved_recipes').select('recipe_id').eq('user_id', auth.userId),
  ]);
  if (profileResult.error || savedResult.error) {
    const error = profileResult.error ?? savedResult.error;
    if (recipeSchemaMissing(error)) logRecipesUnavailableOnce();
    else logRecipesReadFailedOnce();
    return null;
  }
  const profile = profileResult.data;
  return {
    userId: auth.userId,
    dietaryFlags: profile?.dietary_flags ?? null,
    allergyFlags: profile?.allergy_flags ?? null,
    savedIds: new Set((savedResult.data ?? []).map((row) => row.recipe_id)),
  };
}

export async function loadRecipeSections(restaurantIds: readonly string[]): Promise<RecipeSections> {
  if (!recipesEnabled()) return EMPTY_SECTIONS;
  const ids = [...new Set(restaurantIds.filter((id) => UUID_RE.test(id)))];
  if (ids.length === 0) return EMPTY_SECTIONS;
  const member = await loadMemberContext();
  if (!member) return EMPTY_SECTIONS;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('recipes')
    .select(RECIPE_COLUMNS)
    .in('restaurant_id', ids)
    .eq('visibility', 'published')
    .order('title', { ascending: true });
  if (error) {
    if (recipeSchemaMissing(error)) logRecipesUnavailableOnce();
    else logRecipesReadFailedOnce();
    return EMPTY_SECTIONS;
  }
  const byRestaurantId: Record<string, RecipeCardModel[]> = {};
  for (const row of data ?? []) {
    const card = toRecipeCard(row, member.savedIds, member.dietaryFlags, member.allergyFlags);
    if (!card?.restaurantId) continue;
    const list = byRestaurantId[card.restaurantId] ?? [];
    list.push(card);
    byRestaurantId[card.restaurantId] = list;
  }
  for (const restaurantId of Object.keys(byRestaurantId)) {
    byRestaurantId[restaurantId] = sortRecipes(byRestaurantId[restaurantId] ?? []);
  }
  return {
    exclusionLine: listedDietaryExclusions(member.dietaryFlags, member.allergyFlags),
    byRestaurantId,
  };
}

export async function loadSavedRecipes(): Promise<SavedRecipesView> {
  if (!recipesEnabled()) return { enabled: false };
  const member = await loadMemberContext();
  if (!member) return { enabled: true, exclusionLine: null, recipes: [] };
  if (member.savedIds.size === 0) {
    return {
      enabled: true,
      exclusionLine: listedDietaryExclusions(member.dietaryFlags, member.allergyFlags),
      recipes: [],
    };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('recipes')
    .select(RECIPE_COLUMNS)
    .in('id', [...member.savedIds])
    .eq('visibility', 'published')
    .order('title', { ascending: true });
  if (error) {
    if (recipeSchemaMissing(error)) logRecipesUnavailableOnce();
    else logRecipesReadFailedOnce();
    return { enabled: true, exclusionLine: null, recipes: [] };
  }
  const recipes = sortRecipes(
    (data ?? []).flatMap((row) => {
      const card = toRecipeCard(row, member.savedIds, member.dietaryFlags, member.allergyFlags);
      return card ? [card] : [];
    }),
  );
  return {
    enabled: true,
    exclusionLine: listedDietaryExclusions(member.dietaryFlags, member.allergyFlags),
    recipes,
  };
}
