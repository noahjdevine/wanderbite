'use client';

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
  onChange?: (value: string) => void;
};

export function PartnerPinField({
  id,
  name,
  value,
  disabled,
  placeholder = '4–6 digit PIN',
  className,
  onChange,
}: PartnerPinFieldProps) {
  return (
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
      className={
        className ??
        'w-full rounded-md border border-input bg-background px-4 py-3 text-sm font-mono focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:opacity-50'
      }
      onChange={(e) => {
        const next = filterPartnerPinInput(e.target.value);
        e.target.value = next;
        onChange?.(next);
      }}
    />
  );
}
