'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  ChevronDown,
  ExternalLink,
  Leaf,
  Loader2,
  MilkOff,
  Share2,
  ShieldCheck,
} from 'lucide-react';
import type { DietaryQuickFlag } from '@/lib/roulette-dietary';
import { toast } from 'sonner';
import { shareOrCopy } from '@/lib/share';
import { WANDERBITE_RESET_ROULETTE_EVENT } from '@/lib/wanderbite-roulette-events';
import type { RouletteApiResult } from '@/components/roulette/roulette-client';
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

const VIBE_PILLS: { label: string; value: (typeof VIBES)[number] }[] = [
  { label: '🍕 Comfort Food', value: 'Comfort Food' },
  { label: '🥂 Date Night', value: 'Date Night' },
  { label: '🌶️ Adventurous', value: 'Adventurous' },
  { label: '⚡ Quick Bite', value: 'Quick Bite' },
  { label: '✨ Special Occasion', value: 'Special Occasion' },
];

const DIETARY_QUICK_PILLS: {
  value: DietaryQuickFlag;
  label: string;
  Icon: typeof MilkOff;
}[] = [
  { value: 'dairy_free', label: 'Dairy-Free', Icon: MilkOff },
  { value: 'vegan', label: 'Vegan', Icon: Leaf },
  { value: 'halal', label: 'Halal', Icon: ShieldCheck },
];

function RefinePillGroup<T extends string>({
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
                  ? 'border-primary bg-primary/15 text-primary shadow-sm'
                  : 'border-border bg-background text-foreground hover:border-primary/40'
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

export function RouletteHero() {
  const wheelRef = useRef<HTMLDivElement>(null);
  const angleRef = useRef(0);
  const modeRef = useRef<'idle' | 'fast' | 'coast'>('idle');
  const rafRef = useRef<number>(0);
  /** Browser timer id — typed as number for DOM `setTimeout` return type. */
  const resultRevealTimeoutRef = useRef<number | null>(null);
  const coastEndTimeoutRef = useRef<number | null>(null);
  const resultSectionRef = useRef<HTMLDivElement>(null);
  const scrollCueHideTimeoutRef = useRef<number | null>(null);

  const [quickVibe, setQuickVibe] = useState<(typeof VIBES)[number] | null>(null);
  const [quickDietary, setQuickDietary] = useState<DietaryQuickFlag[]>([]);
  const [excludedCuisines, setExcludedCuisines] = useState<CuisineId[]>([]);
  const [refineVibe, setRefineVibe] = useState<(typeof VIBES)[number] | null>(null);
  const [timeOfDay, setTimeOfDay] = useState<(typeof TIMES)[number] | null>(null);
  const [dietary, setDietary] = useState<(typeof DIETARY)[number] | null>(null);

  const [spinning, setSpinning] = useState(false);
  const [allowRefine, setAllowRefine] = useState(false);
  const [result, setResult] = useState<RouletteApiResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [typedReason, setTypedReason] = useState('');
  /** Mobile-only: show bounce hint until result is in view or timeout. */
  const [showMobileScrollCue, setShowMobileScrollCue] = useState(false);

  const mapsHref = useMemo(() => {
    if (!result?.restaurantName) return '#';
    const q = encodeURIComponent(`${result.restaurantName} Austin TX`);
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
  }, [result?.restaurantName]);

  useEffect(() => {
    const loop = () => {
      const mode = modeRef.current;
      const el = wheelRef.current;
      if (mode === 'idle') angleRef.current += 0.32;
      else if (mode === 'fast') angleRef.current += 11;
      if (el && mode !== 'coast') {
        el.style.transform = `rotate(${angleRef.current}deg)`;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // Optional: honor saved exclusions (set by onboarding/account preferences).
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

  const runCoastStop = useCallback(() => {
    const el = wheelRef.current;
    if (!el) return;
    if (coastEndTimeoutRef.current) {
      clearTimeout(coastEndTimeoutRef.current);
      coastEndTimeoutRef.current = null;
    }
    modeRef.current = 'coast';
    const from = angleRef.current;
    const extra = 720 + Math.random() * 360;
    const to = from + extra;
    angleRef.current = to;
    el.style.transition = 'transform 2.4s cubic-bezier(0.18, 0.85, 0.22, 1)';
    el.style.transform = `rotate(${to}deg)`;
    coastEndTimeoutRef.current = window.setTimeout(() => {
      coastEndTimeoutRef.current = null;
      if (wheelRef.current) {
        wheelRef.current.style.transition = 'none';
      }
      modeRef.current = 'idle';
    }, 2500);
  }, []);

  const resetRoulette = useCallback(() => {
    if (resultRevealTimeoutRef.current) {
      clearTimeout(resultRevealTimeoutRef.current);
      resultRevealTimeoutRef.current = null;
    }
    if (coastEndTimeoutRef.current) {
      clearTimeout(coastEndTimeoutRef.current);
      coastEndTimeoutRef.current = null;
    }
    modeRef.current = 'idle';
    angleRef.current = 0;
    const el = wheelRef.current;
    if (el) {
      el.style.transition = 'none';
      el.style.transform = 'rotate(0deg)';
    }
    setQuickVibe(null);
    setQuickDietary([]);
    setRefineVibe(null);
    setTimeOfDay(null);
    setDietary(null);
    setSpinning(false);
    setAllowRefine(false);
    setResult(null);
    setErrorMessage(null);
    setTypedReason('');
    setShowMobileScrollCue(false);
  }, []);

  useEffect(() => {
    const handleReset = () => resetRoulette();
    window.addEventListener(WANDERBITE_RESET_ROULETTE_EVENT, handleReset);
    return () =>
      window.removeEventListener(WANDERBITE_RESET_ROULETTE_EVENT, handleReset);
  }, [resetRoulette]);

  const spin = useCallback(async () => {
    if (resultRevealTimeoutRef.current) {
      clearTimeout(resultRevealTimeoutRef.current);
      resultRevealTimeoutRef.current = null;
    }
    if (coastEndTimeoutRef.current) {
      clearTimeout(coastEndTimeoutRef.current);
      coastEndTimeoutRef.current = null;
    }
    setErrorMessage(null);
    setResult(null);
    setTypedReason('');
    setSpinning(true);
    setShowMobileScrollCue(true);
    modeRef.current = 'fast';

    const vibeForApi =
      refineVibe ?? quickVibe ?? undefined;

    const minWait = new Promise<void>((r) => setTimeout(r, 2000));

    const fetchPromise = (async () => {
      const res = await fetch('/api/roulette', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          vibe: vibeForApi,
          timeOfDay: timeOfDay ?? undefined,
          dietary: dietary ?? undefined,
          dietaryQuick: quickDietary.length > 0 ? quickDietary : undefined,
          excludedCuisines: excludedCuisines.length > 0 ? excludedCuisines : undefined,
        }),
      });
      const data = (await res.json()) as { error?: string } & Partial<RouletteApiResult>;
      if (!res.ok) {
        throw new Error(data.error ?? 'Something went wrong. Please try again.');
      }
      if (!data.restaurantId || !data.restaurantName || !data.reason) {
        throw new Error('We got an unexpected response. Please try again.');
      }
      const picked: RouletteApiResult = {
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
      };
      return picked;
    })();

    try {
      const [data] = await Promise.all([fetchPromise, minWait]);
      runCoastStop();
      if (resultRevealTimeoutRef.current) {
        clearTimeout(resultRevealTimeoutRef.current);
      }
      resultRevealTimeoutRef.current = window.setTimeout(() => {
        resultRevealTimeoutRef.current = null;
        setResult(data);
        setAllowRefine(true);
        setSpinning(false);
      }, 2600);
    } catch (e) {
      modeRef.current = 'idle';
      setSpinning(false);
      setShowMobileScrollCue(false);
      setErrorMessage(e instanceof Error ? e.message : 'Network error. Try again.');
    }
  }, [dietary, excludedCuisines, quickDietary, quickVibe, refineVibe, runCoastStop, timeOfDay]);

  /** After reveal: mobile anchors result to top of viewport (avoids crowding spin button); desktop stays centered. */
  useEffect(() => {
    if (!result?.restaurantId) return;
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
    }, 450);
    return () => clearTimeout(id);
  }, [result?.restaurantId]);

  /** Mobile: hide scroll cue when result is on-screen or after 4s. */
  useEffect(() => {
    if (!result?.restaurantId) return;
    if (scrollCueHideTimeoutRef.current) {
      clearTimeout(scrollCueHideTimeoutRef.current);
      scrollCueHideTimeoutRef.current = null;
    }
    const el = resultSectionRef.current;
    if (!el || typeof window === 'undefined') return;

    const hide = () => {
      setShowMobileScrollCue(false);
      if (scrollCueHideTimeoutRef.current) {
        clearTimeout(scrollCueHideTimeoutRef.current);
        scrollCueHideTimeoutRef.current = null;
      }
    };

    const mq = window.matchMedia('(min-width: 768px)');
    if (mq.matches) {
      hide();
      return;
    }

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      hide();
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
  }, [result?.restaurantId]);

  useEffect(() => {
    if (!result?.reason) {
      setTypedReason('');
      return;
    }
    let i = 0;
    setTypedReason('');
    const text = result.reason;
    const t = window.setInterval(() => {
      i += 1;
      setTypedReason(text.slice(0, i));
      if (i >= text.length) clearInterval(t);
    }, 20);
    return () => clearInterval(t);
  }, [result?.reason, result?.restaurantId]);

  const spinAgain = useCallback(() => {
    setResult(null);
    setErrorMessage(null);
    setTypedReason('');
    setShowMobileScrollCue(false);
    modeRef.current = 'idle';
  }, []);

  const sharePick = useCallback(async () => {
    if (!result?.restaurantName) return;
    const outcome = await shareOrCopy({
      title: 'Wanderbite Roulette picked my dinner',
      text: `Wanderbite Roulette just sent me to ${result.restaurantName} tonight 🎲🍽️ Find your next bite free at`,
      url: 'https://wanderbite.com',
    });
    if (outcome === 'copied') {
      toast.success('Link copied to clipboard!');
    } else if (outcome === 'error') {
      toast.error('Could not share. Try copying the link manually.');
    }
  }, [result?.restaurantName]);

  return (
    <section
      id="roulette"
      className="relative flex w-full flex-col items-center overflow-hidden bg-gradient-to-b from-[#f5f0ff] via-[#faf7ff] to-[#f0e8ff] px-4 pb-20 pt-8 max-md:min-h-0 max-md:justify-start md:min-h-[85vh] md:justify-center md:px-8"
      aria-label="Wanderbite Roulette"
    >
      <div className="mx-auto flex w-full max-w-lg flex-col items-center text-center">
        {/* Mobile: cap the "wheel stack" height so a slice of viewport hints at content below; desktop unchanged */}
        <div className="flex w-full flex-col items-center text-center max-md:max-h-[min(70vh,600px)] max-md:min-h-0 max-md:pb-8 md:max-h-none">
          <p className="text-sm font-semibold tracking-wide text-primary">
            FREE — No account needed
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl md:text-5xl">
            Where should you eat tonight?
          </h2>
          <p className="mt-4 max-w-md text-base text-muted-foreground sm:text-lg">
            Let Wanderbite Roulette decide. Powered by AI, built for adventure.
          </p>
          {exclusionsSummary ? (
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Honoring your cuisine exclusions:{' '}
              <span className="font-medium text-foreground">{exclusionsSummary}</span>.{' '}
              <Link href="/account" className="font-medium text-primary underline-offset-2 hover:underline">
                Edit
              </Link>
            </p>
          ) : null}

          <div className="relative mt-10 flex flex-col items-center md:mt-10">
            <div
              className="absolute -top-1 left-1/2 z-10 -translate-x-1/2"
              aria-hidden
            >
              <div className="size-0 border-x-[10px] border-x-transparent border-b-[14px] border-b-primary drop-shadow-sm" />
            </div>
            <div
              ref={wheelRef}
              className="relative size-[200px] shrink-0 rounded-full shadow-lg ring-2 ring-primary/20"
              style={{
                transform: 'rotate(0deg)',
                background:
                  'conic-gradient(from 0deg, #e8d3ff 0deg 45deg, #cda0ff 45deg 90deg, #e8d3ff 90deg 135deg, #cda0ff 135deg 180deg, #e8d3ff 180deg 225deg, #cda0ff 225deg 270deg, #e8d3ff 270deg 315deg, #cda0ff 315deg 360deg)',
              }}
            >
              <div className="absolute inset-[22%] flex items-center justify-center rounded-full bg-white text-3xl shadow-inner ring-1 ring-violet-100">
                🍴
              </div>
            </div>
          </div>

          <div className="mt-8 flex w-full max-w-md flex-wrap justify-center gap-2">
          {VIBE_PILLS.map((pill) => {
            const on = quickVibe === pill.value;
            return (
              <button
                key={pill.value}
                type="button"
                onClick={() =>
                  setQuickVibe((v) => (v === pill.value ? null : pill.value))
                }
                className={cn(
                  'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                  on
                    ? 'border-primary bg-primary/15 text-primary shadow-sm'
                    : 'border-violet-200/80 bg-white/80 text-foreground hover:border-primary/50'
                )}
              >
                {pill.label}
              </button>
            );
          })}
          </div>

          <div className="mt-6 w-full max-w-md space-y-2">
            <p className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Dietary (optional, multi-select)
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
                        ? 'border-primary bg-primary/15 text-primary shadow-sm'
                        : 'border-violet-200/80 bg-white/80 text-foreground hover:border-primary/50'
                    )}
                  >
                    <Icon className="size-3.5 shrink-0" aria-hidden />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <Button
            type="button"
            size="lg"
            disabled={spinning}
            className="mt-8 h-12 min-w-[220px] rounded-full bg-primary px-8 text-base font-semibold text-primary-foreground shadow-md hover:bg-primary/90"
            onClick={() => void spin()}
          >
            {spinning ? (
              <>
                <Loader2 className="mr-2 size-5 animate-spin" aria-hidden />
                Spinning…
              </>
            ) : (
              <>Spin the Wheel 🎲</>
            )}
          </Button>

          {showMobileScrollCue && (spinning || result) ? (
            <p
              className="mt-5 hidden max-md:flex flex-col items-center gap-0.5 text-xs font-semibold text-primary animate-bounce"
              aria-live="polite"
            >
              <span className="text-base leading-none" aria-hidden>
                ↓
              </span>
              <span>{result ? 'Scroll for your pick' : 'Your pick is on the way'}</span>
            </p>
          ) : null}
        </div>

        {errorMessage ? (
          <p className="mt-4 max-w-md text-sm text-destructive" role="alert">
            {errorMessage}
          </p>
        ) : null}

        {result ? (
          <div
            ref={resultSectionRef}
            className="relative z-0 mt-20 w-full max-w-md max-md:scroll-mt-28 max-md:border-t max-md:border-violet-200/70 max-md:pt-12 animate-in fade-in duration-500 md:mt-10 md:scroll-mt-0 md:border-t-0 md:pt-0 md:slide-in-from-bottom-4"
            key={result.restaurantId}
          >
            <div className="rounded-2xl border border-violet-200/80 bg-white/95 p-6 text-left shadow-lg backdrop-blur-sm max-md:shadow-xl max-md:ring-1 max-md:ring-violet-200/40 md:ring-0">
              <p className="text-sm font-medium text-muted-foreground">🎯 Tonight&apos;s Pick</p>
              <h3 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                {result.restaurantName}
              </h3>
              {result.neighborhood ? (
                <p className="mt-1 text-sm text-muted-foreground">{result.neighborhood}</p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-1.5">
                {(result.cuisine_tags ?? []).length ? (
                  (result.cuisine_tags ?? []).map((tag) => (
                    <Badge
                      key={tag}
                      className="border-violet-200 bg-violet-100 text-violet-900 hover:bg-violet-100"
                    >
                      {tag}
                    </Badge>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">Austin partner</span>
                )}
              </div>
              <p className="mt-4 min-h-[4rem] text-sm leading-relaxed text-foreground">
                {typedReason}
                {typedReason.length < (result.reason?.length ?? 0) ? (
                  <span className="inline-block w-0.5 animate-pulse bg-primary" />
                ) : null}
              </p>
              {result.suggestedDish ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Try:</span>{' '}
                  {result.suggestedDish}
                </p>
              ) : null}

              <Button
                asChild
                size="lg"
                className="mt-6 w-full rounded-full font-semibold"
              >
                <a href={mapsHref} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 size-4" aria-hidden />
                  Get Directions
                </a>
              </Button>
            </div>

            <div className="mt-6 rounded-2xl border border-violet-300/60 bg-[#cda0ff] px-5 py-5 text-center shadow-md">
              <p className="text-base font-semibold text-gray-900">
                Wanderbite members get $10 off here tonight
              </p>
              <Button
                asChild
                size="lg"
                className="mt-4 w-full rounded-full border-0 bg-gray-900 font-semibold text-white hover:bg-gray-800"
              >
                <Link href="/pricing">Join for $15/month →</Link>
              </Button>
              <p className="mt-2 text-xs text-gray-800/90">
                Cancel anytime · 2 restaurant challenges/month
              </p>
            </div>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Button
                type="button"
                variant="outline"
                className="gap-2 rounded-full border-violet-300 bg-white/90"
                onClick={() => void sharePick()}
              >
                <Share2 className="size-4 shrink-0" aria-hidden />
                Share Tonight&apos;s Pick
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="rounded-full"
                onClick={spinAgain}
              >
                Spin Again
              </Button>
            </div>
          </div>
        ) : null}

        {allowRefine ? (
          <div className="mt-10 w-full max-w-md space-y-6 border-t border-violet-200/60 pt-8">
            <p className="text-center text-sm font-semibold text-foreground">
              Want more? Refine your spin:
            </p>
            <RefinePillGroup
              label="Vibe (optional)"
              options={VIBES}
              value={refineVibe}
              onChange={setRefineVibe}
            />
            <RefinePillGroup
              label="Time (optional)"
              options={TIMES}
              value={timeOfDay}
              onChange={setTimeOfDay}
            />
            <RefinePillGroup
              label="Dietary (optional)"
              options={DIETARY}
              value={dietary}
              onChange={setDietary}
            />
          </div>
        ) : null}
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
