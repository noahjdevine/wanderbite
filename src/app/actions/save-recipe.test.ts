import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireUser = vi.fn();
const limit = vi.fn();
const insert = vi.fn();
const deleteEq = vi.fn();
const maybeSingle = vi.fn();
const revalidatePath = vi.fn();

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));

vi.mock('@/lib/auth/require-user', () => ({
  requireUser: () => requireUser(),
}));

vi.mock('@/lib/ratelimit', () => ({
  evaluateRecipeSaveLimit: (...args: unknown[]) => limit(...args),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table === 'saved_recipes') {
        return {
          insert: (...args: unknown[]) => insert(...args),
          delete: () => ({
            eq: () => ({
              eq: (...args: unknown[]) => deleteEq(...args),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle }),
          }),
        }),
      };
    },
  }),
}));

import { setSavedRecipe } from '@/app/actions/save-recipe';

const USER = '11111111-1111-4111-8111-111111111111';
const RECIPE = '33333333-3333-4333-8333-333333333333';

describe('setSavedRecipe', () => {
  beforeEach(() => {
    requireUser.mockReset();
    limit.mockReset();
    insert.mockReset();
    deleteEq.mockReset();
    maybeSingle.mockReset();
    revalidatePath.mockReset();
    delete process.env.E05_RECIPES_ENABLED;
    requireUser.mockResolvedValue({ ok: true, userId: USER, email: null });
    limit.mockResolvedValue('allowed');
    maybeSingle.mockResolvedValue({
      data: { id: RECIPE, version: 3, visibility: 'published' },
      error: null,
    });
    insert.mockResolvedValue({ error: null });
    deleteEq.mockResolvedValue({ error: null });
  });

  it('does nothing while the flag is off', async () => {
    await expect(setSavedRecipe(RECIPE, true)).resolves.toEqual({
      ok: false,
      error: 'Recipes are not available.',
    });
    expect(requireUser).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('requires the session and ignores a missing recipe id', async () => {
    process.env.E05_RECIPES_ENABLED = 'true';
    requireUser.mockResolvedValue({ ok: false, error: 'You must be signed in.' });
    await expect(setSavedRecipe(RECIPE, true)).resolves.toEqual({
      ok: false,
      error: 'You must be signed in.',
    });
    expect(insert).not.toHaveBeenCalled();

    requireUser.mockResolvedValue({ ok: true, userId: USER, email: null });
    await expect(setSavedRecipe('not-a-recipe', true)).resolves.toEqual({
      ok: false,
      error: 'That recipe is not available.',
    });
    expect(limit).not.toHaveBeenCalled();
  });

  it('saves and unsaves only the signed-in member, and a repeat save is success', async () => {
    process.env.E05_RECIPES_ENABLED = 'true';
    await expect(setSavedRecipe(RECIPE, true)).resolves.toEqual({ ok: true });
    expect(limit).toHaveBeenCalledWith(USER);
    expect(insert).toHaveBeenCalledWith({
      user_id: USER,
      recipe_id: RECIPE,
      recipe_version: 3,
    });

    insert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } });
    await expect(setSavedRecipe(RECIPE, true)).resolves.toEqual({ ok: true });

    await expect(setSavedRecipe(RECIPE, false)).resolves.toEqual({ ok: true });
    expect(deleteEq).toHaveBeenCalledWith('recipe_id', RECIPE);
  });

  it('stops when the limiter is unavailable', async () => {
    process.env.E05_RECIPES_ENABLED = 'true';
    limit.mockResolvedValue('unavailable');
    await expect(setSavedRecipe(RECIPE, true)).resolves.toEqual({
      ok: false,
      error: 'Please wait a moment and try again.',
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it('does not accept a caller user id or touch credits and visits', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/app/actions/save-recipe.ts'), 'utf8');
    expect(source).toMatch(/export async function setSavedRecipe\(\s*recipeId: string,\s*saved: boolean,/);
    expect(source).not.toMatch(/userId:\s*string/);
    expect(source).not.toMatch(/entitlement_credits|redemptions|challenge_items|user_badges|offer_versions/);
    const loader = readFileSync(path.join(process.cwd(), 'src/lib/recipes/load.ts'), 'utf8');
    expect(loader).not.toMatch(/restaurant-safety|eligible-candidates|entitlement_credits|from\('redemptions'\)|from\('challenge_items'\)/);
  });
});
