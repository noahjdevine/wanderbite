import { describe, expect, it } from 'vitest';
import { splitNoteByNames } from '@/lib/activities/note-segments';

const VILLAGE = 'Chestnut Square Village';
const SQUARE = 'Chestnut Square';

describe('splitNoteByNames', () => {
  it('matches curly quotes and dashes against straight ones on the original string', () => {
    const curly = 'End the night at Handel\u2019s Homemade Ice Cream.';
    expect(splitNoteByNames(curly, ["Handel's Homemade Ice Cream"])).toEqual([
      { text: 'End the night at ', isName: false },
      { text: 'Handel\u2019s Homemade Ice Cream', isName: true },
      { text: '.', isName: false },
    ]);

    const dashed = 'See Handel\u2019s Homemade Ice Cream \u2014 McKinney tonight.';
    expect(splitNoteByNames(dashed, ['Handel\u2019s Homemade Ice Cream \u2013 McKinney'])).toEqual([
      { text: 'See ', isName: false },
      { text: 'Handel\u2019s Homemade Ice Cream \u2014 McKinney', isName: true },
      { text: ' tonight.', isName: false },
    ]);

    const quoted = 'End the night at Handel\u2019s \u201CLate\u201D Cream tonight.';
    expect(splitNoteByNames(quoted, ['Handel\'s "Late" Cream'])[1]).toEqual({
      text: 'Handel\u2019s \u201CLate\u201D Cream',
      isName: true,
    });
  });

  it('prefers the longest name when two names overlap', () => {
    const body = `Visit ${VILLAGE} tonight.`;
    expect(splitNoteByNames(body, [SQUARE, VILLAGE]).filter((segment) => segment.isName)).toEqual([
      { text: VILLAGE, isName: true },
    ]);
    expect(splitNoteByNames(body, [VILLAGE, SQUARE]).filter((segment) => segment.isName)).toEqual([
      { text: VILLAGE, isName: true },
    ]);

    const earlier = 'The Art Museum of McKinney opens late.';
    expect(
      splitNoteByNames(earlier, ['Art Museum', 'Museum of McKinney']).filter((segment) => segment.isName),
    ).toEqual([{ text: 'Museum of McKinney', isName: true }]);
  });

  it('matches a name at the start or the end, and keeps punctuation outside the name', () => {
    expect(splitNoteByNames(`${VILLAGE} is close.`, [VILLAGE])[0]).toEqual({
      text: VILLAGE,
      isName: true,
    });
    expect(splitNoteByNames(`Walk to ${VILLAGE}`, [VILLAGE]).at(-1)).toEqual({
      text: VILLAGE,
      isName: true,
    });
    expect(splitNoteByNames(`Visit ${VILLAGE}.`, [VILLAGE])).toEqual([
      { text: 'Visit ', isName: false },
      { text: VILLAGE, isName: true },
      { text: '.', isName: false },
    ]);
  });

  it('does not match a name inside a longer word and returns one plain segment otherwise', () => {
    const squares = 'The Squaresville band plays nearby tonight.';
    expect(splitNoteByNames(squares, ['Square'])).toEqual([{ text: squares, isName: false }]);
    const prefixed = 'Meet at McSquare before dinner tonight.';
    expect(splitNoteByNames(prefixed, ['Square'])).toEqual([{ text: prefixed, isName: false }]);
    const none = 'No places here tonight.';
    expect(splitNoteByNames(none, [VILLAGE, ''])).toEqual([{ text: none, isName: false }]);
  });

  it('matches case-insensitively and keeps both non-overlapping names', () => {
    const body = 'See chestnut square village, then Comedy Arena.';
    expect(splitNoteByNames(body, ['Comedy Arena', VILLAGE])).toEqual([
      { text: 'See ', isName: false },
      { text: 'chestnut square village', isName: true },
      { text: ', then ', isName: false },
      { text: 'Comedy Arena', isName: true },
      { text: '.', isName: false },
    ]);
  });
});
