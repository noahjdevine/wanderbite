import { describe, expect, it } from 'vitest';
import {
  DISCOVER_CARD_FACT_LIMIT,
  DISCOVER_FACT_PROMPT_NOTE,
  DISCOVER_PROMPT_FACT_CHARS,
  discoverCardFacts,
  discoverPromptFacts,
  presentDiscoverCardFacts,
} from '@/lib/discover/briefing-facts';
import { formatBriefingChecked, type BriefingFact } from '@/lib/briefings/types';

const CHECKED = '2026-11-05T06:00:00.000Z';
const MAPS = 'https://maps.google.com/maps/place/fact';
const SOURCE = 'https://example.com/fact';

function fact(overrides: Partial<BriefingFact> = {}): BriefingFact {
  return {
    field: 'vibe',
    label: 'Vibe',
    text: 'The room is cozy and candlelit.',
    sourceUrl: SOURCE,
    lastVerifiedAt: CHECKED,
    sampleLabel: null,
    ...overrides,
  };
}

describe('discover card facts', () => {
  it('shows at most two in Known for, Vibe, Good for order', () => {
    const shown = discoverCardFacts([
      fact({ field: 'seating', label: 'Seating', text: 'There is a covered patio.' }),
      fact({ field: 'good_for', label: 'Good for', text: 'Good for a quiet date.' }),
      fact({ field: 'vibe', label: 'Wrong', text: 'The room is cozy and candlelit.' }),
      fact({
        field: 'known_for',
        label: 'Wrong',
        text: 'Known for brisket.',
        sourceUrl: MAPS,
      }),
      fact({ field: 'parking', label: 'Parking', text: 'The lot is behind the building.' }),
      fact({
        field: 'reservations',
        label: 'Reservations',
        text: 'Walk-ins are welcome.',
      }),
    ]);
    expect(DISCOVER_CARD_FACT_LIMIT).toBe(2);
    expect(shown.map((item) => item.field)).toEqual(['known_for', 'vibe']);
    expect(shown.map((item) => item.label)).toEqual(['Known for', 'Vibe']);
    expect(shown[0]?.sourceUrl).toBe(MAPS);
    expect(formatBriefingChecked(shown[0]?.lastVerifiedAt)).toBe('Nov 5, 2026');
    expect(JSON.stringify(shown)).not.toContain('patio');
    expect(JSON.stringify(shown)).not.toContain('date');
    expect(JSON.stringify(shown)).not.toContain('Parking');
    expect(JSON.stringify(shown)).not.toContain('Walk-ins');
    expect(JSON.stringify(shown)).not.toContain('Sample');
  });

  it('skips a missing line and still fills two when a later line exists', () => {
    const shown = discoverCardFacts([
      fact({ field: 'good_for', label: 'Good for', text: 'Good for a quiet date.' }),
      fact({ field: 'vibe', text: 'The room is cozy and candlelit.' }),
    ]);
    expect(shown.map((item) => item.field)).toEqual(['vibe', 'good_for']);
  });

  it('drops samples, unsourced rows, empty text, and overlong text', () => {
    const shown = discoverCardFacts([
      fact({ field: 'known_for', text: 'Known for brisket.', sampleLabel: 'Sample' }),
      fact({ field: 'vibe', text: '   ' }),
      fact({ field: 'good_for', text: 'G'.repeat(401) }),
      fact({ field: 'vibe', text: 'Real vibe.', sourceUrl: 'http://example.com/nope' }),
      fact({ field: 'good_for', text: 'Real good for.', lastVerifiedAt: 'not-a-date' }),
    ]);
    expect(shown).toEqual([]);
    expect(presentDiscoverCardFacts(null)).toEqual([]);
    expect(presentDiscoverCardFacts({ field: 'known_for' })).toEqual([]);
  });

  it('keeps a stored sentence that is longer than the prompt clip', () => {
    const text = `${'p'.repeat(DISCOVER_PROMPT_FACT_CHARS)}UNIQUE_TAIL`;
    const shown = discoverCardFacts([fact({ field: 'known_for', label: 'Known for', text })]);
    expect(shown).toHaveLength(1);
    expect(shown[0]?.text).toBe(text);
  });
});

describe('discover prompt facts', () => {
  it('clips bodies, omits empty keys, and leaves source urls out', () => {
    const vibe = `${'p'.repeat(DISCOVER_PROMPT_FACT_CHARS)}UNIQUE_TAIL`;
    const record = discoverPromptFacts([
      fact({ field: 'vibe', text: vibe, sourceUrl: MAPS }),
      fact({ field: 'known_for', text: 'Known for brisket.', sourceUrl: SOURCE }),
      fact({ field: 'good_for', text: '   ' }),
      fact({ field: 'seating', text: 'There is a covered patio.', sourceUrl: SOURCE }),
      fact({ field: 'parking', text: 'The lot is behind the building.' }),
      fact({ field: 'reservations', text: 'Walk-ins are welcome.', sampleLabel: 'Sample' }),
    ]);
    expect(record).toEqual({
      vibe: 'p'.repeat(DISCOVER_PROMPT_FACT_CHARS),
      known_for: 'Known for brisket.',
      seating: 'There is a covered patio.',
    });
    expect(record && 'good_for' in record).toBe(false);
    expect(JSON.stringify(record)).not.toContain('UNIQUE_TAIL');
    expect(JSON.stringify(record)).not.toContain('http');
    expect(JSON.stringify(record)).not.toContain(MAPS);
    expect(JSON.stringify(record)).not.toContain('Sample');
  });

  it('returns undefined for empty input and for notes that cannot be used', () => {
    expect(discoverPromptFacts([])).toBeUndefined();
    expect(
      discoverPromptFacts([
        fact({ text: 'Sample vibe.', sampleLabel: 'Sample' }),
        fact({ field: 'seating', text: 'Patio.', sourceUrl: 'notaurl' }),
      ]),
    ).toBeUndefined();
  });

  it('tells the model that a missing note is unknown', () => {
    expect(DISCOVER_FACT_PROMPT_NOTE).toContain('researched notes');
    expect(DISCOVER_FACT_PROMPT_NOTE).toContain('match the request');
    expect(DISCOVER_FACT_PROMPT_NOTE).toContain('missing fact is unknown, not a no');
    expect(DISCOVER_FACT_PROMPT_NOTE).toContain('hours, noise, availability, or allergy safety');
    expect(DISCOVER_FACT_PROMPT_NOTE).not.toContain('http');
  });
});
