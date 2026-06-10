'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RESTAURANT_IMAGE_PLACEHOLDER,
  restaurantDisplayImageUrl,
} from '@/lib/restaurant-image';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ExternalLink } from 'lucide-react';
import { normalizeCuisineIds, cuisineLabel, type CuisineId } from '@/lib/cuisines';
import type { RouletteDietaryFlag } from '@/lib/roulette-dietary';
import { postRouletteSpin } from '@/lib/roulette-api-client';
import { buildRouletteSpinBody } from '@/lib/roulette-options';
import type { RoulettePriceRange, RouletteTime, RouletteVibe } from '@/lib/roulette-options';
import {
  RouletteOptionsFields,
  type RouletteSelections,
} from '@/components/roulette/roulette-options-fields';
import {
  RouletteWheel,
  type RouletteWheelHandle,
} from '@/components/roulette/roulette-wheel';
import { RestaurantReviews } from '@/components/restaurants/restaurant-reviews';
import { celebrate } from '@/lib/confetti';

export type RouletteApiResult = {
  restaurantId: string;
  restaurantName: string;
  reason: string;
  vibeMatch: string | null;
  suggestedDish: string | null;
  cuisine_tags: string[] | null;
  neighborhood: string | null;
  address: string | null;
  price_range: string | null;
  image_url: string | null;
  google_photo_url: string | null;
  google_place_id: string | null;
};

type Phase = 'form' | 'spinning' | 'result' | 'error';

const EMPTY_SELECTIONS: RouletteSelections = {
  vibe: null,
  timeOfDay: null,
  dietaryFlags: [],
  priceRange: null,
  preferredCuisine: null,
};

function RouletteResultPhoto({ result }: { result: RouletteApiResult }) {
  const [src, setSrc] = useState(() =>
    restaurantDisplayImageUrl({
      id: result.restaurantId,
      google_place_id: result.google_place_id,
      google_photo_url: result.google_photo_url,
      image_url: result.image_url,
    })
  );

  return (
    <div className="aspect-[16/10] w-full shrink-0 overflow-hidden rounded-xl bg-muted">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        width={800}
        height={600}
        className="h-full w-full"
        style={{ objectFit: 'cover' }}
        onError={() => setSrc(RESTAURANT_IMAGE_PLACEHOLDER)}
      />
    </div>
  );
}

export function RouletteClient() {
  const wheelRef = useRef<RouletteWheelHandle>(null);
  const spinInFlightRef = useRef(false);
  const resultSectionRef = useRef<HTMLDivElement>(null);

  const [phase, setPhase] = useState<Phase>('form');
  const [selections, setSelections] = useState<RouletteSelections>(EMPTY_SELECTIONS);
  const [excludedCuisines, setExcludedCuisines] = useState<CuisineId[]>([]);
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
    const q = encodeURIComponent(`${result.restaurantName} Austin TX`);
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
  }, [result?.restaurantName]);

  const spin = useCallback(async () => {
    if (spinInFlightRef.current) return;
    spinInFlightRef.current = true;
    setErrorMessage(null);
    setResult(null);
    setPhase('spinning');

    const apiPromise = postRouletteSpin(
      buildRouletteSpinBody({
        vibe: selections.vibe as RouletteVibe | null,
        timeOfDay: selections.timeOfDay as RouletteTime | null,
        dietaryFlags: selections.dietaryFlags as RouletteDietaryFlag[],
        excludedCuisines,
        priceRange: selections.priceRange as RoulettePriceRange | null,
        preferredCuisine: selections.preferredCuisine,
      })
    );

    // Wait one frame so the interactive wheel has mounted before we spin it.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    const wheelPromise =
      wheelRef.current?.spin() ??
      new Promise<void>((r) => window.setTimeout(r, 2500));

    try {
      const [, spinResult] = await Promise.all([wheelPromise, apiPromise]);
      if (!spinResult.ok) {
        setErrorMessage(spinResult.error);
        setPhase('error');
        return;
      }
      setResult(spinResult.data);
      setPhase('result');
      void celebrate();
    } catch {
      setErrorMessage('Network error. Check your connection and try again.');
      setPhase('error');
    } finally {
      spinInFlightRef.current = false;
    }
  }, [excludedCuisines, selections]);

  const spinAgain = useCallback(() => {
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
      resultSectionRef.current?.scrollIntoView({
        behavior: prefersReduced ? 'auto' : 'smooth',
        block: 'start',
      });
    }, 350);
    return () => clearTimeout(id);
  }, [phase, result?.restaurantId]);

  return (
    <div className="mx-auto flex max-w-lg flex-col px-4 py-12 sm:py-16">
      {phase === 'form' && (
        <div className="flex flex-col items-center space-y-8 text-center">
          <div className="space-y-3">
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Not sure where to eat tonight?
            </h1>
            <p className="text-lg text-muted-foreground">
              Set your vibe, then let Wanderbite Roulette decide.
            </p>
          </div>

          <RouletteWheel mode="idle" decorative />

          <div className="w-full rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm sm:p-6">
            <RouletteOptionsFields
              variant="page"
              selections={selections}
              onChange={(patch) =>
                setSelections((prev) => ({ ...prev, ...patch }))
              }
              exclusionsSummary={exclusionsSummary}
            />
          </div>

          <Button
            type="button"
            size="lg"
            className="h-12 min-w-[220px] rounded-full bg-[#E85D26] px-8 text-base font-semibold text-white hover:bg-[#d14f1f]"
            onClick={() => void spin()}
          >
            Spin the Wheel 🎲
          </Button>
        </div>
      )}

      {phase === 'spinning' && (
        <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-8 text-center">
          <RouletteWheel
            ref={wheelRef}
            mode="interactive"
            className="w-[clamp(240px,75vw,340px)] transition-[width] duration-500 ease-out"
            decorative
          />
          <div className="space-y-1">
            <p className="text-lg font-semibold text-foreground">
              The wheel is spinning…
            </p>
            <p className="text-sm text-muted-foreground">
              Wanderbite Roulette is picking your spot.
            </p>
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="flex min-h-[40vh] flex-col items-center justify-center space-y-6 text-center">
          <p className="text-lg text-foreground">
            {errorMessage ||
              'Something went wrong. Please try Wanderbite Roulette again.'}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              onClick={() => void spin()}
              className="rounded-full bg-[#E85D26] text-white hover:bg-[#d14f1f]"
            >
              Try again
            </Button>
            <Button type="button" variant="ghost" onClick={spinAgain}>
              Change options
            </Button>
          </div>
        </div>
      )}

      {phase === 'result' && result && (
        <div
          ref={resultSectionRef}
          className="flex flex-col space-y-8 scroll-mt-6 animate-in fade-in slide-in-from-bottom-4 duration-500"
        >
          <div className="text-center">
            <p className="text-sm font-medium uppercase tracking-wide text-[#E85D26]">
              🎯 Tonight&apos;s Pick
            </p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
              {result.restaurantName}
            </h2>
            <div className="mt-1 flex items-center justify-center gap-2 text-muted-foreground">
              {result.neighborhood ? <span>{result.neighborhood}</span> : null}
              {result.neighborhood && result.price_range ? (
                <span aria-hidden>·</span>
              ) : null}
              {result.price_range ? (
                <span className="font-medium text-foreground">
                  {result.price_range}
                </span>
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
                <span className="text-sm text-muted-foreground">Austin partner</span>
              )}
            </div>
            <p className="text-sm leading-relaxed text-foreground">{result.reason}</p>
            {result.vibeMatch ? (
              <p className="mt-3 text-xs font-medium text-[#E85D26]">
                Vibe match: {result.vibeMatch}
              </p>
            ) : null}
            {result.suggestedDish ? (
              <p className="mt-2 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Try:</span>{' '}
                {result.suggestedDish}
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
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              onClick={() => void spin()}
            >
              Spin Again
            </Button>
          </div>

          <p className="text-center text-sm text-muted-foreground">
            Wanderbite members get $10 off here.{' '}
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
