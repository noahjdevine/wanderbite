'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CtaButton } from '@/components/wb/cta-button';
import { GlowBorder } from '@/components/wb/glow-border';
import {
  HERO_PLACEHOLDERS,
  HERO_QUICK_STARTS,
  discoverHref,
  placeholderDelaySeconds,
} from '@/lib/home/hero';
import { ROULETTE_MAX_MESSAGE_CHARS } from '@/lib/ai-bounds';

function Spark({ size = 16 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C13 8 16 11 24 12C16 13 13 16 12 24C11 16 8 13 0 12C8 11 11 8 12 0Z" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 17v5" />
    </svg>
  );
}

export function HomeHeroPrompt() {
  const router = useRouter();
  const [value, setValue] = useState('');

  function go(text: string) {
    router.push(discoverHref(text));
  }

  return (
    <div className="flex w-full min-w-0 max-w-[600px] flex-col gap-4">
      <GlowBorder radius={26} speed={6} className="w-full min-w-0 shadow-[0_24px_60px_rgba(0,0,0,0.45)]">
        <form
          id="home-hero-form"
          action="/roulette"
          method="get"
          className="wb-hero-prompt flex min-w-0 items-center gap-2 py-2.5 pr-2.5 pl-4 sm:pl-5"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            go(String(data.get('q') ?? ''));
          }}
        >
          <label htmlFor="home-hero-prompt" className="sr-only">
            What are you in the mood for?
          </label>
          <div className="relative h-12 min-w-0 flex-1">
            <input
              id="home-hero-prompt"
              name="q"
              value={value}
              maxLength={ROULETTE_MAX_MESSAGE_CHARS}
              autoComplete="off"
              enterKeyHint="search"
              onChange={(event) => setValue(event.target.value)}
              className="absolute inset-0 w-full bg-transparent text-[17px] text-white outline-none"
            />
            {value.length === 0
              ? HERO_PLACEHOLDERS.map((prompt, index) => (
                  <span
                    key={prompt}
                    aria-hidden="true"
                    data-static={index === 0 ? 'true' : undefined}
                    className="wb-placeholder-cycle pointer-events-none absolute top-3 left-0 max-w-full truncate text-[17px] text-white/70"
                    style={{ animationDelay: `${placeholderDelaySeconds(index)}s` }}
                  >
                    {prompt}
                  </span>
                ))
              : null}
          </div>
          <CtaButton
            href={discoverHref(value)}
            variant="secondary-dark"
            iconOnly
            aria-label="Speak your request"
          >
            <MicIcon />
          </CtaButton>
          <CtaButton
            type="submit"
            className="shrink-0 px-4 sm:px-5"
            onClick={(event) => {
              event.preventDefault();
              const field = event.currentTarget.form?.elements.namedItem('q');
              const text = field instanceof HTMLInputElement ? field.value : value;
              go(text);
            }}
          >
            Ask Bea
            <Spark />
          </CtaButton>
        </form>
      </GlowBorder>

      <div className="flex flex-wrap gap-2.5">
        {HERO_QUICK_STARTS.map((label) => (
          <a
            key={label}
            href={discoverHref(label)}
            className="wb-chip-glass min-h-11 cursor-pointer px-4 text-sm font-medium no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wb-blush"
          >
            {label}
          </a>
        ))}
      </div>
    </div>
  );
}
