/**
 * Client-safe place-name helpers. No Node or server imports.
 * note-copy.ts re-exports these so server callers keep the same path.
 */

/**
 * Branch cities a trailing place name can drop. Longer names are tried first
 * so "Lowry Crossing" is not read as a shorter city.
 */
const ACTIVITY_BRANCH_PLACES = [
  'Lowry Crossing',
  'Blue Ridge',
  'The Colony',
  'Little Elm',
  'Farmersville',
  'Carrollton',
  'Richardson',
  'McKinney',
  'Princeton',
  'Fairview',
  'Prosper',
  'Melissa',
  'Sherman',
  'Denton',
  'Dallas',
  'Frisco',
  'Murphy',
  'Celina',
  'Weston',
  'Plano',
  'Allen',
  'Wylie',
  'Lucas',
  'Anna',
] as const;

const BRANCH_NAME_STOP_WORDS = new Set(['of', 'in', 'at', 'the', 'for', 'de', 'and', '&']);

const BRANCH_PLACE_SOURCE = [...ACTIVITY_BRANCH_PLACES]
  .sort((left, right) => right.length - left.length)
  .map((place) => place.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'))
  .join('|');

const BRANCH_STATE = String.raw`(?:\s*,?\s*(?:TX|Texas))?`;
const SEPARATED_BRANCH_SUFFIX = new RegExp(
  String.raw`(?:\s*-\s*|\s*,\s*)(?:${BRANCH_PLACE_SOURCE})${BRANCH_STATE}$`,
  'i',
);
const SPACED_BRANCH_SUFFIX = new RegExp(
  String.raw`\s+(?:${BRANCH_PLACE_SOURCE})${BRANCH_STATE}$`,
  'i',
);

export function normalizeActivityNotePunctuation(value: string): string {
  return value
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripBranchSuffixOnce(name: string): string {
  const separated = name.replace(SEPARATED_BRANCH_SUFFIX, '').trim();
  if (separated && separated !== name) return separated;
  const spaced = name.replace(SPACED_BRANCH_SUFFIX, '').trim();
  if (!spaced || spaced === name) return name;
  const words = spaced.split(' ');
  if (words.length < 2) return name;
  const last = words[words.length - 1]?.toLowerCase() ?? '';
  if (BRANCH_NAME_STOP_WORDS.has(last)) return name;
  return spaced;
}

/** Short place name: normalized quotes and dashes, without a trailing branch city. */
export function activityDisplayName(officialName: string): string {
  let name = normalizeActivityNotePunctuation(officialName);
  for (let pass = 0; pass < 2; pass += 1) {
    const next = stripBranchSuffixOnce(name);
    if (next === name) break;
    name = next;
  }
  return name;
}
