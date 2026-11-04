'use client';

import { useEffect, useRef } from 'react';
import { Bea, BEA_DISPLAY_NAME } from '@/components/bea';
import { Chip } from '@/components/wb/chip';
import { DiscoverPhoto } from '@/components/discover/discover-photo';
import type { DiscoverFood } from '@/lib/discover/events';
import type { DiscoverStepEvent } from '@/lib/discover/screen';
import {
  DISCOVER_ALLERGY_NOTICE,
  closerChipIncluded,
  directionsHref,
  offerChipLabel,
  type DiscoverOutcome,
} from '@/lib/discover/screen';

function Arrow() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

export function DiscoverPick({
  outcome,
  food,
  dietaryLabel,
  steps = [],
  onDietary,
  onAnother,
  onCheaper,
  onNewVibe,
}: {
  outcome: Extract<DiscoverOutcome, { kind: 'pick' | 'fallback' }>;
  food: DiscoverFood | 'generic';
  dietaryLabel: string;
  /** Arrived thinking steps, kept on the pick when motion is reduced. */
  steps?: readonly DiscoverStepEvent[];
  onDietary: () => void;
  onAnother: () => void;
  onCheaper: () => void;
  onNewVibe: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const alternative = outcome.kind === 'fallback';
  const partner = alternative ? outcome.event.alternative : outcome.event.partner;
  const href = directionsHref(partner);
  const offer = !alternative && outcome.event.partner.offer ? outcome.event.partner.offer : null;
  const showCloser = closerChipIncluded(partner);
  const meta = [partner.cuisine, partner.neighborhood].filter((part): part is string => Boolean(part));

  useEffect(() => {
    headingRef.current?.focus();
  }, [partner.id, alternative]);

  return (
    <div data-screen="pick" className="mx-auto w-full max-w-5xl px-3 pt-3 pb-16 lg:px-6">
      {steps.length > 0 ? (
        <ol aria-live="polite" className="mb-3 list-none p-0 text-sm text-white/80">
          {steps.map((step) => (
            <li key={step.id}>{step.label}</li>
          ))}
        </ol>
      ) : null}
      <div className="lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-start lg:gap-6">
        <div className="relative overflow-hidden rounded-[28px]">
          <DiscoverPhoto
            photoUrl={partner.photoUrl}
            photoCredit={partner.photoCredit}
            name={partner.name}
            priority
          />
          {!alternative && outcome.event.isNewToMember ? (
            <p className="wb-spin absolute top-4 right-4 flex h-20 w-20 items-center justify-center rounded-full bg-wb-blush text-center font-display text-lg text-wb-blush-ink">
              New to your Passport
            </p>
          ) : null}
        </div>

        <section
          aria-labelledby="discover-pick-heading"
          className="wb-glass-card wb-reveal -mt-10 flex flex-col gap-3 rounded-[28px] p-4 sm:p-5 lg:mt-6"
        >
          <p className="w-fit rounded-full bg-wb-blush px-3 py-1.5 text-xs font-semibold text-wb-blush-ink">
            {alternative ? 'An alternative' : 'Picked for you'}
          </p>
          <h1
            id="discover-pick-heading"
            ref={headingRef}
            tabIndex={-1}
            className="font-display text-[40px] leading-[0.95] text-white outline-none sm:text-5xl"
          >
            {partner.name}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            {meta.length > 0 ? <span className="text-sm text-white/80">{meta.join(' · ')}</span> : null}
            {offer ? (
              <span className="rounded-full bg-emerald-300 px-2 py-1 text-xs font-bold text-emerald-950">
                {offerChipLabel(offer)}
              </span>
            ) : null}
          </div>

          <div className="flex items-start gap-2.5">
            <Bea state="found" food={food} size={32} label={BEA_DISPLAY_NAME} />
            <p className="wb-voice text-lg text-[#fde4ec] sm:text-xl">
              {alternative ? outcome.event.message : `“${outcome.event.reason}”`}
            </p>
          </div>

          {!alternative ? (
            <div className="flex flex-wrap gap-1.5">
              {outcome.event.matched.map((label) => (
                <Chip key={`matched-${label}`} variant="matched">
                  {label}
                </Chip>
              ))}
              {outcome.event.unknown.map((item) => (
                <Chip key={`unknown-${item.label}`} variant="unknown">
                  {item.label}: {item.note}
                </Chip>
              ))}
              {outcome.event.unmet.map((label) => (
                <Chip key={`unmet-${label}`} variant="unknown">
                  {label}
                </Chip>
              ))}
            </div>
          ) : (
            <p className="text-sm font-semibold text-amber-200">Not a match</p>
          )}

          <button
            type="button"
            className="inline-flex h-9 w-fit items-center rounded-full border border-white/20 bg-white/10 px-3 text-[13px] text-white/90"
            onClick={onDietary}
          >
            {dietaryLabel}
          </button>

          <div className="grid grid-cols-[1.4fr_1fr] gap-2">
            {href ? (
              <a className="wb-cta min-h-[52px] px-4 text-base" href={href} target="_blank" rel="noopener noreferrer">
                Let&apos;s go
                <Arrow />
              </a>
            ) : (
              <button
                type="button"
                className="wb-cta min-h-[52px] px-4 text-base"
                aria-describedby="discover-directions-note"
              >
                Let&apos;s go
                <Arrow />
              </button>
            )}
            <button type="button" className="wb-cta-secondary wb-cta-secondary-dark min-h-[52px] text-[15px]" onClick={onAnother}>
              Another idea
            </button>
          </div>
          {href ? null : (
            <p id="discover-directions-note" className="text-xs text-white/70">
              This card has no address, so directions stay closed.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-white/70">Tweak it:</span>
            {showCloser ? (
              <button type="button" className="wb-chip-glass h-9 min-h-0 px-3 text-[13px]">
                Closer
              </button>
            ) : null}
            <button type="button" className="wb-chip-glass h-9 min-h-0 px-3 text-[13px]" onClick={onCheaper}>
              Cheaper
            </button>
            <button type="button" className="wb-chip-glass h-9 min-h-0 px-3 text-[13px]" onClick={onNewVibe}>
              New vibe
            </button>
          </div>

          <p className="text-sm text-white/75">{DISCOVER_ALLERGY_NOTICE}</p>
        </section>
      </div>
    </div>
  );
}
