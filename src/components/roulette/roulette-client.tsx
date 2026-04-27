'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RESTAURANT_IMAGE_PLACEHOLDER,
  restaurantDisplayImageUrl,
} from '@/lib/restaurant-image';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  ExternalLink,
  Leaf,
  MilkOff,
  ShieldCheck,
  UtensilsCrossed,
} from 'lucide-react';
import type { DietaryQuickFlag } from '@/lib/roulette-dietary';
import { cuisineLabel, normalizeCuisineIds, type CuisineId } from '@/lib/cuisines';

const VIBES = [
  'Adventurous',
  'Comfort Food',
  'Date Night',
  'Quick Bite',
  'Special Occasion',
] as const;

const TIMES = ['Lunch', 'Dinner', 'Late Night'] as const;

const DIETARY = [
  'No restrictions',
  'Vegetarian-friendly',
  'Gluten-free options',
] as const;

const DIETARY_QUICK_PILLS: {
  value: DietaryQuickFlag;
  label: string;
  Icon: typeof MilkOff;
}[] = [
  { value: 'dairy_free', label: 'Dairy-Free', Icon: MilkOff },
  { value: 'vegan', label: 'Vegan', Icon: Leaf },
  { value: 'halal', label: 'Halal', Icon: ShieldCheck },
];

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
};

type Phase = 'form' | 'loading' | 'result' | 'error';

function RouletteResultPhoto({ result }: { result: RouletteApiResult }) {
  const [src, setSrc] = useState(() =>
    restaurantDisplayImageUrl({
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

function PillGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T | null;
  onChange: (next: T | null) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {options.map((opt) => {
          const selected = value === opt;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(selected ? null : opt)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                selected
                  ? 'border-[#E85D26] bg-[#E85D26] text-white shadow-sm'
                  : 'border-border bg-background text-foreground hover:border-[#E85D26]/50'
              )}
            >
              {opt}
            </button>
          );
        })}
      </div>
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
  const [vibe, setVibe] = useState<(typeof VIBES)[number] | null>(null);
  const [quickDietary, setQuickDietary] = useState<DietaryQuickFlag[]>([]);
  const [excludedCuisines, setExcludedCuisines] = useState<CuisineId[]>([]);
  const [timeOfDay, setTimeOfDay] = useState<(typeof TIMES)[number] | null>(null);
  const [dietary, setDietary] = useState<(typeof DIETARY)[number] | null>(null);
  const [result, setResult] = useState<RouletteApiResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showMobileScrollCue, setShowMobileScrollCue] = useState(false);

  // Optional: if the user is logged in, honor their saved exclusions automatically.
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
      const res = await fetch('/api/roulette', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          vibe: vibe ?? undefined,
          timeOfDay: timeOfDay ?? undefined,
          dietary: dietary ?? undefined,
          dietaryQuick: quickDietary.length > 0 ? quickDietary : undefined,
          excludedCuisines: excludedCuisines.length > 0 ? excludedCuisines : undefined,
        }),
      });
      const data = (await res.json()) as { error?: string } & Partial<RouletteApiResult>;
      if (!res.ok) {
        setErrorMessage(data.error ?? 'Something went wrong. Please try again.');
        setShowMobileScrollCue(false);
        setPhase('error');
        return;
      }
      if (!data.restaurantId || !data.restaurantName || !data.reason) {
        setErrorMessage('We got an unexpected response. Please try Wanderbite Roulette again.');
        setShowMobileScrollCue(false);
        setPhase('error');
        return;
      }
      setResult({
        restaurantId: data.restaurantId,
        restaurantName: data.restaurantName,
        reason: data.reason,
        vibeMatch: data.vibeMatch ?? null,
        suggestedDish: data.suggestedDish ?? null,
        cuisine_tags: data.cuisine_tags ?? null,
        neighborhood: data.neighborhood ?? null,
        address: data.address ?? null,
        image_url: data.image_url ?? null,
        google_photo_url: data.google_photo_url ?? null,
      });
      setPhase('result');
    } catch {
      setErrorMessage('Network error. Check your connection and try again.');
      setShowMobileScrollCue(false);
      setPhase('error');
    }
  }, [dietary, excludedCuisines, quickDietary, timeOfDay, vibe]);

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
            {exclusionsSummary ? (
              <p className="text-sm text-muted-foreground">
                Honoring your cuisine exclusions: <span className="font-medium text-foreground">{exclusionsSummary}</span>.{' '}
                <Link href="/account" className="font-medium text-primary underline-offset-2 hover:underline">
                  Edit
                </Link>
              </p>
            ) : null}
          </div>

          <div className="w-full space-y-8">
            <PillGroup
              label="Vibe (optional)"
              options={VIBES}
              value={vibe}
              onChange={setVibe}
            />
            <PillGroup
              label="Time (optional)"
              options={TIMES}
              value={timeOfDay}
              onChange={setTimeOfDay}
            />
            <PillGroup
              label="Dietary (optional)"
              options={DIETARY}
              value={dietary}
              onChange={setDietary}
            />

            <div className="space-y-2">
              <p className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Quick dietary (multi-select)
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {DIETARY_QUICK_PILLS.map(({ value, label, Icon }) => {
                  const on = quickDietary.includes(value);
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() =>
                        setQuickDietary((prev) =>
                          prev.includes(value)
                            ? prev.filter((f) => f !== value)
                            : [...prev, value]
                        )
                      }
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                        on
                          ? 'border-[#E85D26] bg-[#E85D26] text-white shadow-sm'
                          : 'border-border bg-background text-foreground hover:border-[#E85D26]/50'
                      )}
                    >
                      <Icon className="size-3.5 shrink-0" aria-hidden />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

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
