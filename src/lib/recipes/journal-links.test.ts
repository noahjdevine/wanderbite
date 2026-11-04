import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireUser = vi.fn();
const from = vi.fn();

vi.mock('@/lib/auth/require-user', () => ({
  requireUser: () => requireUser(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from }),
}));

import { loadJournalSavedRecipeLinks } from '@/lib/recipes/journal-links';

const OWNER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RESTAURANT = '22222222-2222-4222-8222-222222222222';
const RECIPE = '33333333-3333-4333-8333-333333333333';

function query(table: string, filters: string[]) {
  const api = {
    select: () => api,
    eq: (column: string, value: string) => {
      filters.push(`${table}.${column}=${value}`);
      return api;
    },
    in: () => api,
    order: () => api,
    then: (
      resolve: (value: { data: unknown; error: null }) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => {
      void reject;
      if (table === 'saved_recipes') {
        const userFilter = filters.find((filter) => filter.startsWith('saved_recipes.user_id='));
        const userId = userFilter?.split('=')[1];
        if (userId !== OWNER) {
          return Promise.resolve(resolve({ data: [], error: null }));
        }
        return Promise.resolve(resolve({ data: [{ recipe_id: RECIPE }], error: null }));
      }
      return Promise.resolve(
        resolve({
          data: [
            {
              id: RECIPE,
              title: 'Demo skillet beans',
              restaurant_id: RESTAURANT,
              visibility: 'published',
            },
          ],
          error: null,
        }),
      );
    },
  };
  return api;
}

describe('journal saved recipe links', () => {
  const filters: string[] = [];

  beforeEach(() => {
    filters.length = 0;
    from.mockReset();
    requireUser.mockReset();
    delete process.env.E05_RECIPES_ENABLED;
    delete process.env.E05_RECIPE_QA_ENABLED;
    requireUser.mockResolvedValue({ ok: true, userId: OWNER, email: null });
    from.mockImplementation((table: string) => query(table, filters));
  });

  it('does not query when either flag is unset', async () => {
    process.env.E05_RECIPE_QA_ENABLED = 'true';
    await expect(loadJournalSavedRecipeLinks([RESTAURANT])).resolves.toEqual({});
    process.env.E05_RECIPES_ENABLED = 'true';
    delete process.env.E05_RECIPE_QA_ENABLED;
    await expect(loadJournalSavedRecipeLinks([RESTAURANT])).resolves.toEqual({});
    expect(from).not.toHaveBeenCalled();
    expect(requireUser).not.toHaveBeenCalled();
  });

  it('links only the signed-in member saves for that restaurant', async () => {
    process.env.E05_RECIPES_ENABLED = 'true';
    process.env.E05_RECIPE_QA_ENABLED = 'true';
    const links = await loadJournalSavedRecipeLinks([RESTAURANT]);
    expect(filters).toContain(`saved_recipes.user_id=${OWNER}`);
    expect(filters).toContain('recipes.visibility=published');
    expect(filters.join(' ')).not.toContain(OTHER);
    expect(links[RESTAURANT]).toEqual([{ id: RECIPE, title: 'Demo skillet beans' }]);

    filters.length = 0;
    requireUser.mockResolvedValue({ ok: true, userId: OTHER, email: null });
    const other = await loadJournalSavedRecipeLinks([RESTAURANT]);
    expect(other).toEqual({});
  });
});
