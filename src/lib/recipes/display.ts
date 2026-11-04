import { getDietaryConflict, hasAllergyConflict } from '@/lib/dietary-utils';

export const RECIPE_TYPE_LABELS = {
  restaurant_approved: 'Restaurant-approved recipe',
  sourced_published: 'Published recipe (source linked)',
  inspired_by: 'Inspired-by home recipe',
} as const;

export type RecipeType = keyof typeof RECIPE_TYPE_LABELS;

export const INSPIRED_BY_UNCERTAINTY =
  "An at-home take, not the restaurant's recipe";

export const DEMO_CONTENT_LABEL = 'Demo content';

export const RECIPES_SECTION_HEADING = 'Recipes inspired by this visit';

export const SAVED_RECIPES_HEADING = 'Saved recipes';

export const NOT_CHECKED_LABEL = 'Not recorded';

export type RecipeIngredient = {
  name: string;
  quantity: string;
  unit: string;
};

export type RecipeStep = {
  order: number;
  text: string;
};

export type RecipeSubstitution = {
  insteadOf: string;
  use: string;
};

export type RecipeCardModel = {
  id: string;
  slug: string;
  title: string;
  recipeType: RecipeType;
  typeLabel: string;
  restaurantId: string | null;
  servings: number;
  estMinutes: number;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  substitutions: RecipeSubstitution[];
  dietaryTags: string[];
  sourceUrl: string | null;
  sourceName: string | null;
  rightsBasis: string | null;
  checkedAtLabel: string;
  version: number;
  isDemo: boolean;
  demoLabel: string | null;
  uncertaintyLine: string | null;
  dietaryWarning: string | null;
  saved: boolean;
};

export type RecipeSections = {
  exclusionLine: string | null;
  byRestaurantId: Record<string, RecipeCardModel[]>;
};

export type SavedRecipesView =
  | { enabled: false }
  | { enabled: true; exclusionLine: string | null; recipes: RecipeCardModel[] };

const CHICAGO_CHECKED_AT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hourCycle: 'h12',
  timeZoneName: 'short',
});

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((item) => item.type === type)?.value ?? '';
}

/** Chicago wall time, independent of the process timezone. */
export function formatCheckedAtChicago(iso: string | null | undefined): string {
  if (!iso) return NOT_CHECKED_LABEL;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return NOT_CHECKED_LABEL;
  const parts = CHICAGO_CHECKED_AT.formatToParts(at);
  const month = part(parts, 'month');
  const day = part(parts, 'day');
  const year = part(parts, 'year');
  const hour = part(parts, 'hour');
  const minute = part(parts, 'minute');
  const dayPeriod = part(parts, 'dayPeriod');
  const timeZoneName = part(parts, 'timeZoneName');
  return `${month} ${day}, ${year}, ${hour}:${minute} ${dayPeriod} ${timeZoneName}`;
}

export function isRecipeType(value: string): value is RecipeType {
  return Object.prototype.hasOwnProperty.call(RECIPE_TYPE_LABELS, value);
}

export function recipeTypeLabel(recipeType: RecipeType): string {
  return RECIPE_TYPE_LABELS[recipeType];
}

export function inspiredByUncertainty(recipeType: RecipeType): string | null {
  return recipeType === 'inspired_by' ? INSPIRED_BY_UNCERTAINTY : null;
}

export function listedDietaryExclusions(
  dietaryFlags: string[] | null | undefined,
  allergyFlags: string[] | null | undefined,
): string | null {
  const dietary = (dietaryFlags ?? []).map((flag) => flag.trim()).filter(Boolean);
  const allergies = (allergyFlags ?? []).map((flag) => flag.trim()).filter(Boolean);
  const lines: string[] = [];
  if (dietary.length > 0) {
    lines.push(`Your listed dietary exclusions: ${dietary.join(', ')}.`);
  }
  if (allergies.length > 0) {
    lines.push(`Your listed allergies: ${allergies.join(', ')}.`);
  }
  return lines.length > 0 ? lines.join(' ') : null;
}

/**
 * Soft warning only. A conflict stays visible and is never described as allergen-safe.
 */
export function recipeDietaryWarning(
  tags: string[] | null | undefined,
  dietaryFlags: string[] | null | undefined,
  allergyFlags: string[] | null | undefined,
): string | null {
  const dietary = getDietaryConflict(tags ?? null, dietaryFlags ?? null);
  const allergy = hasAllergyConflict(tags ?? null, allergyFlags ?? null);
  if (!dietary && !allergy) return null;
  const sentences: string[] = [];
  if (dietary) {
    sentences.push(
      `This recipe lists ${dietary.conflictingTags.join(', ')}, which overlaps your ${dietary.flag} preference.`,
    );
  }
  if (allergy) {
    sentences.push('This recipe overlaps an allergy you listed.');
  }
  sentences.push('This does not check allergens.');
  return sentences.join(' ');
}

export function recipeConflictsWithDiet(warning: string | null): boolean {
  return warning != null;
}
