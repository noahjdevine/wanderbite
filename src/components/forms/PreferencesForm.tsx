'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

export type PreferencesValues = {
  dietary_flags: string[];
  vibe_tags: string[];
  distance_band: string;
  wants_cocktail_experience: boolean;
};

const DIETARY_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'gluten_free', label: 'Gluten-Free' },
  { value: 'halal', label: 'Halal' },
  { value: 'kosher', label: 'Kosher' },
  { value: 'dairy_free', label: 'Dairy-Free' },
  { value: 'pescatarian', label: 'Pescatarian' },
] as const;

const VIBE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'adventurous', label: 'Adventurous' },
  { value: 'comfort_food', label: 'Comfort food' },
  { value: 'date_night', label: 'Date night' },
  { value: 'quick_bite', label: 'Quick bite' },
  { value: 'special_occasion', label: 'Special occasion' },
] as const;

const DISTANCE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: '5_mi', label: '5 miles (Neighborhood)' },
  { value: '15_mi', label: '15 miles (City)' },
  { value: '25_mi', label: '25 miles (Metro)' },
  { value: '40_mi', label: '40 miles (Road trip)' },
] as const;

export function PreferencesForm({
  initialValues,
  onSubmit,
  submitLabel,
  isDirty,
}: {
  initialValues: PreferencesValues;
  onSubmit: (values: PreferencesValues) => Promise<void> | void;
  submitLabel: string;
  isDirty?: boolean;
}) {
  const [values, setValues] = useState<PreferencesValues>(initialValues);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = useMemo(() => {
    if (typeof isDirty === 'boolean') return isDirty;
    return JSON.stringify(values) !== JSON.stringify(initialValues);
  }, [initialValues, isDirty, values]);

  function toggleList(key: 'dietary_flags' | 'vibe_tags', value: string) {
    setValues((prev) => {
      const list = prev[key] ?? [];
      const on = list.includes(value);
      return { ...prev, [key]: on ? list.filter((x) => x !== value) : [...list, value] };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    setSaving(true);
    try {
      await onSubmit(values);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Dietary preferences</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {DIETARY_OPTIONS.map((opt) => {
            const on = values.dietary_flags.includes(opt.value);
            return (
              <label
                key={opt.value}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 transition-colors',
                  on ? 'border-primary/40 bg-primary/5' : 'border-input hover:bg-muted/50'
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggleList('dietary_flags', opt.value)}
                  className="size-4 rounded border-input"
                  disabled={saving}
                />
                <span className="text-sm">{opt.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Vibe</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {VIBE_OPTIONS.map((opt) => {
            const on = values.vibe_tags.includes(opt.value);
            return (
              <label
                key={opt.value}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 transition-colors',
                  on ? 'border-primary/40 bg-primary/5' : 'border-input hover:bg-muted/50'
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggleList('vibe_tags', opt.value)}
                  className="size-4 rounded border-input"
                  disabled={saving}
                />
                <span className="text-sm">{opt.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="space-y-2">
        <label htmlFor="distance" className="text-sm font-medium">
          Distance preference
        </label>
        <select
          id="distance"
          value={values.distance_band}
          onChange={(e) => setValues((p) => ({ ...p, distance_band: e.target.value }))}
          className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-base sm:text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
          disabled={saving}
        >
          {DISTANCE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-md border border-input px-3 py-3 hover:bg-muted/50">
        <input
          type="checkbox"
          checked={values.wants_cocktail_experience}
          onChange={(e) =>
            setValues((p) => ({ ...p, wants_cocktail_experience: e.target.checked }))
          }
          className="mt-1 size-4 shrink-0 rounded border-input"
          disabled={saving}
        />
        <div>
          <span className="text-sm font-medium">Interested in cocktail/bar experiences?</span>
          <p className="mt-1 text-xs text-muted-foreground">
            If selected, we’ll include up to one curated cocktail experience per month (21+ required).
          </p>
        </div>
      </label>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="text-sm text-primary" role="status">
          Saved ✓
        </p>
      ) : null}

      <button
        type="submit"
        disabled={saving || !dirty}
        className={cn(
          'inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-base font-semibold text-primary-foreground shadow-sm transition-opacity',
          saving || !dirty ? 'opacity-60' : 'hover:opacity-95'
        )}
      >
        {saving ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}

