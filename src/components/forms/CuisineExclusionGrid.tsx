'use client';

import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CUISINES, type CuisineId } from '@/lib/cuisines';

export function CuisineExclusionGrid({
  value,
  onChange,
  disabled,
}: {
  value: CuisineId[];
  onChange: (next: CuisineId[]) => void;
  disabled?: boolean;
}) {
  const selected = new Set(value);

  function toggle(id: CuisineId) {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {CUISINES.map((c) => {
        const on = selected.has(c.id);
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => toggle(c.id)}
            disabled={disabled}
            className={cn(
              'group relative flex min-h-12 items-center justify-center rounded-lg border px-3 py-2 text-left text-sm font-medium transition-colors',
              on
                ? 'border-primary/40 bg-primary/10 text-foreground'
                : 'border-input bg-background text-foreground hover:bg-muted/50',
              disabled ? 'opacity-70' : 'cursor-pointer'
            )}
            aria-pressed={on}
          >
            <span className={cn('pr-5', on ? 'line-through decoration-primary/60' : null)}>{c.label}</span>
            {on ? (
              <span className="absolute right-2 inline-flex size-5 items-center justify-center rounded-full bg-primary/15 text-primary">
                <X className="size-3" aria-hidden />
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

