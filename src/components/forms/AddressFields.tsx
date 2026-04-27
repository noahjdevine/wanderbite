'use client';

import { US_STATES } from '@/lib/us-states';

export type AddressValues = {
  street: string;
  city: string;
  state: string;
  zip: string;
};

export function AddressFields({
  value,
  onChange,
  disabled,
  onZipBlur,
}: {
  value: AddressValues;
  onChange: (next: AddressValues) => void;
  disabled?: boolean;
  onZipBlur?: () => void;
}) {
  return (
    <div className="space-y-3">
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
            placeholder="Austin"
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
            className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-base sm:text-sm placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>
      </div>
    </div>
  );
}

