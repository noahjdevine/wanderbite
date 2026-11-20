import { describe, expect, it } from 'vitest';
import { briefingSourceDisplay, briefingSourceLabel, formatBriefingChecked } from '@/lib/briefings/types';

describe('formatBriefingChecked', () => {
  it('uses the America/Chicago calendar date across the UTC midnight boundary', () => {
    expect(formatBriefingChecked('2026-11-05T05:30:00.000Z')).toBe('Nov 4, 2026');
    expect(formatBriefingChecked('2026-11-05T06:00:00.000Z')).toBe('Nov 5, 2026');
    expect(formatBriefingChecked('2026-07-15T04:30:00.000Z')).toBe('Jul 14, 2026');
    expect(formatBriefingChecked('not-a-date')).toBeNull();
  });
});

describe('briefingSourceDisplay', () => {
  it('strips a leading www. and lowercases the host, without the path or query', () => {
    expect(briefingSourceDisplay('https://www.TripAdvisor.com/Restaurant_Review-g35805?m=1')).toBe(
      'Source: tripadvisor.com',
    );
    expect(briefingSourceDisplay('https://WWW.ShunByYama.com/menu#hours')).toBe('Source: shunbyyama.com');
    expect(briefingSourceDisplay('https://www.www.example.com/nested')).toBe('Source: www.example.com');
    expect(briefingSourceLabel('https://www.tripadvisor.com/Restaurant_Review')).toBe('Source');
  });

  it('keeps Google Maps wording for the same https URLs as briefingSourceLabel', () => {
    const maps = [
      'https://maps.google.com/?cid=99',
      'https://www.google.com/maps/place/noodle',
      'https://google.com/maps',
      'https://maps.google.com/maps/place/noodle',
    ];
    for (const url of maps) {
      expect(briefingSourceDisplay(url)).toBe('Google Maps');
      expect(briefingSourceLabel(url)).toBe('Google Maps');
    }
    expect(briefingSourceDisplay('https://www.google.com/search?q=noodle')).toBe('Source: google.com');
    expect(briefingSourceLabel('https://www.google.com/search?q=noodle')).toBe('Source');
  });

  it('falls back to Source for an unparseable or non-https URL', () => {
    expect(briefingSourceDisplay('not a url')).toBe('Source');
    expect(briefingSourceDisplay('https://')).toBe('Source');
    expect(briefingSourceDisplay('http://www.tripadvisor.com/restaurant')).toBe('Source');
    expect(briefingSourceDisplay('http://maps.google.com/?cid=99')).toBe('Source');
    expect(briefingSourceLabel('http://maps.google.com/?cid=99')).toBe('Source');
    expect(briefingSourceLabel('notaurl')).toBe('Source');
  });

  it('keeps a long host on one label and drops the path and query', () => {
    const host = 'restaurant-name-that-is-intentionally-very-long.example.co.uk';
    const label = briefingSourceDisplay(`https://www.${host}/some/deep/path?q=1&utm=x`);
    expect(label).toBe(`Source: ${host}`);
    expect(label).not.toContain('/');
    expect(label).not.toContain('utm');
    expect(label).not.toContain('www.');
  });
});
