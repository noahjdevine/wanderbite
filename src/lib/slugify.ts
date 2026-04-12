/**
 * URL-safe slug from a restaurant name (lowercase, hyphenated).
 * @example "Ricks Chophouse" → "ricks-chophouse"
 * @example "Local Yocal BBQ & Grill" → "local-yocal-bbq-grill"
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
