/** Contiguous word run that counts as copied menu prose. */
export const MENU_OVERLAP_RUN = 6;

const ALLERGEN_CLAIM = /\ballergen-safe\b|\ballergy-safe\b|\bsafe for\b/i;

export function menuWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function normalizeMenuTitle(title: string): string {
  return menuWords(title).join(' ');
}

/**
 * Reject a description that repeats the menu description exactly, contains a
 * short menu description whole, or shares a 6-word run with the menu prose.
 */
export function descriptionCopiesMenu(description: string, menuDescription: string, menuProse: string): boolean {
  const desc = menuWords(description);
  const source = menuWords(menuDescription);
  if (desc.length === 0) return false;
  if (source.length > 0 && desc.join(' ') === source.join(' ')) return true;
  if (source.length >= 4 && source.length < MENU_OVERLAP_RUN) {
    if (desc.join(' ').includes(source.join(' '))) return true;
  }
  const prose = menuWords(menuProse);
  if (desc.length < MENU_OVERLAP_RUN || prose.length < MENU_OVERLAP_RUN) return false;
  const runs = new Set<string>();
  for (let i = 0; i <= prose.length - MENU_OVERLAP_RUN; i += 1) {
    runs.add(prose.slice(i, i + MENU_OVERLAP_RUN).join(' '));
  }
  for (let i = 0; i <= desc.length - MENU_OVERLAP_RUN; i += 1) {
    if (runs.has(desc.slice(i, i + MENU_OVERLAP_RUN).join(' '))) return true;
  }
  return false;
}

export function claimsAllergenSafe(text: string): boolean {
  return ALLERGEN_CLAIM.test(text);
}
