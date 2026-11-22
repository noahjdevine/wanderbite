'use client';

import { useState } from 'react';
import {
  filterPartnerPinInput,
  PARTNER_PIN_MAX_DIGITS,
  PARTNER_PIN_PATTERN,
} from '@/lib/partner-pin-format';

type PartnerPinFieldProps = {
  id: string;
  name?: string;
  value?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  describedBy?: string;
  invalid?: boolean;
  onChange?: (value: string) => void;
};

/**
 * One disc per digit that is actually in the field.
 * A monospace password font draws fewer discs than characters (a 21-character
 * entry can look like 6 dots). The mask uses the filtered value instead.
 */
export function PartnerPinField({
  id,
  name,
  value,
  disabled,
  placeholder = '4–6 digit PIN',
  className,
  describedBy,
  invalid,
  onChange,
}: PartnerPinFieldProps) {
  const [length, setLength] = useState(() => filterPartnerPinInput(value ?? '').length);

  function commit(element: HTMLInputElement) {
    const next = filterPartnerPinInput(element.value);
    if (element.value !== next) element.value = next;
    setLength(next.length);
    onChange?.(next);
  }

  return (
    <div className="grid">
      <input
        id={id}
        name={name}
        type="password"
        inputMode="numeric"
        pattern={PARTNER_PIN_PATTERN}
        maxLength={PARTNER_PIN_MAX_DIGITS}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        data-pin-length={length}
        className={
          className
            ? `${className} wb-partner-pin col-start-1 row-start-1`
            : 'wb-partner-pin col-start-1 row-start-1 w-full rounded-md border border-input bg-background px-4 py-3 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:opacity-50'
        }
        onChange={(event) => commit(event.currentTarget)}
      />
      <span
        aria-hidden="true"
        data-partner-pin-mask=""
        className="pointer-events-none col-start-1 row-start-1 flex items-center overflow-hidden px-4 text-base tracking-normal text-wb-ink"
      >
        {length > 0 ? '•'.repeat(length) : ''}
      </span>
    </div>
  );
}
