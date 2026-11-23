import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PartnerPinField } from '@/components/partner/partner-pin-field';

describe('PartnerPinField mask', () => {
  it('keeps the field value to the digits typed and does not append the mask', () => {
    render(
      <form>
        <label htmlFor="pin">
          PIN
          <PartnerPinField id="pin" name="pin" />
        </label>
      </form>,
    );
    const input = screen.getByLabelText('PIN') as HTMLInputElement;
    const form = input.closest('form');
    if (!form) throw new Error('missing form');

    fireEvent.change(input, { target: { value: `ab${'1'.repeat(21)}-` } });
    expect(input.value).toBe('1'.repeat(6));
    expect(input.value).toHaveLength(6);
    expect(input.getAttribute('maxLength')).toBe('6');
    expect(input.getAttribute('data-pin-length')).toBe('6');
    const mask = document.querySelector('[data-partner-pin-mask]');
    expect(mask?.getAttribute('aria-hidden')).toBe('true');
    expect(mask?.textContent).toBe('••••••');
    expect(mask?.textContent).toHaveLength(6);
    expect(form.querySelectorAll('input[name="pin"]')).toHaveLength(1);

    const submitted = new FormData(form).get('pin');
    expect(submitted).toBe('1'.repeat(6));
    expect(typeof submitted === 'string' ? submitted.length : 0).toBe(6);

    fireEvent.change(input, { target: { value: '1234' } });
    expect(input.value).toBe('1234');
    expect(input.value).toHaveLength(4);
    expect(input.getAttribute('data-pin-length')).toBe('4');
    expect(document.querySelector('[data-partner-pin-mask]')?.textContent).toBe('••••');
    expect(new FormData(form).get('pin')).toBe('1234');
    expect(input.getAttribute('type')).toBe('password');
  });
});
