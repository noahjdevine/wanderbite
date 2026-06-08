'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RESTAURANT_IMAGE_PLACEHOLDER,
  restaurantDisplayImageUrl,
} from '@/lib/restaurant-image';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, UtensilsCrossed } from 'lucide-react';
import { normalizeCuisineIds, cuisineLabel, type CuisineId } from '@/lib/cuisines';
import type { RouletteDietaryFlag } from '@/lib/roulette-dietary';
import { postRouletteSpin } from '@/lib/roulette-api-client';
import { buildRouletteSpinBody } from '@/lib/roulette-options';
import type { RoulettePriceRange, RouletteTime, RouletteVibe } from '@/lib/roulette-options';
import {
  RouletteOptionsFields,
  type RouletteSelections,
} from '@/components/roulette/roulette-options-fields';

export type RouletteApiResult = {
  restaurantId: string;
  restaurantName: string;
  reason: string;
  vibeMatch: string | null;
  suggestedDish: string | null;
  cuisine_tags: string[] | null;
  neighborhood: string | null;
  address: string | null;
  image_url: string | null;
  google_photo_url: string | null;
  google_place_id: string | null;
};

type Phase = 'form' | 'loading' | 'result' | 'error';

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

function SpinningWheel({ showMobileCue }: { showMobileCue?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-6 py-8">
      <style>{`
        @keyframes wanderbite-roulette-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .wb-roulette-wheel {
          animation: wanderbite-roulette-spin 1.1s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .wb-roulette-wheel { animation: none; }
        }
      `}</style>
      <div
        className="wb-roulette-wheel relative size-28 rounded-full border-4 border-dashed border-[#E85D26] shadow-lg"
        style={{
          background:
            'conic-gradient(from 0deg, #E85D26 0deg 45deg, #fff4ef 45deg 90deg, #E85D26 90deg 135deg, #fff4ef 135deg 180deg, #E85D26 180deg 225deg, #fff4ef 225deg 270deg, #E85D26 270deg 315deg, #fff4ef 315deg 360deg)',
        }}
        aria-hidden
      >
        <div className="absolute inset-[18%] flex items-center justify-center rounded-full bg-white shadow-inner">
          <UtensilsCrossed className="size-8 text-[#E85D26]" aria-hidden />
        </div>
      </div>
      <p className="text-lg font-medium text-foreground">The wheel is spinning…</p>
      <p className="text-sm text-muted-foreground">Wanderbite Roulette is picking your spot.</p>
      {showMobileCue ? (
        <p className="mt-2 hidden max-md:flex flex-col items-center gap-0.5 text-xs font-semibold text-[#E85D26] animate-bounce">
          <span className="text-base leading-none" aria-hidden>
            ↓
          </span>
          <span>Your pick is on the way</span>
        </p>
      ) : null}
    </div>
  );
}

export function RouletteClient() {
  const resultSectionRef = useRef<HTMLDivElement>(null);
  const scrollCueHideTimeoutRef = useRef<number | null>(null);

  const [phase, setPhase] = useState<Phase>('form');
  const [selections, setSelections] = useState<RouletteSelections>(EMPTY_SELECTIONS);
  const [excludedCuisines, setExcludedCuisines] = useState<CuisineId[]>([]);
  const [result, setResult] = useState<RouletteApiResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showMobileScrollCue, setShowMobileScrollCue] = useState(false);

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
    setPhase('loading');
    setShowMobileScrollCue(true);
    setErrorMessage(null);
    setResult(null);
    try {
      const spinResult = await postRouletteSpin(
        buildRouletteSpinBody({
          vibe: selections.vibe as RouletteVibe | null,
          timeOfDay: selections.timeOfDay as RouletteTime | null,
          dietaryFlags: selections.dietaryFlags as RouletteDietaryFlag[],
          excludedCuisines,
          priceRange: selections.priceRange as RoulettePriceRange | null,
          preferredCuisine: selections.preferredCuisine,
        })
      );
      if (!spinResult.ok) {
        setErrorMessage(spinResult.error);
        setShowMobileScrollCue(false);
        setPhase('error');
        return;
      }
      setResult(spinResult.data);
      setPhase('result');
    } catch {
      setErrorMessage('Network error. Check your connection and try again.');
      setShowMobileScrollCue(false);
      setPhase('error');
    }
  }, [excludedCuisines, selections]);

  const spinAgain = useCallback(() => {
    setPhase('form');
    setResult(null);
    setErrorMessage(null);
    setShowMobileScrollCue(false);
  }, []);

  useEffect(() => {
    if (phase !== 'result' || !result?.restaurantId) return;
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isMobile =
      typeof window !== 'undefined' &&
      !window.matchMedia('(min-width: 768px)').matches;
    const id = window.setTimeout(() => {
      resultSectionRef.current?.scrollIntoView({
        behavior: prefersReduced ? 'auto' : 'smooth',
        block: isMobile ? 'start' : 'center',
      });
    }, 400);
    return () => clearTimeout(id);
  }, [phase, result?.restaurantId]);

  useEffect(() => {
    if (phase !== 'result' || !result?.restaurantId) return;
    if (scrollCueHideTimeoutRef.current) {
      clearTimeout(scrollCueHideTimeoutRef.current);
      scrollCueHideTimeoutRef.current = null;
    }
    const el = resultSectionRef.current;
    if (!el || typeof window === 'undefined') return;

    const mq = window.matchMedia('(min-width: 768px)');
    if (mq.matches) {
      setShowMobileScrollCue(false);
      return;
    }

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setShowMobileScrollCue(false);
      if (scrollCueHideTimeoutRef.current) {
        clearTimeout(scrollCueHideTimeoutRef.current);
        scrollCueHideTimeoutRef.current = null;
      }
    };

    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.12)) {
          finish();
        }
      },
      { threshold: [0, 0.12, 0.25] }
    );
    obs.observe(el);
    scrollCueHideTimeoutRef.current = window.setTimeout(finish, 4000);
    return () => {
      obs.disconnect();
      if (scrollCueHideTimeoutRef.current) {
        clearTimeout(scrollCueHideTimeoutRef.current);
        scrollCueHideTimeoutRef.current = null;
      }
    };
  }, [phase, result?.restaurantId]);

  return (
    <div className="mx-auto flex max-w-lg flex-col px-4 py-12 max-md:min-h-0 sm:py-16 md:min-h-[70vh]">
      {phase === 'form' && (
        <div className="flex flex-1 flex-col items-center justify-center space-y-10 text-center">
          <div className="space-y-3">
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Not sure where to eat tonight?
            </h1>
            <p className="text-lg text-muted-foreground">
              Let Wanderbite Roulette decide.
            </p>
          </div>

          <RouletteOptionsFields
            variant="page"
            selections={selections}
            onChange={(patch) =>
              setSelections((prev) => ({ ...prev, ...patch }))
            }
            exclusionsSummary={exclusionsSummary}
          />

          <Button
            type="button"
            size="lg"
            className="h-12 min-w-[200px] rounded-full bg-[#E85D26] px-8 text-base font-semibold text-white hover:bg-[#d14f1f]"
            onClick={spin}
          >
            Spin the Wheel
          </Button>
        </div>
      )}

      {phase === 'loading' && <SpinningWheel showMobileCue />}

      {phase === 'error' && (
        <div className="flex flex-1 flex-col items-center justify-center space-y-6 text-center">
          <p className="text-lg text-foreground">
            {errorMessage ||
              'Something went wrong. Please try Wanderbite Roulette again.'}
          </p>
          <Button type="button" onClick={spin} variant="default" className="rounded-full">
            Try again
          </Button>
          <Button type="button" variant="ghost" onClick={spinAgain}>
            Change options
          </Button>
        </div>
      )}

      {phase === 'result' && result && (
        <div
          ref={resultSectionRef}
          className="relative z-0 mt-16 flex flex-1 flex-col space-y-8 scroll-mt-6 max-md:border-t max-md:border-border/80 max-md:pt-10 md:mt-0 md:scroll-mt-0 md:border-t-0 md:pt-0"
        >
          {showMobileScrollCue ? (
            <p className="hidden max-md:flex flex-col items-center gap-0.5 text-center text-xs font-semibold text-[#E85D26] animate-bounce">
              <span className="text-base leading-none" aria-hidden>
                ↓
              </span>
              <span>Scroll for your pick</span>
            </p>
          ) : null}
          <div className="text-center">
            <p className="text-sm font-medium uppercase tracking-wide text-[#E85D26]">
              Wanderbite Roulette
            </p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
              {result.restaurantName}
            </h2>
            {result.neighborhood ? (
              <p className="mt-1 text-muted-foreground">{result.neighborhood}</p>
            ) : null}
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
            <Button type="button" variant="outline" className="rounded-full" onClick={spinAgain}>
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
