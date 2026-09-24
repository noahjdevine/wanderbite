import { describe, expect, it } from 'vitest';
import {
  GOOGLE_IMPORT_PARTIAL_MESSAGE,
  googleImportOutcome,
} from '@/lib/google-import-outcome';

describe('googleImportOutcome', () => {
  it('stops when create fails and does not describe an attach', () => {
    expect(
      googleImportOutcome({
        createdOk: false,
        createdError: 'Name is required.',
        partnerUrl: null,
        placeId: 'place-1',
        attachedOk: null,
        attachedError: null,
      }),
    ).toEqual({ status: 'error', error: 'Name is required.' });
  });

  it('treats a create without a Place ID as success', () => {
    expect(
      googleImportOutcome({
        createdOk: true,
        createdError: null,
        partnerUrl: '/partner/cafe',
        placeId: '  ',
        attachedOk: null,
        attachedError: null,
      }),
    ).toEqual({ status: 'success', partnerUrl: '/partner/cafe' });
  });

  it('returns success when create and attach both succeed', () => {
    expect(
      googleImportOutcome({
        createdOk: true,
        createdError: null,
        partnerUrl: '/partner/cafe',
        placeId: 'place-1',
        attachedOk: true,
        attachedError: null,
      }),
    ).toEqual({ status: 'success', partnerUrl: '/partner/cafe' });
  });

  it('keeps the restaurant and surfaces the attach error', () => {
    expect(
      googleImportOutcome({
        createdOk: true,
        createdError: null,
        partnerUrl: '/partner/cafe',
        placeId: 'place-1',
        attachedOk: false,
        attachedError: 'Could not find the new restaurant row to attach Google metadata.',
      }),
    ).toEqual({
      status: 'partial',
      partnerUrl: '/partner/cafe',
      error: 'Could not find the new restaurant row to attach Google metadata.',
    });
    expect(GOOGLE_IMPORT_PARTIAL_MESSAGE).toBe(
      'Restaurant added, but Google metadata was not saved.',
    );
  });
});
