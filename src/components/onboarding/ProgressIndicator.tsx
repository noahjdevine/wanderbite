'use client';

import { Check } from 'lucide-react';

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
    { n: 3, label: 'Plan' },
  ];

  return (
    <div className="wb-onboarding-steps">
      {steps.map((s, idx) => {
        const isComplete = completed[s.n];
        const isActive = currentStep === s.n;
        const state = isActive ? 'active' : isComplete ? 'complete' : 'upcoming';

        return (
          <div key={s.n} className="wb-onboarding-step">
            <div
              className="wb-onboarding-step-dot"
              data-state={state}
              aria-current={isActive ? 'step' : undefined}
            >
              {isComplete ? <Check className="size-4" aria-hidden /> : s.n}
            </div>
            {idx < steps.length - 1 ? (
              <div
                className="wb-onboarding-step-line"
                data-complete={isComplete ? 'true' : 'false'}
                aria-hidden
              />
            ) : null}
            <span className="wb-onboarding-step-label" data-state={state}>
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
