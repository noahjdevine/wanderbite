import { describe, expect, it } from 'vitest';
import {
  POOL_RESTART_LINE,
  cheaperChoiceLanded,
  cheaperVoiceLine,
  friendlyDiscoverLine,
  hardConstraintMisses,
  isRobotMemberCopy,
  selectMemberVoice,
  surpriseLine,
  vibeVoiceLine,
} from '@/lib/discover/voice';

const LINES = [
  "Bea's wild card: Taco House. Trust me on this one.",
  "Surprise! Tonight you're going to Taco House.",
  'Eyes closed, finger on the map... Taco House!',
] as const;

describe('surprise lines', () => {
  it('rotates the three surprise lines and never uses the closest-match sentence', () => {
    expect(surpriseLine('Taco House', 0)).toBe(LINES[0]);
    expect(surpriseLine('Taco House', 1)).toBe(LINES[1]);
    expect(surpriseLine('Taco House', 2)).toBe(LINES[2]);
    expect(surpriseLine('Taco House', 3)).toBe(LINES[0]);
    expect(surpriseLine('Taco House', -1)).toBe(LINES[2]);
    for (let index = 0; index < 6; index += 1) {
      const line = surpriseLine('Taco House', index);
      expect(LINES).toContain(line);
      expect(line).not.toContain("Closest I've got");
      expect(line.toLowerCase()).not.toContain("here's a surprise");
    }
  });

  it('uses the same surprise line signed in, signed out, and after another idea', () => {
    const shared = {
      name: 'Taco House',
      message: '',
      lineIndex: 1,
      restaurantTags: ['mexican'],
    };
    const signedIn = selectMemberVoice({ ...shared, askTone: 'surprise' });
    const signedOut = selectMemberVoice({
      ...shared,
      askTone: 'surprise',
      descriptive: 'Taco House is a McKinney partner, tagged mexican, listed at $.',
    });
    const another = selectMemberVoice({
      ...shared,
      askTone: 'another',
      surpriseSession: true,
      lineIndex: 2,
    });
    expect(signedIn).toEqual({ badge: 'Surprise', line: LINES[1], card: 'pick' });
    expect(signedOut.line).toBe(LINES[1]);
    expect(signedOut.badge).toBe('Surprise');
    expect(another.line).toBe(LINES[2]);
    expect(another.line).not.toContain("Closest I've got");
    expect(another.line).not.toContain("Here's another idea");
  });
});

describe('tweak framing', () => {
  it('reads Cheaper and New vibe as tweaks, including after surprise', () => {
    expect(cheaperVoiceLine('Taco House', true)).toBe('A little easier on the wallet: Taco House.');
    expect(cheaperVoiceLine('Taco House', false)).toBe('Nothing easier on the wallet than Taco House.');
    expect(vibeVoiceLine('Taco House', true)).toBe('Switching it up: Taco House.');
    expect(vibeVoiceLine('Taco House', false)).toBe(
      "I couldn't find a different vibe. Sticking with Taco House.",
    );
    const cheaper = selectMemberVoice({
      name: 'Taco House',
      message: '',
      askTone: 'request',
      surpriseSession: true,
      refine: 'cheaper',
      cheaperLanded: true,
      restaurantTags: ['brewery'],
    });
    expect(cheaper.line).toBe('A little easier on the wallet: Taco House.');
    expect(cheaper.line).not.toContain("Closest I've got");
    const stuck = selectMemberVoice({
      name: 'Union Bear',
      message: 'date night',
      askTone: 'request',
      refine: 'new-vibe',
      vibeChanged: false,
    });
    expect(stuck.line).toBe("I couldn't find a different vibe. Sticking with Union Bear.");
    expect(stuck.card).toBe('pick');
  });

  it('knows when a cheaper click actually landed lower', () => {
    expect(cheaperChoiceLanded('$', '$$')).toBe(true);
    expect(cheaperChoiceLanded('$$', '$$')).toBe(false);
    expect(cheaperChoiceLanded('$$$', '$')).toBe(false);
    expect(cheaperChoiceLanded('$', null)).toBe(true);
    expect(cheaperChoiceLanded('$$', null)).toBe(false);
    expect(cheaperChoiceLanded('$$', '$')).toBe(false);
  });
});

describe('closest match only for unmet hard constraints', () => {
  it('keeps date night, patio, and a matched cheap-tacos ask off the fallback', () => {
    const dateNight = selectMemberVoice({
      name: 'Bistro',
      message: 'Date night',
      askTone: 'request',
      restaurantTags: ['italian'],
      cuisine: 'Italian',
      neighborhood: 'Downtown',
      descriptive: 'A quiet room for two.',
    });
    expect(dateNight.card).toBe('pick');
    expect(dateNight.badge).toBe('Picked for you');
    expect(dateNight.line).toBe('A quiet room for two.');

    const patio = selectMemberVoice({
      name: 'The Yard',
      message: 'somewhere with a patio',
      askTone: 'request',
      restaurantTags: ['american', 'patio'],
      descriptive: null,
      cuisine: 'American',
      neighborhood: 'Historic Downtown McKinney',
    });
    expect(patio.card).toBe('pick');
    expect(patio.line).not.toContain("Closest I've got");
    expect(patio.line.toLowerCase()).not.toContain('tagged');

    const tacos = selectMemberVoice({
      name: 'Taco House',
      message: 'cheap tacos',
      askTone: 'request',
      restaurantTags: ['mexican', 'tacos'],
      priceRange: '$',
      descriptive: 'Taco House is the taco spot.',
    });
    expect(tacos.card).toBe('pick');
    expect(tacos.line).toBe('Taco House is the taco spot.');
    expect(hardConstraintMisses({
      message: 'cheap tacos',
      restaurantTags: ['mexican', 'tacos'],
    })).toEqual([]);
  });

  it('uses the closest line when tacos, a boat, or 4am cannot be met', () => {
    expect(
      hardConstraintMisses({
        message: 'cheap tacos',
        restaurantTags: ['brewery'],
      }),
    ).toEqual(['tacos']);
    const brewery = selectMemberVoice({
      name: 'TUPPS Brewery',
      message: 'cheap tacos',
      askTone: 'request',
      restaurantTags: ['brewery', 'american'],
      descriptive: 'Picked for you, trust me.',
    });
    expect(brewery).toMatchObject({
      card: 'fallback',
      badge: 'Closest pick',
      line: "Closest I've got: TUPPS Brewery. I couldn't match tacos.",
    });

    const impossible = selectMemberVoice({
      name: 'Union Bear',
      message: 'vegan sushi on a boat open at 4am',
      askTone: 'request',
      restaurantTags: ['brewery'],
      descriptive: 'Union Bear is a bright room.',
    });
    expect(impossible.card).toBe('fallback');
    expect(impossible.line).toBe(
      "Closest I've got: Union Bear. I couldn't match vegan, sushi, a boat, or being open at 4am.",
    );
    expect(impossible.badge).not.toBe('Picked for you');
  });

  it('treats sushi or thai as met by either, and still names a boat', () => {
    expect(
      hardConstraintMisses({
        message: 'sushi or thai',
        restaurantTags: ['thai'],
      }),
    ).toEqual([]);
    expect(
      hardConstraintMisses({
        message: 'sushi or thai on a boat',
        restaurantTags: ['sushi'],
      }),
    ).toEqual(['a boat']);
  });

  it('keeps another idea on one line even when the first pass had a descriptive sentence', () => {
    const first = selectMemberVoice({
      name: 'Green Table',
      message: 'quiet sushi',
      askTone: 'another',
      restaurantTags: ['noodles'],
      descriptive: 'Green Table is a bright room for noodles.',
    });
    const later = selectMemberVoice({
      name: 'Green Table',
      message: 'quiet sushi',
      askTone: 'another',
      restaurantTags: ['noodles'],
      descriptive: null,
    });
    expect(first.line).toBe("Here's another idea: Green Table.");
    expect(later.line).toBe(first.line);
    expect(first.badge).toBe(later.badge);
    expect(first.line).not.toContain("Closest I've got");
  });
});

describe('member copy rules', () => {
  it('rejects unconfirmed tags, backstory copy, and raw tag dumps', () => {
    expect(isRobotMemberCopy("Quick Bite: Can't confirm that from the partner listing")).toBe(true);
    expect(isRobotMemberCopy('Comfort Food: Cant confirm that from the partner listing')).toBe(true);
    expect(isRobotMemberCopy("We don't have a great dish pick or backstory for you yet")).toBe(true);
    expect(
      isRobotMemberCopy(
        'The Yard is a McKinney, Texas partner, in Historic Downtown McKinney, tagged american, burgers, patio, seafood, social, vegetarian, listed at $$. Confirm details with the restaurant.',
      ),
    ).toBe(true);
    expect(isRobotMemberCopy('A quiet room for two.')).toBe(false);
  });

  it('replaces a tag dump with a short friendly line', () => {
    const line = friendlyDiscoverLine({
      name: 'The Yard',
      cuisine: 'American — BBQ, Burgers, Diner',
      neighborhood: 'Historic Downtown McKinney',
      descriptive:
        'The Yard is a McKinney, Texas partner, tagged american, burgers, patio, listed at $$. Confirm details with the restaurant.',
    });
    expect(line).toBe('The Yard is an American spot in Historic Downtown McKinney.');
    expect(line.toLowerCase()).not.toContain('tagged');
    expect(line.toLowerCase()).not.toContain("can't confirm");
    expect(line.toLowerCase()).not.toContain('confirm details');
  });

  it('says when the fitting pool is used up', () => {
    const voice = selectMemberVoice({
      name: 'Taco House',
      message: '',
      askTone: 'surprise',
      poolRestarted: true,
      lineIndex: 0,
    });
    expect(voice.line).toBe(POOL_RESTART_LINE);
    expect(voice.line).not.toContain("Closest I've got");
  });
});
