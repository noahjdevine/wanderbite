import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Json } from '@/types/database.types';
import { toRecipeCard } from '@/lib/recipes/load';
import { resetRecipesLogs } from '@/lib/recipes/flag';

const requireUser = vi.fn();
const from = vi.fn();

vi.mock('@/lib/auth/require-user', () => ({
  requireUser: () => requireUser(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from }),
}));

import { loadRecipeSections, loadSavedRecipes } from '@/lib/recipes/load';

const USER = '11111111-1111-4111-8111-111111111111';
const RESTAURANT = '22222222-2222-4222-8222-222222222222';
const PUBLISHED = '33333333-3333-4333-8333-333333333333';
const CONFLICTING = '44444444-4444-4444-8444-444444444444';
const DRAFT = '55555555-5555-4555-8555-555555555555';

const ingredients = [{ name: 'Demo beans', quantity: '1', unit: 'cup' }];
const steps = [{ order: 1, text: 'Stir the demo beans.' }];
const substitutions = [{ instead_of: 'Demo beans', use: 'Demo lentils' }];

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: PUBLISHED,
    slug: 'demo-skillet-beans',
    title: 'Demo skillet beans',
    recipe_type: 'inspired_by',
    restaurant_id: RESTAURANT,
    servings: 2,
    est_minutes: 25,
    ingredients,
    steps,
    substitutions,
    dietary_tags: ['greens'],
    description: null,
    source_url: null,
    source_name: 'Wanderbite demo collection',
    source_kind: null,
    retrieved_at: null,
    menu_wording: null,
    rights_basis: 'original',
    visibility: 'published',
    checked_at: '2026-01-15T18:00:00.000Z',
    version: 3,
    is_demo: true,
    ...overrides,
  };
}

function query(table: string, filters: string[]) {
  const api = {
    select: () => api,
    eq: (column: string, value: string) => {
      filters.push(`${table}.${column}=${value}`);
      return api;
    },
    in: () => api,
    order: () => api,
    maybeSingle: async () => {
      if (table === 'user_profiles') {
        return { data: { dietary_flags: ['vegan'], allergy_flags: ['peanut'] }, error: null };
      }
      return { data: null, error: null };
    },
    then: (
      resolve: (value: { data: unknown; error: null }) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => {
      void reject;
      if (table === 'saved_recipes') {
        return Promise.resolve(resolve({ data: [{ recipe_id: PUBLISHED }], error: null }));
      }
      if (table === 'recipes') {
        return Promise.resolve(resolve({
          data: [
            row({ id: CONFLICTING, title: 'Demo cheese bowl', dietary_tags: ['cheese'] }),
            row(),
            row({ id: DRAFT, title: 'Hidden demo', visibility: 'draft' }),
          ],
          error: null,
        }));
      }
      return Promise.resolve(resolve({ data: [], error: null }));
    },
  };
  return api;
}

describe('recipe loader', () => {
  const filters: string[] = [];

  beforeEach(() => {
    filters.length = 0;
    from.mockReset();
    requireUser.mockReset();
    resetRecipesLogs();
    delete process.env.E05_RECIPES_ENABLED;
    requireUser.mockResolvedValue({ ok: true, userId: USER, email: null });
    from.mockImplementation((table: string) => query(table, filters));
  });

  it('does not query when the flag is off', async () => {
    await expect(loadRecipeSections([RESTAURANT])).resolves.toEqual({
      exclusionLine: null,
      byRestaurantId: {},
    });
    await expect(loadSavedRecipes()).resolves.toEqual({ enabled: false });
    expect(from).not.toHaveBeenCalled();
  });

  it('returns published cards with labels, a save, and a soft dietary warning', async () => {
    process.env.E05_RECIPES_ENABLED = 'true';
    const sections = await loadRecipeSections([RESTAURANT]);
    expect(filters).toContain('recipes.visibility=published');
    expect(filters).toContain(`saved_recipes.user_id=${USER}`);
    const cards = sections.byRestaurantId[RESTAURANT] ?? [];
    expect(cards.map((card) => card.id)).toEqual([PUBLISHED, CONFLICTING]);
    expect(cards[0]).toMatchObject({
      typeLabel: 'Inspired-by home recipe',
      demoLabel: 'Demo content',
      uncertaintyLine: "An at-home take, not the restaurant's recipe",
      servings: 2,
      estMinutes: 25,
      saved: true,
      dietaryWarning: null,
      checkedAtLabel: expect.stringMatching(/^Jan 15, 2026, 12:00 PM /),
    });
    expect(cards[0]?.ingredients[0]).toEqual({ name: 'Demo beans', quantity: '1', unit: 'cup' });
    expect(cards[0]?.steps[0]?.text).toBe('Stir the demo beans.');
    expect(cards[0]?.substitutions[0]).toEqual({ insteadOf: 'Demo beans', use: 'Demo lentils' });
    expect(cards[1]?.dietaryWarning).toContain('cheese');
    expect(cards[1]?.dietaryWarning?.toLowerCase()).not.toMatch(/safe/);
    expect(sections.exclusionLine).toContain('vegan');
    expect(sections.exclusionLine).toContain('peanut');

    const saved = await loadSavedRecipes();
    expect(saved.enabled).toBe(true);
    if (saved.enabled) {
      expect(saved.recipes.some((card) => card.id === DRAFT)).toBe(false);
      expect(saved.recipes.find((card) => card.id === PUBLISHED)?.saved).toBe(true);
    }
  });

  it('drops a draft row even if a query returns it', () => {
    const card = toRecipeCard(
      row({ visibility: 'draft' }) as unknown as Parameters<typeof toRecipeCard>[0],
      new Set(),
      null,
      null,
    );
    expect(card).toBeNull();
    const menuDraft = toRecipeCard(
      row({
        visibility: 'draft',
        source_kind: 'public_menu',
        source_url: 'https://example.com/menu',
        description: 'A home skillet of beans with smoked paprika.',
        menu_wording: 'paraphrase',
        retrieved_at: '2026-01-15T18:00:00.000Z',
        is_demo: false,
      }) as unknown as Parameters<typeof toRecipeCard>[0],
      new Set(),
      null,
      null,
    );
    expect(menuDraft).toBeNull();
    const broken = toRecipeCard(
      row({ ingredients: { name: 'nope' } as unknown as Json }) as unknown as Parameters<typeof toRecipeCard>[0],
      new Set(),
      null,
      null,
    );
    expect(broken).toBeNull();
  });
});
