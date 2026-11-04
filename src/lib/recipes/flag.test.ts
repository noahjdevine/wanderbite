import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  logRecipesReadFailedOnce,
  logRecipesSaveFailedOnce,
  logRecipesUnavailableOnce,
  recipeQaEnabled,
  recipeSchemaMissing,
  recipesEnabled,
  resetRecipesLogs,
} from '@/lib/recipes/flag';

describe('recipes flag', () => {
  beforeEach(() => {
    resetRecipesLogs();
    vi.restoreAllMocks();
  });

  it('stays off unless the env value is exactly true', () => {
    expect(recipesEnabled(undefined)).toBe(false);
    expect(recipesEnabled('')).toBe(false);
    expect(recipesEnabled('TRUE')).toBe(false);
    expect(recipesEnabled('1')).toBe(false);
    expect(recipesEnabled('true')).toBe(true);
    expect(recipeQaEnabled(undefined, 'true')).toBe(false);
    expect(recipeQaEnabled('true', undefined)).toBe(false);
    expect(recipeQaEnabled('TRUE', 'true')).toBe(false);
    expect(recipeQaEnabled('true', 'TRUE')).toBe(false);
    expect(recipeQaEnabled('true', 'true')).toBe(true);
  });

  it('logs a static line with no user id', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logRecipesUnavailableOnce();
    logRecipesUnavailableOnce();
    logRecipesReadFailedOnce();
    logRecipesReadFailedOnce();
    logRecipesSaveFailedOnce();
    expect(warn.mock.calls.map((call) => call[0])).toEqual([
      '[recipes] unavailable',
      '[recipes] read failed',
      '[recipes] save failed',
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  it('recognizes a missing recipes table', () => {
    expect(recipeSchemaMissing({ code: 'PGRST205', message: 'schema cache' })).toBe(true);
    expect(recipeSchemaMissing({ code: '42501', message: 'recipe is not published' })).toBe(false);
  });
});
