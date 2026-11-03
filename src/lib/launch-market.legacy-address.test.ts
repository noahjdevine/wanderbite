import { describe, expect, it } from 'vitest';
import {
  parseLegacyAddress,
  resolveStructuredAddress,
} from '@/lib/launch-market';

const legacy = '111 Awesome St, Mckinney, TX 75071';

describe('parseLegacyAddress', () => {
  it('parses the McKinney example', () => {
    expect(parseLegacyAddress(legacy)).toEqual({
      street: '111 Awesome St',
      city: 'Mckinney',
      state: 'TX',
      zip: '75071',
    });
  });

  it('keeps ZIP+4', () => {
    expect(parseLegacyAddress('111 Awesome St, Mckinney, TX 75071-1234')).toEqual({
      street: '111 Awesome St',
      city: 'Mckinney',
      state: 'TX',
      zip: '75071-1234',
    });
  });

  it('uppercases a lowercase state', () => {
    expect(parseLegacyAddress('111 Awesome St, Mckinney, tx 75071')?.state).toBe('TX');
  });

  it('allows extra spaces', () => {
    expect(parseLegacyAddress('  111 Awesome St,   Mckinney,   tx   75071  ')).toEqual({
      street: '111 Awesome St',
      city: 'Mckinney',
      state: 'TX',
      zip: '75071',
    });
  });

  it('rejects a line with no commas', () => {
    expect(parseLegacyAddress('111 Awesome St Mckinney TX 75071')).toBeNull();
  });
});

describe('resolveStructuredAddress', () => {
  it('keeps structured 123 Main St when legacy is 111 Awesome St', () => {
    expect(
      resolveStructuredAddress({
        street: '123 Main St',
        city: 'Mckinney',
        state: 'TX',
        zip: '75071',
        legacy,
      }),
    ).toEqual({
      street: '123 Main St',
      city: 'Mckinney',
      state: 'TX',
      zip: '75071',
    });
  });

  it('parses legacy only when every structured field is blank', () => {
    expect(
      resolveStructuredAddress({
        street: '  ',
        city: null,
        state: '',
        zip: null,
        legacy,
      }),
    ).toEqual({
      street: '111 Awesome St',
      city: 'Mckinney',
      state: 'TX',
      zip: '75071',
    });
  });

  it('does not merge a partial structured row with the legacy line', () => {
    expect(
      resolveStructuredAddress({
        street: null,
        city: 'McKinney',
        state: 'TX',
        zip: '75071',
        legacy,
      }),
    ).toEqual({
      street: null,
      city: 'McKinney',
      state: 'TX',
      zip: '75071',
    });
  });
});
