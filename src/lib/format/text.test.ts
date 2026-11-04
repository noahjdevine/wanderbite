import { describe, expect, it } from 'vitest';
import { decodeEntities, pluralize } from '@/lib/format/text';

describe('pluralize', () => {
  it('uses the singular only for 1', () => {
    expect(pluralize(1, 'restaurant')).toBe('1 restaurant');
    expect(pluralize(1, 'visit')).toBe('1 visit');
    expect(pluralize(1, 'neighborhood')).toBe('1 neighborhood');
    expect(pluralize(1, 'month')).toBe('1 month');
  });

  it('uses the plural for 0 and 2+', () => {
    expect(pluralize(0, 'restaurant')).toBe('0 restaurants');
    expect(pluralize(2, 'restaurant')).toBe('2 restaurants');
    expect(pluralize(0, 'visit')).toBe('0 visits');
    expect(pluralize(2, 'neighborhood')).toBe('2 neighborhoods');
    expect(pluralize(12, 'month')).toBe('12 months');
  });
});

describe('decodeEntities', () => {
  it('decodes the entities that show up in photo credits', () => {
    expect(decodeEntities('Tom &amp; Jane')).toBe('Tom & Jane');
    expect(decodeEntities('O&#39;Brien')).toBe("O'Brien");
    expect(decodeEntities('Say &quot;hi&quot;')).toBe('Say "hi"');
    expect(decodeEntities('&#x27;')).toBe("'");
  });

  it('leaves already-decoded text unchanged', () => {
    expect(decodeEntities('Tom & Jane')).toBe('Tom & Jane');
    expect(decodeEntities("O'Brien")).toBe("O'Brien");
    expect(decodeEntities('Say "hi"')).toBe('Say "hi"');
    expect(decodeEntities('Ada')).toBe('Ada');
  });

  it('leaves unknown entities unchanged', () => {
    expect(decodeEntities('&notanentity;')).toBe('&notanentity;');
    expect(decodeEntities('&amp')).toBe('&amp');
  });
});
