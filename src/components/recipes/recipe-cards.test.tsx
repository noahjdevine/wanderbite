import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecipeCardModel } from '@/lib/recipes/display';
import { RECIPES_SECTION_HEADING } from '@/lib/recipes/display';

const save = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock('@/app/actions/save-recipe', () => ({
  setSavedRecipe: (...args: unknown[]) => save(...args),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { RecipeCards } from '@/components/recipes/recipe-cards';

function card(overrides: Partial<RecipeCardModel> = {}): RecipeCardModel {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    slug: 'demo-skillet-beans',
    title: 'Demo skillet beans',
    recipeType: 'inspired_by',
    typeLabel: 'Inspired-by home recipe',
    restaurantId: '22222222-2222-4222-8222-222222222222',
    servings: 2,
    estMinutes: 25,
    ingredients: [{ name: 'Demo beans', quantity: '1', unit: 'cup' }],
    steps: [{ order: 1, text: 'Stir the demo beans.' }],
    substitutions: [{ insteadOf: 'Demo beans', use: 'Demo lentils' }],
    dietaryTags: ['beans'],
    sourceUrl: null,
    sourceName: 'Wanderbite demo collection',
    rightsBasis: 'original',
    checkedAtLabel: 'Jan 15, 2026, 12:00 PM CST',
    version: 1,
    isDemo: true,
    demoLabel: 'Demo content',
    uncertaintyLine: "An at-home take, not the restaurant's recipe",
    dietaryWarning: 'This recipe overlaps an allergy you listed. This does not check allergens.',
    saved: false,
    ...overrides,
  };
}

describe('recipe cards', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    save.mockReset();
    refresh.mockReset();
    save.mockResolvedValue({ ok: true });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
  });

  async function render(node: ReactElement) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(node);
    });
    return container;
  }

  it('renders the visit section with the demo label and no safety claim', async () => {
    const view = await render(
      <RecipeCards
        headingId="recipes-test"
        heading={RECIPES_SECTION_HEADING}
        exclusionLine="Your listed dietary exclusions: vegan."
        recipes={[card()]}
      />,
    );
    const text = view.textContent ?? '';
    expect(text).toContain('Recipes inspired by this visit');
    expect(text).toContain('Demo content');
    expect(text).toContain('Inspired-by home recipe');
    expect(text).toContain('Serves 2');
    expect(text).toContain('25 min');
    expect(text).toContain('1 cup Demo beans');
    expect(text).toContain('Stir the demo beans.');
    expect(text).toContain('Demo lentils instead of Demo beans');
    expect(text).toContain('Wanderbite demo collection');
    expect(text).toContain('Checked Jan 15, 2026, 12:00 PM CST');
    expect(text).toContain("An at-home take, not the restaurant's recipe");
    expect(text).toContain('Your listed dietary exclusions: vegan.');
    expect(text).toContain('This does not check allergens.');
    expect(text.toLowerCase()).not.toMatch(/safe/);
  });

  it('renders nothing when the restaurant has no published recipes', async () => {
    const view = await render(
      <RecipeCards
        headingId="recipes-empty"
        heading={RECIPES_SECTION_HEADING}
        exclusionLine={null}
        recipes={[]}
      />,
    );
    expect(view.textContent).toBe('');
  });

  it('saves from the card', async () => {
    const view = await render(
      <RecipeCards
        headingId="recipes-save"
        heading={RECIPES_SECTION_HEADING}
        exclusionLine={null}
        recipes={[card()]}
      />,
    );
    const button = Array.from(view.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('Save recipe'),
    );
    if (!(button instanceof HTMLButtonElement)) throw new Error('missing save button');
    await act(async () => {
      button.click();
    });
    expect(save).toHaveBeenCalledWith('33333333-3333-4333-8333-333333333333', true);
  });
});
