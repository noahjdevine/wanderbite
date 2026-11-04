import { slugify } from '@/lib/slugify';
import type { Database, Json } from '@/types/database.types';
import { formatCheckedAtChicago } from '@/lib/recipes/display';
import {
  claimsAllergenSafe,
  descriptionCopiesMenu,
  normalizeMenuTitle,
} from '@/lib/recipes/menu-paraphrase';

export const MENU_DRAFT_SOURCE_NAME = 'Public menu';

export type MenuIngredient = { name: string; quantity: string; unit: string };
export type MenuStep = { order: number; text: string };
export type MenuSubstitution = { instead_of: string; use: string };

export type MenuDraftRow = {
  slug: string;
  title: string;
  recipe_type: 'inspired_by';
  restaurant_id: string | null;
  restaurant_slug: string;
  servings: number;
  est_minutes: number;
  ingredients: MenuIngredient[];
  steps: MenuStep[];
  substitutions: MenuSubstitution[];
  dietary_tags: string[];
  description: string;
  source_url: string;
  source_name: string;
  source_kind: 'public_menu';
  retrieved_at: string;
  menu_wording: 'paraphrase';
  rights_basis: 'original';
  visibility: 'draft';
  is_demo: false;
  idempotency_key: string;
};

export type MenuModelDish = {
  menuDish: string;
  title: string;
  description: string;
  servings: number;
  estMinutes: number;
  ingredients: MenuIngredient[];
  steps: MenuStep[];
  substitutions: MenuSubstitution[];
  dietaryNotes: string[];
};

export function menuDraftIdempotencyKey(restaurantId: string, sourceUrl: string, title: string): string {
  return `${restaurantId}\n${sourceUrl}\n${normalizeMenuTitle(title)}`;
}

export function menuRecipeSlug(restaurantSlug: string, title: string, taken: ReadonlySet<string>): string {
  const prefix = `menu-${slugify(restaurantSlug) || 'restaurant'}-`;
  const baseTitle = slugify(title) || 'dish';
  const room = Math.max(1, 80 - prefix.length);
  const slug = `${prefix}${baseTitle.slice(0, room)}`.replace(/-+$/g, '');
  if (!taken.has(slug)) return slug;
  for (let n = 2; n < 100; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${slug.slice(0, Math.max(1, 80 - suffix.length))}${suffix}`.replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!taken.has(candidate)) return candidate;
  }
  return `${slug.slice(0, 70)}-draft`;
}

function integerIn(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

function textField(value: string, max: number): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

export function buildMenuDraftRow(args: {
  restaurantSlug: string;
  restaurantId: string | null;
  sourceUrl: string;
  retrievedAt: string;
  menuDescription: string;
  menuProse: string;
  dish: MenuModelDish;
  takenSlugs: ReadonlySet<string>;
}): { ok: true; row: MenuDraftRow } | { ok: false; reason: string } {
  const title = textField(args.dish.title, 160);
  const description = textField(args.dish.description, 400);
  if (!title) return { ok: false, reason: 'draft title is empty or too long' };
  if (!description) return { ok: false, reason: 'draft description is empty or too long' };
  if (descriptionCopiesMenu(description, args.menuDescription, args.menuProse)) {
    return { ok: false, reason: 'description copies a long run of menu wording' };
  }
  if (claimsAllergenSafe(description) || args.dish.dietaryNotes.some((note) => claimsAllergenSafe(note))) {
    return { ok: false, reason: 'draft claims the dish is allergen-safe' };
  }
  if (!integerIn(args.dish.servings, 1, 100) || !integerIn(args.dish.estMinutes, 1, 1440)) {
    return { ok: false, reason: 'draft servings or time is out of range' };
  }
  if (args.dish.ingredients.length < 1 || args.dish.ingredients.length > 40) {
    return { ok: false, reason: 'draft ingredients are missing' };
  }
  const ingredients: MenuIngredient[] = [];
  for (const item of args.dish.ingredients) {
    const name = textField(item.name, 80);
    const quantity = textField(item.quantity, 40);
    const unit = textField(item.unit, 40);
    if (!name || !quantity || !unit) return { ok: false, reason: 'draft ingredient is incomplete' };
    ingredients.push({ name, quantity, unit });
  }
  if (args.dish.steps.length < 1 || args.dish.steps.length > 30) {
    return { ok: false, reason: 'draft steps are missing' };
  }
  const steps: MenuStep[] = [];
  for (let index = 0; index < args.dish.steps.length; index += 1) {
    const text = textField(args.dish.steps[index]?.text ?? '', 500);
    if (!text) return { ok: false, reason: 'draft step is empty or too long' };
    steps.push({ order: index + 1, text });
  }
  if (args.dish.substitutions.length > 20) return { ok: false, reason: 'draft has too many substitutions' };
  const substitutions: MenuSubstitution[] = [];
  for (const item of args.dish.substitutions) {
    const insteadOf = textField(item.instead_of, 160);
    const use = textField(item.use, 160);
    if (!insteadOf || !use) return { ok: false, reason: 'draft substitution is incomplete' };
    substitutions.push({ instead_of: insteadOf, use });
  }
  const dietaryTags: string[] = [];
  for (const note of args.dish.dietaryNotes) {
    const tag = textField(note, 40);
    if (!tag) return { ok: false, reason: 'dietary note is empty or too long' };
    if (!dietaryTags.includes(tag)) dietaryTags.push(tag);
  }
  if (dietaryTags.length > 20) return { ok: false, reason: 'draft has too many dietary notes' };
  const retrieved = new Date(args.retrievedAt);
  if (Number.isNaN(retrieved.getTime())) return { ok: false, reason: 'retrieved_at is not a timestamp' };
  const restaurantKey = args.restaurantId ?? `slug:${args.restaurantSlug}`;
  const slug = menuRecipeSlug(args.restaurantSlug, title, args.takenSlugs);
  return {
    ok: true,
    row: {
      slug,
      title,
      recipe_type: 'inspired_by',
      restaurant_id: args.restaurantId,
      restaurant_slug: args.restaurantSlug,
      servings: args.dish.servings,
      est_minutes: args.dish.estMinutes,
      ingredients,
      steps,
      substitutions,
      dietary_tags: dietaryTags,
      description,
      source_url: args.sourceUrl,
      source_name: MENU_DRAFT_SOURCE_NAME,
      source_kind: 'public_menu',
      retrieved_at: retrieved.toISOString(),
      menu_wording: 'paraphrase',
      rights_basis: 'original',
      visibility: 'draft',
      is_demo: false,
      idempotency_key: menuDraftIdempotencyKey(restaurantKey, args.sourceUrl, title),
    },
  };
}

export function chicagoRetrievedAtLabel(iso: string): string {
  return formatCheckedAtChicago(iso);
}

/** Insert payload. Visibility and type are forced even if a caller mutated the draft. */
export function toRecipeInsert(row: MenuDraftRow): Database['public']['Tables']['recipes']['Insert'] {
  const ingredients = row.ingredients as unknown as Json;
  const steps = row.steps as unknown as Json;
  const substitutions = row.substitutions as unknown as Json;
  return {
    slug: row.slug,
    title: row.title,
    recipe_type: 'inspired_by',
    restaurant_id: row.restaurant_id,
    servings: row.servings,
    est_minutes: row.est_minutes,
    ingredients,
    steps,
    substitutions,
    dietary_tags: row.dietary_tags,
    description: row.description,
    source_url: row.source_url,
    source_name: MENU_DRAFT_SOURCE_NAME,
    source_kind: 'public_menu',
    retrieved_at: row.retrieved_at,
    menu_wording: 'paraphrase',
    rights_basis: 'original',
    visibility: 'draft',
    is_demo: false,
  };
}
