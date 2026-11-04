'use client';

import { Bea } from '@/components/bea';
import { DiscoveryVoiceControls } from '@/components/roulette/discovery-voice-controls';
import {
  RouletteOptionsFields,
  type RouletteSelections,
} from '@/components/roulette/roulette-options-fields';
import { GlowBorder } from '@/components/wb/glow-border';
import { HERO_PLACEHOLDERS, placeholderDelaySeconds } from '@/lib/home/hero';
import { ROULETTE_MAX_MESSAGE_CHARS } from '@/lib/ai-bounds';
import {
  DISCOVER_ALLERGY_NOTICE,
  DISCOVER_MESSAGE_TOO_LONG,
  DISCOVER_QUICK_CHIPS,
  dietaryButtonLabel,
  discoverGreeting,
  type DiscoverDraft,
} from '@/lib/discover/screen';
import { DiscoverPhoto } from '@/components/discover/discover-photo';

function ArrowIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22c5.5 0 10-4.5 10-10S17.5 2 12 2 2 6.5 2 12s4.5 10 10 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function DiscoverAsk({
  draft,
  greetingName,
  dietaryLabelFlags,
  refineOpen,
  exclusionsSummary,
  onMessage,
  onSelections,
  onToggleRefine,
  onQuickChip,
  onSubmit,
}: {
  draft: DiscoverDraft;
  greetingName: string | null;
  dietaryLabelFlags: DiscoverDraft['dietaryFlags'];
  refineOpen: boolean;
  exclusionsSummary: string | null;
  onMessage: (message: string) => void;
  onSelections: (patch: Partial<RouletteSelections>) => void;
  onToggleRefine: () => void;
  onQuickChip: (index: number) => void;
  onSubmit: () => void;
}) {
  const tooLong = draft.message.length > ROULETTE_MAX_MESSAGE_CHARS;
  const selections: RouletteSelections = {
    vibe: draft.vibe,
    timeOfDay: draft.timeOfDay,
    dietaryFlags: [...draft.dietaryFlags],
    priceRange: draft.priceRange,
    preferredCuisine: draft.preferredCuisine,
  };

  return (
    <div data-screen="ask" className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-4 pb-16">
      <div className="relative overflow-hidden rounded-[28px]">
        <DiscoverPhoto photoUrl={null} name="" decorative priority />
        <div className="absolute inset-0 bg-gradient-to-b from-wb-night/55 via-transparent to-wb-night" />
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 p-5 sm:p-8">
          <p className="wb-pill-label">{discoverGreeting(greetingName)}</p>
          <h1 className="font-display text-[42px] leading-[0.95] text-white sm:text-[58px]">
            Where should we eat <em className="wb-accent">tonight?</em>
          </h1>
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <Bea state="idle" food="generic" size={36} label="Bea" />
        <p className="text-sm text-white/85">
          <strong className="font-semibold text-white">Bea</strong>
          <span> · your Wanderbite concierge</span>
        </p>
      </div>

      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (tooLong) return;
          onSubmit();
        }}
      >
        <GlowBorder radius={24} speed={6}>
          <div className="flex flex-col gap-3 px-4 pt-4 pb-3">
            <label htmlFor="discovery-message" className="sr-only">
              Tell Bea what you are craving
            </label>
            <div className="relative min-h-16">
              <textarea
                id="discovery-message"
                name="message"
                value={draft.message}
                rows={2}
                onChange={(event) => onMessage(event.target.value)}
                className="relative z-[1] w-full resize-none bg-transparent text-[17px] text-white outline-none"
              />
              {draft.message.length === 0
                ? HERO_PLACEHOLDERS.map((prompt, index) => (
                    <span
                      key={prompt}
                      aria-hidden="true"
                      data-static={index === 0 ? 'true' : undefined}
                      className="wb-placeholder-cycle pointer-events-none absolute top-0 left-0 text-[17px] text-white/60"
                      style={{ animationDelay: `${placeholderDelaySeconds(index)}s` }}
                    >
                      {prompt}
                    </span>
                  ))
                : null}
            </div>
            {tooLong ? (
              <p role="status" className="text-sm text-wb-blush">
                {DISCOVER_MESSAGE_TOO_LONG}
              </p>
            ) : null}
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 text-[13px] text-white/90"
                aria-expanded={refineOpen}
                aria-controls="discover-refine"
                onClick={onToggleRefine}
              >
                <CheckIcon />
                {dietaryButtonLabel(dietaryLabelFlags)}
              </button>
              <button
                type="button"
                className="wb-cta h-11 w-11 min-h-11 px-0"
                aria-label="Ask Bea"
                disabled={tooLong}
                onClick={() => {
                  if (tooLong) return;
                  onSubmit();
                }}
              >
                <ArrowIcon />
              </button>
            </div>
            <DiscoveryVoiceControls disabled={false} onTranscript={onMessage} />
          </div>
        </GlowBorder>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {DISCOVER_QUICK_CHIPS.map((chip, index) => (
            <button
              key={chip.label}
              type="button"
              className="wb-chip-glass shrink-0"
              onClick={() => onQuickChip(index)}
            >
              {chip.label}
            </button>
          ))}
          <button type="button" className="wb-chip-glass shrink-0" onClick={onToggleRefine}>
            Refine
          </button>
        </div>

        <p className="text-center text-sm text-white/75">{DISCOVER_ALLERGY_NOTICE}</p>

        {refineOpen ? (
          <div id="discover-refine" className="wb-glass rounded-[24px] p-4 text-white">
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">Refine</p>
              <a href="/account" className="text-sm font-medium text-wb-blush underline-offset-2 hover:underline">
                Edit saved settings
              </a>
            </div>
            <RouletteOptionsFields
              variant="page"
              selections={selections}
              onChange={onSelections}
              exclusionsSummary={exclusionsSummary}
            />
          </div>
        ) : null}
      </form>
    </div>
  );
}
