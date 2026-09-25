'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ExternalLink } from 'lucide-react';
import { RestaurantPhoto } from '@/components/restaurants/restaurant-photo';
import { normalizeCuisineIds, cuisineLabel, type CuisineId } from '@/lib/cuisines';
import type { RouletteDietaryFlag } from '@/lib/roulette-dietary';
import { postRouletteSpin } from '@/lib/roulette-api-client';
import { buildRouletteSpinBody } from '@/lib/roulette-options';
import type { RoulettePriceRange, RouletteTime, RouletteVibe } from '@/lib/roulette-options';
import { LAUNCH_MARKET } from '@/lib/launch-market';
import {
  RouletteOptionsFields,
  type RouletteSelections,
} from '@/components/roulette/roulette-options-fields';
import { RestaurantReviews } from '@/components/restaurants/restaurant-reviews';
import { celebrate } from '@/lib/confetti';

export type RouletteApiResult = {
  restaurantId: string;
  restaurantName: string;
  reason: string;
  cuisine_tags: string[] | null;
  neighborhood: string | null;
  address: string | null;
  price_range: string | null;
  image_url: string | null;
  google_place_id: string | null;
  selectionMode: 'ai' | 'random_fallback';
};

type Phase = 'form' | 'loading' | 'result' | 'error';

const EMPTY_SELECTIONS: RouletteSelections = {
  vibe: null,
  timeOfDay: null,
  dietaryFlags: [],
  priceRange: null,
  preferredCuisine: null,
};

const ALLERGY_NOTE = 'Discovery cannot assess allergies. Ask the restaurant.';

function RouletteResultPhoto({ result }: { result: RouletteApiResult }) {
  return (
    <div className="aspect-[16/10] w-full shrink-0 overflow-hidden rounded-xl bg-muted">
      <RestaurantPhoto
        restaurantId={result.restaurantId}
        imageUrl={result.image_url}
        googlePlaceId={result.google_place_id}
      />
    </div>
  );
}

export function RouletteClient() {
  const askInFlightRef = useRef(false);
  const resultSectionRef = useRef<HTMLDivElement>(null);

  const [phase, setPhase] = useState<Phase>('form');
  const [selections, setSelections] = useState<RouletteSelections>(EMPTY_SELECTIONS);
  const [excludedCuisines, setExcludedCuisines] = useState<CuisineId[]>([]);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<RouletteApiResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('wb_excluded_cuisines');
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      setExcludedCuisines(normalizeCuisineIds(parsed));
    } catch {
      // ignore
    }
  }, []);

  const exclusionsSummary = useMemo(() => {
    if (excludedCuisines.length === 0) return null;
    const first = excludedCuisines.slice(0, 3).map(cuisineLabel);
    const more = excludedCuisines.length - first.length;
    return more > 0 ? `${first.join(', ')} +${more} more` : first.join(', ');
  }, [excludedCuisines]);

  const mapsHref = useMemo(() => {
    if (!result?.restaurantName) return '#';
    const q = encodeURIComponent(`${result.restaurantName} ${LAUNCH_MARKET.cityQuery}`);
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
  }, [result?.restaurantName]);

  const ask = useCallback(
    async (opts?: { surprise?: boolean }) => {
      if (askInFlightRef.current) return;
      askInFlightRef.current = true;
      setErrorMessage(null);
      setResult(null);
      setPhase('loading');

      const idempotencyKey = crypto.randomUUID();
      const payload = buildRouletteSpinBody({
        vibe: opts?.surprise ? null : (selections.vibe as RouletteVibe | null),
        timeOfDay: opts?.surprise ? null : (selections.timeOfDay as RouletteTime | null),
        dietaryFlags: selections.dietaryFlags as RouletteDietaryFlag[],
        excludedCuisines,
        priceRange: opts?.surprise ? null : (selections.priceRange as RoulettePriceRange | null),
        preferredCuisine: opts?.surprise ? null : selections.preferredCuisine,
        message: opts?.surprise ? null : message,
        surprise: opts?.surprise,
      });

      try {
        const askResult = await postRouletteSpin(payload, idempotencyKey);
        if (!askResult.ok) {
          setErrorMessage(askResult.error);
          setPhase('error');
          return;
        }
        setResult(askResult.data);
        setPhase('result');
        void celebrate();
      } catch {
        setErrorMessage('Network error. Check your connection and try again.');
        setPhase('error');
      } finally {
        askInFlightRef.current = false;
      }
    },
    [excludedCuisines, message, selections],
  );

  const changeOptions = useCallback(() => {
    setPhase('form');
    setResult(null);
    setErrorMessage(null);
  }, []);

  useEffect(() => {
    if (phase !== 'result' || !result?.restaurantId) return;
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const id = window.setTimeout(() => {
      const region = resultSectionRef.current;
      if (!region) return;
      region.scrollIntoView({
        behavior: prefersReduced ? 'auto' : 'smooth',
        block: 'start',
      });
      region.focus();
    }, 350);
    return () => clearTimeout(id);
  }, [phase, result?.restaurantId]);

  return (
    <div className="mx-auto flex max-w-lg flex-col px-4 py-12 sm:py-16">
      {phase !== 'result' ? (
        <p className="mb-8 text-center text-sm text-muted-foreground">{ALLERGY_NOTE}</p>
      ) : null}

      {phase === 'form' && (
        <form
          className="flex flex-col items-center space-y-8 text-center"
          onSubmit={(event) => {
            event.preventDefault();
            void ask();
          }}
        >
          <div className="space-y-3">
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Not sure where to eat tonight?
            </h1>
            <p className="text-lg text-muted-foreground">
              Add a mood, or leave it blank and we&apos;ll suggest a partner.
            </p>
          </div>

          <div className="w-full space-y-3 text-left">
            <label htmlFor="discovery-message" className="text-sm font-medium text-foreground">
              What are you in the mood for?
            </label>
            <textarea
              id="discovery-message"
              name="message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={3}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-[#E85D26]"
              placeholder="Date night, something casual, a quiet room"
            />
          </div>

          <div className="w-full rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm sm:p-6">
            <RouletteOptionsFields
              variant="page"
              selections={selections}
              onChange={(patch) => setSelections((prev) => ({ ...prev, ...patch }))}
              exclusionsSummary={exclusionsSummary}
            />
          </div>

          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <Button
              type="submit"
              size="lg"
              className="h-12 min-w-[220px] rounded-full bg-[#E85D26] px-8 text-base font-semibold text-white hover:bg-[#d14f1f]"
            >
              Find a spot
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="h-12 min-w-[220px] rounded-full px-8 text-base"
              onClick={() => void ask({ surprise: true })}
            >
              Surprise me
            </Button>
          </div>
        </form>
      )}

      {phase === 'loading' && (
        <div className="flex min-h-[40vh] flex-col items-center justify-center space-y-3 text-center">
          <p className="text-lg font-semibold text-foreground">Finding a restaurant…</p>
          <p className="text-sm text-muted-foreground">This usually takes a few seconds.</p>
        </div>
      )}

      {phase === 'error' && (
        <div className="flex min-h-[40vh] flex-col items-center justify-center space-y-6 text-center">
          <p className="text-lg text-foreground">
            {errorMessage || 'Something went wrong. Please try again.'}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              onClick={() => void ask()}
              className="rounded-full bg-[#E85D26] text-white hover:bg-[#d14f1f]"
            >
              Try again
            </Button>
            <Button type="button" variant="ghost" onClick={changeOptions}>
              Change options
            </Button>
          </div>
        </div>
      )}

      {phase === 'result' && result && (
        <div
          ref={resultSectionRef}
          tabIndex={-1}
          aria-labelledby="discovery-result-heading"
          className="flex flex-col space-y-8 scroll-mt-6 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[#E85D26] animate-in fade-in slide-in-from-bottom-4 duration-500"
        >
          <p className="text-center text-sm text-muted-foreground">{ALLERGY_NOTE}</p>
          <div className="text-center">
            <p className="text-sm font-medium uppercase tracking-wide text-[#E85D26]">
              Tonight&apos;s pick
            </p>
            <h2
              id="discovery-result-heading"
              className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl"
            >
              {result.restaurantName}
            </h2>
            <div className="mt-1 flex items-center justify-center gap-2 text-muted-foreground">
              {result.neighborhood ? <span>{result.neighborhood}</span> : null}
              {result.neighborhood && result.price_range ? <span aria-hidden>·</span> : null}
              {result.price_range ? (
                <span className="font-medium text-foreground">{result.price_range}</span>
              ) : null}
            </div>
          </div>

          <RouletteResultPhoto key={result.restaurantId} result={result} />

          <div className="rounded-xl border bg-card p-6 shadow-sm max-md:shadow-lg max-md:ring-1 max-md:ring-border/60">
            <div className="mb-4 flex flex-wrap gap-1.5">
              {(result.cuisine_tags ?? []).length ? (
                (result.cuisine_tags ?? []).map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">
                  {LAUNCH_MARKET.displayName} partner
                </span>
              )}
            </div>
            <p className="text-sm leading-relaxed text-foreground">{result.reason}</p>
            {result.selectionMode !== 'ai' ? (
              <p className="mt-3 text-xs text-muted-foreground">
                This suggestion was not chosen by the assistant. Confirm details with the
                restaurant.
              </p>
            ) : null}

            <RestaurantReviews
              restaurantId={result.restaurantId}
              className="mt-6 border-t border-border/60 pt-4"
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button
              asChild
              size="lg"
              className="rounded-full bg-[#E85D26] font-semibold text-white hover:bg-[#d14f1f]"
            >
              <a href={mapsHref} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 size-4" aria-hidden />
                Get Directions
              </a>
            </Button>
            <Button type="button" variant="outline" className="rounded-full" onClick={() => void ask()}>
              Ask again
            </Button>
          </div>

          <p className="text-center text-sm text-muted-foreground">
            Wanderbite members see the discount on each challenge.{' '}
            <Link
              href="/pricing"
              className="font-medium text-[#E85D26] underline-offset-2 hover:underline"
            >
              Join for $15/month →
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
