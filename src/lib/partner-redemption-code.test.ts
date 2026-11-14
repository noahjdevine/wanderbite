import { describe, expect, it } from 'vitest';
import {
  PARTNER_CODE_HINT,
  PARTNER_CODE_NOT_FOUND_MESSAGE,
  normalizePartnerRedemptionCode,
} from '@/lib/partner-redemption-code';

describe('normalizePartnerRedemptionCode', () => {
  it.each([
    'WB-ABCDE',
    'wb-abcde',
    ' wb abcde ',
    'ABCDE',
    'WBABCDE',
  ])('canonicalizes %j to WB-ABCDE', (raw) => {
    expect(normalizePartnerRedemptionCode(raw)).toBe('WB-ABCDE');
  });

  it.each([
    '',
    '   ',
    'ABC',
    'ABCDEF',
    'WB-ABCD',
    'WB-ABCDEF',
    'WB-AB0DE',
    'WB-ABODE',
    'WB-AB1DE',
    'WB-ABIDE',
    '0ABCD',
    'OABCD',
    '1ABCD',
    'IABCD',
    'WB-AB CDE!',
  ])('rejects %j', (raw) => {
    expect(normalizePartnerRedemptionCode(raw)).toBeNull();
  });

  it('keeps the hint and the generic failure free of a lookup result', () => {
    expect(PARTNER_CODE_HINT).toBe(
      'Enter the 5 letters/numbers after WB- — with or without WB-.',
    );
    expect(PARTNER_CODE_NOT_FOUND_MESSAGE).toBe(
      "We couldn't find that code. Check the 5 characters after WB- and try again.",
    );
    expect(PARTNER_CODE_NOT_FOUND_MESSAGE).not.toMatch(/restaurant|verified|expired/i);
  });
});
