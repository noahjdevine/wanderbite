import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOTE_MAX } from '@/lib/notes/note-rules';
import {
  REFLECTION_LIMITS,
  buildGoogleReviewHandoff,
  composePublicNotePublishPlan,
  validateReflectionFields,
  type ReflectionFields,
} from '@/lib/notes/reflection';

const ROOT = path.resolve(__dirname, '../../..');
const PLACE_ID = 'ChIJN1t_tDeuEmsRUsoyG83frY4';
const WRITEREVIEW = `https://search.google.com/local/writereview?placeid=${PLACE_ID}`;
const DRAFT = 'The lamb was perfect and I would return tomorrow';

function fieldsOk(input: unknown): ReflectionFields {
  const result = validateReflectionFields(input);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  return result.fields;
}

describe('validateReflectionFields', () => {
  it('returns trimmed fields inside the caps and does not invent a rating', () => {
    const fields = fieldsOk({
      favorite_bite: '  lamb chops  ',
      atmosphere: '  quiet room  ',
      return_interest: ' maybe ',
      companion_label: '  Sam  ',
      unpublished_review_draft: `  ${'a'.repeat(20)}  `,
      rating: 5,
      sentiment: 'loved it',
    });
    expect(fields).toEqual({
      favorite_bite: 'lamb chops',
      atmosphere: 'quiet room',
      return_interest: 'maybe',
      companion_label: 'Sam',
      unpublished_review_draft: 'a'.repeat(20),
    });
    expect(fields).not.toHaveProperty('rating');
    expect(fields).not.toHaveProperty('sentiment');
    expect(JSON.stringify(fields)).not.toContain('loved it');
  });

  it('accepts each cap exactly and treats blank text as null', () => {
    const fields = fieldsOk({
      favorite_bite: 'b'.repeat(REFLECTION_LIMITS.favorite_bite),
      atmosphere: 'c'.repeat(REFLECTION_LIMITS.atmosphere),
      return_interest: null,
      companion_label: ' ',
      unpublished_review_draft: 'd'.repeat(REFLECTION_LIMITS.unpublished_review_draft),
    });
    expect(fields.favorite_bite).toHaveLength(120);
    expect(fields.atmosphere).toHaveLength(280);
    expect(fields.companion_label).toBeNull();
    expect(fields.return_interest).toBeNull();
    expect(fields.unpublished_review_draft).toHaveLength(1500);
  });

  it('refuses an unpublished draft over the cap without truncating it', () => {
    const draft = 'e'.repeat(REFLECTION_LIMITS.unpublished_review_draft + 1);
    const result = validateReflectionFields({ unpublished_review_draft: draft });
    expect(result).toEqual({
      ok: false,
      code: 'too_long',
      field: 'unpublished_review_draft',
    });
    expect(JSON.stringify(result)).not.toContain(draft.slice(0, 20));
    expect(JSON.stringify(result)).not.toContain('e'.repeat(REFLECTION_LIMITS.unpublished_review_draft));
  });

  it('refuses control characters before a length check', () => {
    expect(
      validateReflectionFields({ favorite_bite: 'lamb\nchops' }),
    ).toEqual({ ok: false, code: 'invalid_text', field: 'favorite_bite' });
    expect(
      validateReflectionFields({ atmosphere: 'quiet\u0000room' }),
    ).toEqual({ ok: false, code: 'invalid_text', field: 'atmosphere' });
    expect(
      validateReflectionFields({ companion_label: 'Sam\u007f' }),
    ).toEqual({ ok: false, code: 'invalid_text', field: 'companion_label' });
    expect(
      validateReflectionFields({
        unpublished_review_draft: `${'a'.repeat(REFLECTION_LIMITS.unpublished_review_draft)}\n`,
      }),
    ).toEqual({
      ok: false,
      code: 'invalid_text',
      field: 'unpublished_review_draft',
    });
  });

  it('refuses a return interest outside yes, maybe, and no', () => {
    expect(fieldsOk({ return_interest: 'yes' }).return_interest).toBe('yes');
    expect(fieldsOk({ return_interest: 'no' }).return_interest).toBe('no');
    expect(validateReflectionFields({ return_interest: 'Yes' })).toEqual({
      ok: false,
      code: 'invalid_return_interest',
      field: 'return_interest',
    });
    expect(validateReflectionFields({ return_interest: 'soon' })).toEqual({
      ok: false,
      code: 'invalid_return_interest',
      field: 'return_interest',
    });
    expect(validateReflectionFields({ return_interest: 1 })).toEqual({
      ok: false,
      code: 'invalid_return_interest',
      field: 'return_interest',
    });
    expect(validateReflectionFields({ return_interest: 'yes\n' })).toEqual({
      ok: false,
      code: 'invalid_return_interest',
      field: 'return_interest',
    });
  });

  it('reports the first invalid field in documented order', () => {
    expect(
      validateReflectionFields({
        favorite_bite: 'ok',
        atmosphere: 4,
        return_interest: 'soon',
      }),
    ).toEqual({ ok: false, code: 'invalid_text', field: 'atmosphere' });
    expect(validateReflectionFields(null)).toEqual({ ok: false, code: 'invalid_input' });
    expect(validateReflectionFields([])).toEqual({ ok: false, code: 'invalid_input' });
  });
});

describe('buildGoogleReviewHandoff', () => {
  it('builds an https writereview URL from a place id and drops the draft', () => {
    const result = buildGoogleReviewHandoff({
      googlePlaceId: `  ${PLACE_ID}  `,
      mapsHttpsUrl: `https://www.google.com/maps/place/Cafe?review=${encodeURIComponent(DRAFT)}`,
      unpublished_review_draft: DRAFT,
    });
    expect(result).toEqual({ ok: true, url: WRITEREVIEW, source: 'place_id' });
    if (!result.ok) throw new Error(result.code);
    expect(result.url.startsWith('https://')).toBe(true);
    expect(result.url).not.toContain(DRAFT);
    expect(result.url).not.toContain('lamb');
    expect(result.url).not.toContain('review=');
    expect(result.url).not.toContain('maps/place');
  });

  it('refuses http and does not upgrade it to https', () => {
    const result = buildGoogleReviewHandoff({
      mapsHttpsUrl: 'http://www.google.com/maps/place/Cafe',
    });
    expect(result).toEqual({ ok: false, code: 'insecure_url' });
    expect(JSON.stringify(result)).not.toContain('https://');
    expect(
      buildGoogleReviewHandoff({ mapsHttpsUrl: 'HTTP://maps.google.com/maps' }),
    ).toEqual({ ok: false, code: 'insecure_url' });
  });

  it('does not fall through from a bad place id to a maps URL', () => {
    expect(
      buildGoogleReviewHandoff({
        googlePlaceId: 'not a place',
        mapsHttpsUrl: 'https://www.google.com/maps/place/Cafe',
      }),
    ).toEqual({ ok: false, code: 'invalid_place_id' });
    expect(
      buildGoogleReviewHandoff({
        googlePlaceId: PLACE_ID,
        mapsHttpsUrl: 'http://www.google.com/maps/place/Cafe',
      }),
    ).toEqual({ ok: true, url: WRITEREVIEW, source: 'place_id' });
  });

  it('accepts an https Maps URL without adding review text', () => {
    const result = buildGoogleReviewHandoff({
      mapsHttpsUrl: '  https://www.google.com/maps/place/Cafe?query=Cafe  ',
      unpublished_review_draft: DRAFT,
    });
    expect(result).toEqual({
      ok: true,
      url: 'https://www.google.com/maps/place/Cafe?query=Cafe',
      source: 'maps_url',
    });
    if (!result.ok) throw new Error(result.code);
    expect(result.url).not.toContain('lamb');
    expect(
      buildGoogleReviewHandoff({
        mapsHttpsUrl: 'https://maps.google.com/maps?cid=123',
      }),
    ).toEqual({
      ok: true,
      url: 'https://maps.google.com/maps?cid=123',
      source: 'maps_url',
    });
    expect(
      buildGoogleReviewHandoff({
        mapsHttpsUrl: 'https://maps.app.goo.gl/AbCd12',
      }),
    ).toEqual({
      ok: true,
      url: 'https://maps.app.goo.gl/AbCd12',
      source: 'maps_url',
    });
  });

  it('refuses a review-text query, a credential, a bad host, and a missing destination', () => {
    expect(
      buildGoogleReviewHandoff({
        mapsHttpsUrl: `https://www.google.com/maps/place/Cafe?review=${encodeURIComponent(DRAFT)}`,
      }),
    ).toEqual({ ok: false, code: 'invalid_url' });
    expect(
      buildGoogleReviewHandoff({
        mapsHttpsUrl: 'https://user:pass@www.google.com/maps/place/Cafe',
      }),
    ).toEqual({ ok: false, code: 'invalid_url' });
    expect(JSON.stringify(
      buildGoogleReviewHandoff({
        mapsHttpsUrl: 'https://user:pass@www.google.com/maps/place/Cafe',
      }),
    )).not.toContain('pass');
    expect(
      buildGoogleReviewHandoff({ mapsHttpsUrl: 'https://yelp.com/biz/cafe' }),
    ).toEqual({ ok: false, code: 'disallowed_host' });
    expect(
      buildGoogleReviewHandoff({ mapsHttpsUrl: 'https://www.google.co.uk/maps/place/Cafe' }),
    ).toEqual({ ok: false, code: 'disallowed_host' });
    expect(
      buildGoogleReviewHandoff({ mapsHttpsUrl: 'https://www.google.com/search?q=Cafe' }),
    ).toEqual({ ok: false, code: 'invalid_url' });
    expect(buildGoogleReviewHandoff({})).toEqual({ ok: false, code: 'missing_destination' });
    expect(buildGoogleReviewHandoff({ googlePlaceId: '   ', mapsHttpsUrl: ' ' })).toEqual({
      ok: false,
      code: 'missing_destination',
    });
    expect(
      buildGoogleReviewHandoff({ mapsHttpsUrl: 'javascript:alert(1)' }),
    ).toEqual({ ok: false, code: 'invalid_url' });
  });
});

describe('composePublicNotePublishPlan', () => {
  it('plans a public bite note and does not copy reflection fields', () => {
    const result = composePublicNotePublishPlan({
      rating: 4,
      publicNote: '  A short public line  ',
      fromReflection: {
        favorite_bite: DRAFT,
        atmosphere: DRAFT,
        return_interest: 'yes',
        companion_label: 'Sam',
        unpublished_review_draft: DRAFT,
      },
    });
    expect(result).toEqual({
      ok: true,
      write: { note: 'A short public line', rating: 4, is_public: true },
      copiedFromReflection: false,
    });
    expect(JSON.stringify(result)).not.toContain(DRAFT);
    expect(JSON.stringify(result)).not.toContain('lamb');
  });

  it('allows a note at NOTE_MAX and an empty note', () => {
    expect(NOTE_MAX).toBe(280);
    const atCap = composePublicNotePublishPlan({
      rating: 1,
      publicNote: 'n'.repeat(NOTE_MAX),
    });
    expect(atCap).toEqual({
      ok: true,
      write: { note: 'n'.repeat(NOTE_MAX), rating: 1, is_public: true },
      copiedFromReflection: false,
    });
    const empty = composePublicNotePublishPlan({ rating: 5, publicNote: '   ' });
    expect(empty.ok).toBe(true);
    if (!empty.ok) throw new Error(empty.code);
    expect(empty.write.note).toBeNull();
  });

  it('refuses a public note longer than NOTE_MAX without truncating it', () => {
    const note = 'p'.repeat(NOTE_MAX + 1);
    const result = composePublicNotePublishPlan({ rating: 3, publicNote: note });
    expect(result).toEqual({ ok: false, code: 'too_long' });
    expect(JSON.stringify(result)).not.toContain('p'.repeat(20));
  });

  it('refuses a rating outside 1 to 5 and a non-integer', () => {
    expect(composePublicNotePublishPlan({ rating: 0, publicNote: 'Hi' })).toEqual({
      ok: false,
      code: 'invalid_rating',
    });
    expect(composePublicNotePublishPlan({ rating: 6, publicNote: 'Hi' })).toEqual({
      ok: false,
      code: 'invalid_rating',
    });
    expect(composePublicNotePublishPlan({ rating: 3.5, publicNote: 'Hi' })).toEqual({
      ok: false,
      code: 'invalid_rating',
    });
    expect(composePublicNotePublishPlan({ rating: '5', publicNote: 'Hi' })).toEqual({
      ok: false,
      code: 'invalid_rating',
    });
    expect(composePublicNotePublishPlan({ rating: 2, publicNote: 'Hi\nthere' })).toEqual({
      ok: false,
      code: 'invalid_text',
    });
    expect(composePublicNotePublishPlan({ rating: 2, fromReflection: 'nope' })).toEqual({
      ok: false,
      code: 'invalid_text',
    });
    expect(
      composePublicNotePublishPlan({ rating: 2, publicNote: 'Hi', fromReflection: 'nope' }),
    ).toEqual({ ok: false, code: 'invalid_reflection' });
  });
});

describe('reflection module boundary', () => {
  it('does not import the app, call a provider, or write a database', () => {
    const source = readFileSync(path.join(ROOT, 'src/lib/notes/reflection.ts'), 'utf8');
    expect(source).toContain('NOTE_MAX');
    expect(source).not.toMatch(
      /from ['"]@\/app|from ['"]next|supabase|use server|fetch\(|process\.env|anthropic|openai|azure|posthog/i,
    );
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name)) continue;
        const text = readFileSync(full, 'utf8');
        if (text.includes('@/lib/notes/reflection') || text.includes('lib/notes/reflection')) {
          hits.push(full);
        }
      }
    };
    walk(path.join(ROOT, 'src/app'));
    expect(hits.map((hit) => path.relative(ROOT, hit))).toEqual([
      'src/app/actions/journal-reflections.ts',
    ]);
    const action = readFileSync(hits[0] ?? '', 'utf8');
    expect(action).toContain('validateReflectionFields');
    expect(action).toContain('buildGoogleReviewHandoff');
    expect(action).not.toContain('composePublicNotePublishPlan');
    expect(action).not.toMatch(/fetch\(|anthropic|openai|azure/i);
  });
});
