import { evidenceExcerpt, type DescriptionFact, type DescriptionFactValue } from '@/lib/content-pipeline/facts';
import type { ExceptionDraft, ExceptionReason } from '@/lib/content-pipeline/exceptions';
import type { ExtractedDish } from '@/lib/recipes/menu-extract';
import { menuProse } from '@/lib/recipes/menu-extract';
import {
  claimsAllergenSafe,
  descriptionCopiesMenu,
  normalizeMenuTitle,
} from '@/lib/recipes/menu-paraphrase';
import type { MenuModelDish } from '@/lib/recipes/menu-row';
import type { Json } from '@/types/database.types';

const PRICE_RE = /\$\s?\d+(?:\.\d{2})?/;
const HOURS_RE = /\b(?:hours|open daily|open from)\b|\b\d{1,2}(?::\d{2})?\s*(?:a\.m\.|p\.m\.|am|pm)\b/i;
const DIETARY_CLAIM_RE = /\b(?:gluten[-\s]?free|dairy[-\s]?free|nut[-\s]?free|allergen|allergy)\b/i;
const INJECTION_RE =
  /ignore\s+(?:all\s+|previous\s+|prior\s+)?instructions|\bpublish\s+all\b|restaurant_approved|sourced_published|mark\s+\S.{0,40}approved/i;

export type RecipeSnapshot = {
  id: string;
  title: string;
  description: string | null;
  version: number;
  visibility: string;
  recipeType: string;
  sourceKind: string | null;
  sourceUrl: string | null;
};

export type DescribeCandidate = {
  dish: ExtractedDish;
  fact: DescriptionFact;
  recipe: RecipeSnapshot;
  ingredients: string[];
  price: string | null;
};

export type MenuPlan = {
  exceptions: ExceptionDraft[];
  candidates: DescribeCandidate[];
};

export type BaselineWrite = {
  recipeId: string;
  version: number;
  value: DescriptionFactValue;
  evidenceExcerpt: string;
};

export type BaselinePlan = {
  writes: BaselineWrite[];
  exceptions: ExceptionDraft[];
};

export type RecipeFactUpdate = {
  recipeId: string;
  factId: string;
  sourceId: string;
  subjectId: string;
  version: number;
  description: string;
  value: DescriptionFactValue;
  evidenceExcerpt: string;
};

export function injectionSuspected(text: string): boolean {
  return INJECTION_RE.test(text);
}

export function extractPrice(text: string): string | null {
  const match = PRICE_RE.exec(text);
  return match ? match[0].replace(/\s+/g, '') : null;
}

export function hoursSuspected(text: string): boolean {
  return HOURS_RE.test(text);
}

export function dietaryClaim(text: string): boolean {
  return claimsAllergenSafe(text) || DIETARY_CLAIM_RE.test(text);
}

/** Menu dish name, or a #88 title that ends with that dish name ("Home Skillet Beans"). */
export function recipeMatchesDish(title: string, dishName: string): boolean {
  const titleKey = normalizeMenuTitle(title);
  const dishKey = normalizeMenuTitle(dishName);
  if (!titleKey || !dishKey) return false;
  return titleKey === dishKey || titleKey.endsWith(` ${dishKey}`);
}

export function normalizeIngredients(items: readonly string[]): string[] {
  return [...new Set(items.map((item) => item.trim().toLowerCase()).filter(Boolean))].sort();
}

function sameIngredients(left: readonly string[], right: readonly string[]): boolean {
  const a = normalizeIngredients(left);
  const b = normalizeIngredients(right);
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function factJson(fact: DescriptionFact): Json {
  return {
    dish: fact.dish,
    text: fact.text,
    menu_description: fact.menuDescription,
    ingredients: fact.ingredients,
    price: fact.price,
  };
}

function exception(args: {
  sourceId: string;
  subjectId: string | null;
  field: string | null;
  reason: ExceptionReason;
  before: Json | null;
  after: Json | null;
  evidence: string;
}): ExceptionDraft {
  return {
    sourceId: args.sourceId,
    subjectType: 'recipe',
    subjectId: args.subjectId,
    field: args.field,
    reason: args.reason,
    before: args.before,
    after: args.after,
    evidenceExcerpt: evidenceExcerpt(args.evidence),
  };
}

function tracksMenuRecipe(recipe: RecipeSnapshot, sourceUrl: string): boolean {
  return recipe.recipeType === 'inspired_by'
    && recipe.sourceKind === 'public_menu'
    && recipe.sourceUrl === sourceUrl;
}

/**
 * First observation of an existing inspired-by menu recipe. No model call and
 * no recipe write. The fact version is the recipe's current version so a save
 * made before the fact still resolves. Unmatched dishes are ignored.
 */
export function planBaseline(args: {
  sourceId: string;
  sourceUrl: string;
  dishes: readonly ExtractedDish[];
  facts: readonly DescriptionFact[];
  recipes: readonly RecipeSnapshot[];
}): BaselinePlan {
  const writes: BaselineWrite[] = [];
  const exceptions: ExceptionDraft[] = [];
  const current = args.facts.filter((fact) => fact.status === 'current');
  for (const recipe of args.recipes) {
    if (!tracksMenuRecipe(recipe, args.sourceUrl)) continue;
    if (current.some((fact) => fact.subjectId === recipe.id)) continue;
    const description = recipe.description?.trim() ?? '';
    if (!description) {
      exceptions.push(exception({
        sourceId: args.sourceId,
        subjectId: recipe.id,
        field: 'description',
        reason: 'validation_failed',
        before: null,
        after: null,
        evidence: recipe.title,
      }));
      continue;
    }
    const matches = args.dishes
      .filter((dish) => recipeMatchesDish(recipe.title, dish.name))
      .sort((left, right) => normalizeMenuTitle(right.name).length - normalizeMenuTitle(left.name).length);
    const dish = matches[0];
    const next = matches[1];
    if (!dish || (next && normalizeMenuTitle(next.name).length === normalizeMenuTitle(dish.name).length)) {
      exceptions.push(exception({
        sourceId: args.sourceId,
        subjectId: recipe.id,
        field: 'description',
        reason: 'missing_source',
        before: { text: description, title: recipe.title },
        after: null,
        evidence: recipe.title,
      }));
      continue;
    }
    const joined = [dish.name, dish.description, ...dish.ingredients].join(' ');
    writes.push({
      recipeId: recipe.id,
      version: recipe.version,
      evidenceExcerpt: evidenceExcerpt(dish.description || dish.name),
      value: {
        dish: dish.name,
        text: description,
        menu_description: dish.description,
        ingredients: normalizeIngredients(dish.ingredients),
        price: extractPrice(joined),
      },
    });
  }
  return { writes, exceptions };
}

/**
 * Deterministic publish rules. Conflicts, removals, prices, hours, dietary
 * claims, and injection stay out of current facts. A changed menu description
 * is only a candidate for one later paraphrase.
 */
export function planMenuChanges(args: {
  sourceId: string;
  dishes: readonly ExtractedDish[];
  facts: readonly DescriptionFact[];
  recipes: readonly RecipeSnapshot[];
}): MenuPlan {
  const exceptions: ExceptionDraft[] = [];
  const candidates: DescribeCandidate[] = [];
  const seen = new Set<string>();
  const current = args.facts.filter((fact) => fact.status === 'current');
  for (const dish of args.dishes) {
    const key = normalizeMenuTitle(dish.name);
    seen.add(key);
    const fact = current.find((item) => normalizeMenuTitle(item.dish) === key) ?? null;
    const joined = [dish.name, dish.description, ...dish.ingredients].join(' ');
    if (injectionSuspected(joined)) {
      exceptions.push(exception({
        sourceId: args.sourceId,
        subjectId: fact?.subjectId ?? null,
        field: 'description',
        reason: 'injection_suspected',
        before: fact ? factJson(fact) : null,
        after: { text: dish.description, dish: dish.name },
        evidence: dish.description || dish.name,
      }));
      continue;
    }
    const price = extractPrice(joined);
    const ingredients = normalizeIngredients(dish.ingredients);
    const conflicts: ExceptionDraft[] = [];
    if (fact?.price && price && price !== fact.price) {
      conflicts.push(exception({
        sourceId: args.sourceId,
        subjectId: fact.subjectId,
        field: 'price',
        reason: 'conflict',
        before: { text: fact.price },
        after: { text: price },
        evidence: joined,
      }));
    }
    if (fact && fact.ingredients.length > 0 && ingredients.length > 0 && !sameIngredients(fact.ingredients, ingredients)) {
      conflicts.push(exception({
        sourceId: args.sourceId,
        subjectId: fact.subjectId,
        field: 'ingredients',
        reason: 'conflict',
        before: { items: fact.ingredients },
        after: { items: ingredients },
        evidence: dish.ingredients.join(', ') || dish.name,
      }));
    }
    if (conflicts.length > 0) {
      exceptions.push(...conflicts);
      continue;
    }
    const sensitiveField = price && !fact?.price ? 'price' : 'description';
    if ((price && !fact?.price) || hoursSuspected(joined) || dietaryClaim(joined)) {
      exceptions.push(exception({
        sourceId: args.sourceId,
        subjectId: fact?.subjectId ?? null,
        field: sensitiveField,
        reason: 'sensitive',
        before: fact ? factJson(fact) : null,
        after: { text: dish.description, price, dish: dish.name },
        evidence: joined,
      }));
      continue;
    }
    if (!fact) continue;
    if (normalizeMenuTitle(fact.menuDescription) === normalizeMenuTitle(dish.description)) continue;
    const recipe = args.recipes.find((item) => item.id === fact.subjectId);
    if (!recipe) {
      exceptions.push(exception({
        sourceId: args.sourceId,
        subjectId: fact.subjectId,
        field: 'description',
        reason: 'missing_source',
        before: factJson(fact),
        after: { text: dish.description, dish: dish.name },
        evidence: dish.name,
      }));
      continue;
    }
    candidates.push({ dish, fact, recipe, ingredients, price: price ?? fact.price });
  }
  for (const fact of current) {
    if (seen.has(normalizeMenuTitle(fact.dish))) continue;
    exceptions.push(exception({
      sourceId: args.sourceId,
      subjectId: fact.subjectId,
      field: 'description',
      reason: 'missing_source',
      before: factJson(fact),
      after: null,
      evidence: fact.dish,
    }));
  }
  return { exceptions, candidates };
}

export function paraphraseUpdates(args: {
  sourceId: string;
  candidates: readonly DescribeCandidate[];
  dishes: readonly MenuModelDish[];
}): { updates: RecipeFactUpdate[]; exceptions: ExceptionDraft[] } {
  const updates: RecipeFactUpdate[] = [];
  const exceptions: ExceptionDraft[] = [];
  for (const candidate of args.candidates) {
    const wanted = normalizeMenuTitle(candidate.dish.name);
    const draft = args.dishes.find((dish) => normalizeMenuTitle(dish.menuDish) === wanted)
      ?? args.dishes.find((dish) => normalizeMenuTitle(dish.title) === wanted);
    const evidence = candidate.dish.description || candidate.dish.name;
    if (!draft) {
      exceptions.push(exception({
        sourceId: args.sourceId,
        subjectId: candidate.fact.subjectId,
        field: 'description',
        reason: 'validation_failed',
        before: { text: candidate.fact.text },
        after: null,
        evidence,
      }));
      continue;
    }
    const description = draft.description.trim();
    const blocked = !description
      || description.length > 400
      || injectionSuspected(`${draft.title} ${description} ${draft.dietaryNotes.join(' ')}`)
      || claimsAllergenSafe(description)
      || draft.dietaryNotes.some((note) => claimsAllergenSafe(note) || dietaryClaim(note))
      || dietaryClaim(description)
      || hoursSuspected(description)
      || extractPrice(description)
      || descriptionCopiesMenu(description, candidate.dish.description, menuProse(candidate.dish));
    if (blocked) {
      const reason: ExceptionReason = injectionSuspected(`${draft.title} ${description}`)
        ? 'injection_suspected'
        : dietaryClaim(description) || hoursSuspected(description) || extractPrice(description)
          ? 'sensitive'
          : 'validation_failed';
      exceptions.push(exception({
        sourceId: args.sourceId,
        subjectId: candidate.fact.subjectId,
        field: 'description',
        reason,
        before: { text: candidate.fact.text },
        after: { text: description, title: draft.title },
        evidence,
      }));
      continue;
    }
    const version = Math.max(candidate.recipe.version, candidate.fact.version) + 1;
    updates.push({
      recipeId: candidate.recipe.id,
      factId: candidate.fact.id,
      sourceId: candidate.fact.sourceId,
      subjectId: candidate.fact.subjectId,
      version,
      description,
      evidenceExcerpt: evidenceExcerpt(evidence),
      value: {
        dish: candidate.fact.dish,
        text: description,
        menu_description: candidate.dish.description,
        ingredients: candidate.ingredients,
        price: candidate.price,
      },
    });
  }
  return { updates, exceptions };
}
