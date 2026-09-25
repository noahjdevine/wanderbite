'use client';

import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Landing-page hero. Clicking the card or the button navigates to /roulette.
 * It performs no fetch and imports no rate-limit code.
 */
export function RouletteHero() {
  return (
    <section
      id="roulette"
      className="relative flex w-full flex-col items-center bg-gradient-to-b from-[#f5f0ff] via-[#faf7ff] to-[#f0e8ff] px-4 pb-20 pt-8 max-md:min-h-0 max-md:justify-start md:min-h-[85vh] md:justify-center md:px-8"
      aria-label="Discover where to eat"
    >
      <div className="mx-auto flex w-full max-w-lg flex-col items-center text-center">
        <p className="text-sm font-semibold tracking-wide text-primary">
          FREE — No account needed
        </p>
        <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl md:text-5xl">
          Where should you eat tonight?
        </h2>
        <p className="mt-4 max-w-md text-base text-muted-foreground sm:text-lg">
          Tell us the mood. One partner suggestion, built for adventure.
        </p>

        <Link
          href="/roulette"
          aria-label="Open Discover"
          className="group mt-10 flex w-full max-w-sm flex-col items-center rounded-3xl border border-violet-200/80 bg-white/80 px-6 py-8 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <p className="text-lg font-semibold text-foreground">Not sure where to start?</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Open Discover and ask for a spot.
          </p>
        </Link>

        <Button
          asChild
          size="lg"
          className="mt-10 h-12 min-w-[220px] rounded-full bg-primary px-8 text-base font-semibold text-primary-foreground shadow-md hover:bg-primary/90"
        >
          <Link href="/roulette">Find a spot</Link>
        </Button>
      </div>

      <a
        href="#landing-continue"
        className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-1 text-muted-foreground transition-colors hover:text-primary md:flex"
        aria-label="Scroll to more content"
      >
        <span className="text-xs font-medium">More below</span>
        <ChevronDown className="size-6 animate-bounce" aria-hidden />
      </a>
    </section>
  );
}
