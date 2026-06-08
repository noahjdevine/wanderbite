'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { cuisineLabel, type CuisineId } from '@/lib/cuisines';
import type { RouletteDietaryFlag } from '@/lib/roulette-dietary';
import {
  ROULETTE_CUISINE_OPTIONS,
  ROULETTE_DIETARY_PILLS,
  ROULETTE_PRICE_OPTIONS,
  ROULETTE_TIMES,
  ROULETTE_VIBE_PILLS,
  ROULETTE_VIBES,
  type RoulettePriceRange,
  type RouletteTime,
  type RouletteVibe,
} from '@/lib/roulette-options';

export type RouletteSelections = {
  vibe: RouletteVibe | null;
  timeOfDay: RouletteTime | null;
  dietaryFlags: RouletteDietaryFlag[];
  priceRange: RoulettePriceRange | null;
  preferredCuisine: CuisineId | null;
};

type Variant = 'hero' | 'page';

function selectedClass(variant: Variant, selected: boolean): string {
  if (variant === 'page') {
    return selected
      ? 'border-[#E85D26] bg-[#E85D26] text-white shadow-sm'
      : 'border-border bg-background text-foreground hover:border-[#E85D26]/50';
  }
  return selected
    ? 'border-primary bg-primary/15 text-primary shadow-sm'
    : 'border-violet-200/80 bg-white/80 text-foreground hover:border-primary/50';
}

function PillGroup<T extends string>({
  variant,
  label,
  options,
  value,
  onChange,
}: {
  variant: Variant;
  label: string;
  options: readonly T[];
  value: T | null;
  onChange: (next: T | null) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {options.map((opt) => {
          const selected = value === opt;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(selected ? null : opt)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                selectedClass(variant, selected)
              )}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function RouletteOptionsFields({
  variant,
  selections,
  onChange,
  exclusionsSummary,
}: {
  variant: Variant;
  selections: RouletteSelections;
  onChange: (patch: Partial<RouletteSelections>) => void;
  exclusionsSummary: string | null;
}) {
  const { vibe, timeOfDay, dietaryFlags, priceRange, preferredCuisine } =
    selections;

  return (
    <div className="w-full space-y-8">
      {exclusionsSummary ? (
        <p className="text-center text-sm text-muted-foreground">
          Honoring your cuisine exclusions:{' '}
          <span className="font-medium text-foreground">{exclusionsSummary}</span>.{' '}
          <Link
            href="/account"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Edit
          </Link>
        </p>
      ) : null}

      <div className="space-y-2">
        <p className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Vibe (optional)
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {ROULETTE_VIBE_PILLS.map((pill) => {
            const selected = vibe === pill.value;
            return (
              <button
                key={pill.value}
                type="button"
                onClick={() =>
                  onChange({ vibe: selected ? null : pill.value })
                }
                className={cn(
                  'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                  selectedClass(variant, selected)
                )}
              >
                {pill.label}
              </button>
            );
          })}
        </div>
      </div>

      <PillGroup
        variant={variant}
        label="Time (optional)"
        options={ROULETTE_TIMES}
        value={timeOfDay}
        onChange={(timeOfDay) => onChange({ timeOfDay })}
      />

      <div className="space-y-2">
        <p className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Dietary &amp; religion (optional, multi-select)
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {ROULETTE_DIETARY_PILLS.map(({ value, label, Icon }) => {
            const on = dietaryFlags.includes(value);
            return (
              <button
                key={value}
                type="button"
                onClick={() =>
                  onChange({
                    dietaryFlags: on
                      ? dietaryFlags.filter((f) => f !== value)
                      : [...dietaryFlags, value],
                  })
                }
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                  selectedClass(variant, on)
                )}
              >
                <Icon className="size-3.5 shrink-0" aria-hidden />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Cuisine (optional)
        </p>
        <div className="flex max-h-32 flex-wrap justify-center gap-2 overflow-y-auto px-1">
          {ROULETTE_CUISINE_OPTIONS.map((c) => {
            const selected = preferredCuisine === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() =>
                  onChange({
                    preferredCuisine: selected ? null : c.id,
                  })
                }
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors sm:text-sm',
                  selectedClass(variant, selected)
                )}
                title={c.label}
              >
                {cuisineLabel(c.id).split(' — ')[0]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Price (optional)
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {ROULETTE_PRICE_OPTIONS.map((p) => {
            const selected = priceRange === p.value;
            return (
              <button
                key={p.value}
                type="button"
                onClick={() =>
                  onChange({ priceRange: selected ? null : p.value })
                }
                className={cn(
                  'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                  selectedClass(variant, selected)
                )}
                title={p.hint}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Plain vibe labels for pages that prefer text-only (unused if both use emoji pills). */
export const ROULETTE_VIBE_LABELS = ROULETTE_VIBES;
