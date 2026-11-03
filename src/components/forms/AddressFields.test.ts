import { describe, expect, it } from 'vitest';
import { normalizeAutofillState } from '@/components/forms/AddressFields';

describe('normalizeAutofillState', () => {
  it('maps TX, tx, and Texas onto the select code', () => {
    expect(normalizeAutofillState('TX')).toBe('TX');
    expect(normalizeAutofillState('tx')).toBe('TX');
    expect(normalizeAutofillState('Texas')).toBe('TX');
    expect(normalizeAutofillState('  texas  ')).toBe('TX');
  });
});
