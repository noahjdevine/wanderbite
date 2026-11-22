import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PartnerPinField } from '@/components/partner/partner-pin-field';

describe('PartnerPinField mask', () => {
  it('shows one disc per digit that stays in the field', () => {
    render(
      <label htmlFor="pin">
        PIN
        <PartnerPinField id="pin" name="pin" />
      </label>,
    );
    const input = screen.getByLabelText('PIN') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '1'.repeat(21) } });
    expect(input.value).toBe('1'.repeat(6));
    expect(input.getAttribute('data-pin-length')).toBe('6');
    expect(document.querySelector('[data-partner-pin-mask]')?.textContent).toBe('••••••');

    fireEvent.change(input, { target: { value: '1234' } });
    expect(input.value).toBe('1234');
    expect(input.getAttribute('data-pin-length')).toBe('4');
    expect(document.querySelector('[data-partner-pin-mask]')?.textContent).toBe('••••');
    expect(input.getAttribute('type')).toBe('password');
  });
});
