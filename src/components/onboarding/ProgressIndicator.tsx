'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export type WizardStep = 1 | 2 | 3;

export function ProgressIndicator({
  currentStep,
  completed,
}: {
  currentStep: WizardStep;
  completed: { 1: boolean; 2: boolean; 3: boolean };
}) {
  const steps: { n: WizardStep; label: string }[] = [
    { n: 1, label: 'Preferences' },
    { n: 2, label: 'Profile' },
    { n: 3, label: 'Subscribe' },
  ];

  return (
    <div className="w-full">
      <div className="mx-auto flex max-w-md items-center justify-between gap-2">
        {steps.map((s, idx) => {
          const isComplete = completed[s.n];
          const isActive = currentStep === s.n;
          const isInactive = !isActive && !isComplete;

          return (
            <div key={s.n} className="flex flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                <div
                  className={cn(
                    'mx-auto flex size-9 items-center justify-center rounded-full border text-sm font-semibold transition-all',
                    isActive && 'scale-[1.06] border-primary bg-primary text-primary-foreground shadow-sm',
                    isComplete && !isActive && 'border-primary bg-primary text-primary-foreground',
                    isInactive && 'border-border bg-background text-muted-foreground'
                  )}
                  aria-current={isActive ? 'step' : undefined}
                >
                  {isComplete ? <Check className="size-4" aria-hidden /> : s.n}
                </div>

                {idx < steps.length - 1 ? (
                  <div
                    className={cn(
                      'h-0.5 flex-1 transition-colors',
                      completed[s.n] ? 'bg-primary' : 'bg-border'
                    )}
                    aria-hidden
                  />
                ) : null}
              </div>

              <span className="mt-2 text-[11px] font-medium text-muted-foreground">
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

