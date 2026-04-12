'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ExternalLink, UtensilsCrossed } from 'lucide-react';

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

export type RouletteApiResult = {
  restaurantId: string;
  restaurantName: string;
  reason: string;
  vibeMatch: string | null;
  suggestedDish: string | null;
  cuisine_tags: string[] | null;
  neighborhood: string | null;
  address: string | null;
};

type Phase = 'form' | 'loading' | 'result' | 'error';

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

function SpinningWheel() {
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
    </div>
  );
}

export function RouletteClient() {
  const [phase, setPhase] = useState<Phase>('form');
  const [vibe, setVibe] = useState<(typeof VIBES)[number] | null>(null);
  const [timeOfDay, setTimeOfDay] = useState<(typeof TIMES)[number] | null>(null);
  const [dietary, setDietary] = useState<(typeof DIETARY)[number] | null>(null);
  const [result, setResult] = useState<RouletteApiResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mapsHref = useMemo(() => {
    if (!result?.restaurantName) return '#';
    const q = encodeURIComponent(`${result.restaurantName} Austin TX`);
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
  }, [result?.restaurantName]);

  const spin = useCallback(async () => {
    setPhase('loading');
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
        }),
      });
      const data = (await res.json()) as { error?: string } & Partial<RouletteApiResult>;
      if (!res.ok) {
        setErrorMessage(data.error ?? 'Something went wrong. Please try again.');
        setPhase('error');
        return;
      }
      if (!data.restaurantId || !data.restaurantName || !data.reason) {
        setErrorMessage('We got an unexpected response. Please try Wanderbite Roulette again.');
        setPhase('error');
        return;
      }
      setResult(data as RouletteApiResult);
      setPhase('result');
    } catch {
      setErrorMessage('Network error. Check your connection and try again.');
      setPhase('error');
    }
  }, [dietary, timeOfDay, vibe]);

  const spinAgain = useCallback(() => {
    setPhase('form');
    setResult(null);
    setErrorMessage(null);
  }, []);

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col px-4 py-12 sm:py-16">
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

      {phase === 'loading' && <SpinningWheel />}

      {phase === 'error' && (
        <div className="flex flex-1 flex-col items-center justify-center space-y-6 text-center">
          <p className="text-lg text-foreground">
            Wanderbite Roulette hit a snag — {errorMessage}
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
        <div className="flex flex-1 flex-col space-y-8">
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

          <div className="rounded-xl border bg-card p-6 shadow-sm">
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
