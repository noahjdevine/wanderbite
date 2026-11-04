import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatCheckedAtChicago } from '@/lib/recipes/display';
import {
  buildMenuDraftRow,
  chicagoRetrievedAtLabel,
  menuDraftIdempotencyKey,
  menuRecipeSlug,
  toRecipeInsert,
  type MenuDraftRow,
  type MenuModelDish,
} from '@/lib/recipes/menu-row';

const RETRIEVED = '2026-01-15T18:00:00.000Z';
const SUMMER = '2026-07-15T17:00:00.000Z';
const MENU = 'White beans simmered with smoked paprika, garlic, and olive oil until the sauce turns glossy.';

function dish(overrides: Partial<MenuModelDish> = {}): MenuModelDish {
  return {
    menuDish: 'Skillet Beans',
    title: 'Weeknight skillet beans',
    description: 'A home pot of beans warmed with paprika and garlic.',
    servings: 4,
    estMinutes: 35,
    ingredients: [{ name: 'White beans', quantity: '2', unit: 'cup' }],
    steps: [{ order: 9, text: 'Warm the beans with paprika and garlic.' }],
    substitutions: [{ instead_of: 'White beans', use: 'Lentils' }],
    dietaryNotes: ['vegetarian'],
    ...overrides,
  };
}

function labelUnderTz(tz: string, iso: string): string {
  const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
  const result = spawnSync(
    tsx,
    [
      '-e',
      `import { formatCheckedAtChicago } from './src/lib/recipes/display.ts'; process.stdout.write(formatCheckedAtChicago(${JSON.stringify(iso)}));`,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, TZ: tz },
      encoding: 'utf8',
    },
  );
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

describe('menu draft rows', () => {
  it('stores retrieved_at as UTC and labels it in Chicago', () => {
    const built = buildMenuDraftRow({
      restaurantSlug: 'hutchins-bbq',
      restaurantId: '22222222-2222-4222-8222-222222222222',
      sourceUrl: 'https://menu.example/lunch',
      retrievedAt: RETRIEVED,
      menuDescription: MENU,
      menuProse: MENU,
      dish: dish(),
      takenSlugs: new Set(),
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.row.retrieved_at).toBe(RETRIEVED);
    expect(built.row.recipe_type).toBe('inspired_by');
    expect(built.row.source_kind).toBe('public_menu');
    expect(built.row.menu_wording).toBe('paraphrase');
    expect(built.row.visibility).toBe('draft');
    expect(built.row.is_demo).toBe(false);
    expect(built.row.rights_basis).toBe('original');
    expect(built.row.steps[0]?.order).toBe(1);
    expect(chicagoRetrievedAtLabel(built.row.retrieved_at)).toBe(formatCheckedAtChicago(RETRIEVED));
    expect(built.row.idempotency_key).toBe(
      menuDraftIdempotencyKey(built.row.restaurant_id ?? '', built.row.source_url, built.row.title),
    );
    const forged = toRecipeInsert({
      ...built.row,
      visibility: 'published',
      recipe_type: 'restaurant_approved',
    } as unknown as MenuDraftRow);
    expect(forged.visibility).toBe('draft');
    expect(forged.recipe_type).toBe('inspired_by');
    expect(forged.source_kind).toBe('public_menu');
    expect(forged.menu_wording).toBe('paraphrase');
  });

  it('rejects a copied description and an allergen-safe note', () => {
    const copied = buildMenuDraftRow({
      restaurantSlug: 'hutchins-bbq',
      restaurantId: null,
      sourceUrl: 'https://menu.example/lunch',
      retrievedAt: RETRIEVED,
      menuDescription: MENU,
      menuProse: MENU,
      dish: dish({ description: MENU }),
      takenSlugs: new Set(),
    });
    expect(copied.ok).toBe(false);
    if (!copied.ok) expect(copied.reason).toContain('copies a long run');
    const unsafe = buildMenuDraftRow({
      restaurantSlug: 'hutchins-bbq',
      restaurantId: null,
      sourceUrl: 'https://menu.example/lunch',
      retrievedAt: RETRIEVED,
      menuDescription: MENU,
      menuProse: MENU,
      dish: dish({ dietaryNotes: ['allergen-safe'] }),
      takenSlugs: new Set(),
    });
    expect(unsafe.ok).toBe(false);
  });

  it('keeps the Chicago label under UTC and America/Chicago', () => {
    const winter = formatCheckedAtChicago(RETRIEVED);
    const summer = formatCheckedAtChicago(SUMMER);
    for (const tz of ['UTC', 'America/Chicago']) {
      expect(labelUnderTz(tz, RETRIEVED)).toBe(winter);
      expect(labelUnderTz(tz, SUMMER)).toBe(summer);
    }
    expect(winter).toMatch(/^Jan 15, 2026, 12:00 PM /);
    expect(summer).toMatch(/^Jul 15, 2026, 12:00 PM /);
  });

  it('builds a slug that stays unique', () => {
    const taken = new Set(['menu-hutchins-bbq-weeknight-skillet-beans']);
    expect(menuRecipeSlug('hutchins-bbq', 'Weeknight skillet beans', taken)).toBe(
      'menu-hutchins-bbq-weeknight-skillet-beans-2',
    );
  });
});
