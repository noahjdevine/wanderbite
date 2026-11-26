export type NoteSegment = {
  text: string;
  isName: boolean;
};

const APOSTROPHE_CLASS = "['\u2018\u2019\u201A\u201B\u2032]";
const QUOTE_CLASS = '["\u201C\u201D\u201E\u201F]';
const DASH_CLASS = '[\u2010\u2011\u2012\u2013\u2014\u2015\u2212-]';

type Span = { start: number; end: number };

/** Pattern for one name. Quote and dash characters match either style. */
function namePattern(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return trimmed
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/['\u2018\u2019\u201A\u201B\u2032]/g, APOSTROPHE_CLASS)
    .replace(/["\u201C\u201D\u201E\u201F]/g, QUOTE_CLASS)
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212-]/g, DASH_CLASS);
}

function overlaps(spans: readonly Span[], start: number, end: number): boolean {
  return spans.some((span) => start < span.end && end > span.start);
}

/**
 * Split body on the original string so segment offsets stay correct.
 * Longer names win. Matches are case-insensitive and stop at Unicode
 * letter or number boundaries, same idea as phraseInFolded.
 */
export function splitNoteByNames(body: string, names: readonly string[]): NoteSegment[] {
  const ranked = names
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .sort((left, right) => right.length - left.length || left.localeCompare(right));
  const spans: Span[] = [];
  const seenPatterns = new Set<string>();
  for (const name of ranked) {
    const pattern = namePattern(name);
    if (!pattern || seenPatterns.has(pattern)) continue;
    seenPatterns.add(pattern);
    const expression = new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, 'giu');
    for (const match of body.matchAll(expression)) {
      const start = match.index;
      if (start == null) continue;
      const end = start + match[0].length;
      if (end <= start || overlaps(spans, start, end)) continue;
      spans.push({ start, end });
    }
  }
  if (spans.length === 0) return [{ text: body, isName: false }];
  spans.sort((left, right) => left.start - right.start);
  const segments: NoteSegment[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) segments.push({ text: body.slice(cursor, span.start), isName: false });
    segments.push({ text: body.slice(span.start, span.end), isName: true });
    cursor = span.end;
  }
  if (cursor < body.length) segments.push({ text: body.slice(cursor), isName: false });
  return segments;
}
