'use client';

import { Bea, BEA_DISPLAY_NAME } from '@/components/bea';
import { Chip } from '@/components/wb/chip';
import {
  DISCOVER_ALLERGY_NOTICE,
  DISCOVER_FOUND_LINE,
  type DiscoverOutcome,
  type DiscoverStepEvent,
} from '@/lib/discover/screen';
import type { DiscoverFood } from '@/lib/discover/events';

function StepMark({ done }: { done: boolean }) {
  if (!done) {
    return (
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center gap-0.5 rounded-full border border-wb-blush/50"
      >
        <span className="h-1 w-1 rounded-full bg-wb-blush" />
        <span className="h-1 w-1 rounded-full bg-wb-blush" />
        <span className="h-1 w-1 rounded-full bg-wb-blush" />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400 text-emerald-950">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
  );
}

function StepBody({ step }: { step: DiscoverStepEvent }) {
  if (step.id === 'parse') {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-[15px] font-semibold">{step.label}</span>
        {step.constraints.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {step.constraints.map((constraint) => (
              <Chip key={`${constraint.key}-${constraint.label}`} variant="glass">
                {constraint.label}
              </Chip>
            ))}
          </div>
        ) : (
          <span className="text-[13px] text-white/70">No extra filters on this ask</span>
        )}
      </div>
    );
  }
  if (step.id === 'filter') {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[15px] font-semibold">{step.label}</span>
        <span className="text-[13px] text-white/70">{step.detail}</span>
        {step.sample.length > 0 ? (
          <span className="text-[13px] text-white/80">{step.sample.map((partner) => partner.name).join(', ')}</span>
        ) : null}
      </div>
    );
  }
  if (step.id === 'memory') {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-[15px] font-semibold">{step.label}</span>
        <span className="wb-voice text-lg text-wb-blush">{step.line}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[15px] font-semibold">{step.label}</span>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-[14px] border border-wb-lavender/40 bg-wb-violet/20 px-3 py-2">
          <p className="text-sm font-semibold">{step.winner.name}</p>
          <p className="text-xs text-wb-lavender-2">{step.winnerTag}</p>
        </div>
        {step.runnerUp ? (
          <div className="rounded-[14px] border border-white/15 bg-white/5 px-3 py-2">
            <p className="text-sm font-semibold text-white/80">{step.runnerUp.name}</p>
            {step.runnerUpTag ? <p className="text-xs text-white/65">{step.runnerUpTag}</p> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function DiscoverThinking({
  quote,
  steps,
  visibleCount,
  outcome,
  food,
  showFoundLine,
  onBack,
  onSkip,
}: {
  quote: string;
  steps: readonly DiscoverStepEvent[];
  visibleCount: number;
  outcome: DiscoverOutcome;
  food: DiscoverFood | 'generic';
  showFoundLine: boolean;
  onBack: () => void;
  onSkip: () => void;
}) {
  const visible = steps.slice(0, visibleCount);
  const canSkip = outcome.kind === 'pick' || outcome.kind === 'fallback';

  return (
    <div data-screen="thinking" className="relative mx-auto min-h-[calc(100svh-3.5rem)] w-full max-w-3xl overflow-hidden px-4 pt-4 pb-16">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="wb-aurora absolute -top-16 -left-16 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(139,92,246,0.55)_0%,rgba(139,92,246,0)_70%)]" />
        <div className="wb-aurora-2 absolute top-24 -right-24 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(251,113,133,0.4)_0%,rgba(251,113,133,0)_70%)]" />
      </div>

      <div className="relative flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white"
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        {canSkip ? (
          <button type="button" onClick={onSkip} className="text-sm font-semibold text-wb-blush">
            Skip to the pick
          </button>
        ) : (
          <span />
        )}
      </div>

      <div className="relative mt-4 flex flex-col items-center gap-3 text-center">
        <Bea state="thinking" food={food} size={120} label={`${BEA_DISPLAY_NAME} is thinking`} />
        <h1 className="font-display text-[40px] text-white">
          {BEA_DISPLAY_NAME}&apos;s on it<span className="text-wb-blush">…</span>
        </h1>
        {quote ? <p className="wb-voice max-w-md text-xl text-white/80">“{quote}”</p> : null}
      </div>

      <ol aria-live="polite" className="relative mt-6 flex list-none flex-col gap-3 p-0">
        {visible.map((step, index) => (
          <li key={`${step.id}-${index}`} className="wb-step-in wb-glass flex gap-3 rounded-[20px] p-3.5">
            <StepMark done={index < visible.length - 1 || showFoundLine} />
            <StepBody step={step} />
          </li>
        ))}
      </ol>

      {showFoundLine ? (
        <div className="relative mt-5 flex items-center gap-2.5">
          <Bea state="found" food={food} size={32} />
          <p className="wb-voice rounded-[20px] rounded-bl-md bg-wb-blush px-4 py-2.5 text-[22px] text-wb-blush-ink">
            {DISCOVER_FOUND_LINE}
          </p>
        </div>
      ) : null}

      <p className="relative mt-6 text-center text-sm text-white/75">{DISCOVER_ALLERGY_NOTICE}</p>
    </div>
  );
}
