import { describe, expect, it } from 'vitest';
import {
  PARTNER_CODE_HINT,
  PARTNER_CODE_NOT_FOUND_MESSAGE,
  normalizePartnerRedemptionCode,
  partnerCodeInputValue,
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

  it.each(['WB3K7', 'wb3k7', 'WB-WB3K7', 'WBWB3K7', ' wb wb3k7 '])(
    'keeps a body that starts with WB: %j',
    (raw) => {
      expect(normalizePartnerRedemptionCode(raw)).toBe('WB-WB3K7');
    },
  );

  it.each([
    '',
    '   ',
    'ABC',
    'ABCDEF',
    'WB-ABCD',
    'WBABCD',
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

  it('shows a complete body that starts with WB as the canonical code', () => {
    expect(partnerCodeInputValue('wb3k7')).toBe('WB-WB3K7');
    expect(partnerCodeInputValue(' wb wb3k7 ')).toBe('WB-WB3K7');
    expect(partnerCodeInputValue('WB3')).toBe('WB3');
  });
});
