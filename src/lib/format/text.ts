/**
 * Noun for a count. 1 is singular. 0 and every other count are plural.
 * `plural` defaults to `singular` plus "s".
 */
export function pluralNoun(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

/** Count plus noun. Same singular rule as `pluralNoun`. */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${pluralNoun(count, singular, plural)}`;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

/**
 * One-pass HTML entity decode for display text. Already-decoded characters
 * are left as they are. Unknown entities are left as they are.
 */
export function decodeEntities(value: string): string {
  return value.replace(/&(#(?:x[0-9a-fA-F]+|\d+)|[a-zA-Z]+);/g, (entity, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = hex ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return entity;
      try {
        return String.fromCodePoint(code);
      } catch {
        return entity;
      }
    }
    return NAMED_ENTITIES[body] ?? entity;
  });
}
