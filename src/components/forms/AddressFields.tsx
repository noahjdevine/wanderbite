'use client';

import { useEffect, useRef } from 'react';
import { US_STATES } from '@/lib/us-states';

export type AddressValues = {
  street: string;
  city: string;
  state: string;
  zip: string;
};

/** Matches the autofill keyframes in globals.css. */
export const AUTOFILL_ANIMATION_NAME = 'wb-onAutoFillStart';

export function isAutofillAnimation(event: { animationName: string }): boolean {
  return event.animationName === AUTOFILL_ANIMATION_NAME;
}

/** Map a browser autofill of "TX", "tx", or "Texas" onto the select's code. */
export function normalizeAutofillState(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const codePrefix = /^([A-Za-z]{2})\b/.exec(trimmed);
  if (codePrefix) {
    const code = codePrefix[1].toUpperCase();
    if (US_STATES.some((state) => state.code === code)) return code;
  }
  const byName = US_STATES.find((state) => state.name.toLowerCase() === trimmed.toLowerCase());
  return byName ? byName.code : trimmed;
}

export function readAddressFields(root: ParentNode): AddressValues {
  const street = root.querySelector<HTMLInputElement>('#address-street')?.value ?? '';
  const city = root.querySelector<HTMLInputElement>('#address-city')?.value ?? '';
  const stateRaw = root.querySelector<HTMLSelectElement>('#address-state')?.value ?? '';
  const zip = root.querySelector<HTMLInputElement>('#address-zip')?.value ?? '';
  return {
    street,
    city,
    state: normalizeAutofillState(stateRaw),
    zip,
  };
}

function filledAddress(current: AddressValues, dom: AddressValues): AddressValues {
  return {
    street: dom.street.trim() ? dom.street : current.street,
    city: dom.city.trim() ? dom.city : current.city,
    state: dom.state.trim() ? dom.state : current.state,
    zip: dom.zip.trim() ? dom.zip : current.zip,
  };
}

export function AddressFields({
  value,
  onChange,
  disabled,
  onZipBlur,
  zipDescribedBy,
  zipInvalid,
}: {
  value: AddressValues;
  onChange: (next: AddressValues) => void;
  disabled?: boolean;
  onZipBlur?: () => void;
  /** Set by the account profile form when the ZIP message is showing. */
  zipDescribedBy?: string;
  zipInvalid?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const dom = readAddressFields(root);
    const next = filledAddress(value, dom);
    if (
      next.street === value.street &&
      next.city === value.city &&
      next.state === value.state &&
      next.zip === value.zip
    ) {
      return;
    }
    onChange(next);
    // Mount-only: browser autofill can land before the first effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function syncFromAnimation(event: React.AnimationEvent<HTMLDivElement>) {
    if (!isAutofillAnimation(event)) return;
    const next = filledAddress(value, readAddressFields(event.currentTarget));
    if (
      next.street === value.street &&
      next.city === value.city &&
      next.state === value.state &&
      next.zip === value.zip
    ) {
      return;
    }
    onChange(next);
  }

  return (
    <div ref={rootRef} className="space-y-3" onAnimationStart={syncFromAnimation}>
      <div className="space-y-2">
        <label htmlFor="address-street" className="text-sm font-medium">
          Street
        </label>
        <input
          id="address-street"
          type="text"
          value={value.street}
          onChange={(e) => onChange({ ...value, street: e.target.value })}
          placeholder="123 Main St"
          autoComplete="street-address"
          disabled={disabled}
          className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-base sm:text-sm placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
        <div className="space-y-2 sm:col-span-6">
          <label htmlFor="address-city" className="text-sm font-medium">
            City
          </label>
          <input
            id="address-city"
            type="text"
            value={value.city}
            onChange={(e) => onChange({ ...value, city: e.target.value })}
            placeholder="McKinney"
            autoComplete="address-level2"
            disabled={disabled}
            className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-base sm:text-sm placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>

        <div className="space-y-2 sm:col-span-3">
          <label htmlFor="address-state" className="text-sm font-medium">
            State
          </label>
          <select
            id="address-state"
            value={value.state}
            onChange={(e) => onChange({ ...value, state: e.target.value })}
            autoComplete="address-level1"
            disabled={disabled}
            className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-base sm:text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
          >
            <option value="">Select…</option>
            {US_STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} — {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2 sm:col-span-3">
          <label htmlFor="address-zip" className="text-sm font-medium">
            ZIP
          </label>
          <input
            id="address-zip"
            type="text"
            inputMode="numeric"
            value={value.zip}
            onChange={(e) => onChange({ ...value, zip: e.target.value })}
            onBlur={onZipBlur}
            placeholder="78701"
          autoComplete="postal-code"
          disabled={disabled}
          aria-describedby={zipDescribedBy}
          aria-invalid={zipInvalid ? true : undefined}
          className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-base sm:text-sm placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
        />
        </div>
      </div>
    </div>
  );
}

