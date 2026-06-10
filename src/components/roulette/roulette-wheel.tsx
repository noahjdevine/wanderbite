'use client';

import {
  forwardRef,
  useImperativeHandle,
  useRef,
  type CSSProperties,
} from 'react';
import { cn } from '@/lib/utils';

/**
 * Appetizing, high-contrast slices. Warm oranges/reds/golds plus teal accents;
 * Wanderbite purple is reserved for the frame/pointer/hub so the food colors pop.
 */
const SLICES: { color: string; emoji: string }[] = [
  { color: '#FF6B35', emoji: '🍕' },
  { color: '#F7B801', emoji: '🍣' },
  { color: '#E84855', emoji: '🌮' },
  { color: '#2EC4B6', emoji: '🍜' },
  { color: '#FF9F1C', emoji: '🍔' },
  { color: '#06A77D', emoji: '🥗' },
  { color: '#EF476F', emoji: '🍩' },
  { color: '#118AB2', emoji: '🍷' },
];

const SLICE_DEG = 360 / SLICES.length;

const CONIC = `conic-gradient(${SLICES.map(
  (s, i) => `${s.color} ${i * SLICE_DEG}deg ${(i + 1) * SLICE_DEG}deg`
).join(', ')})`;

export type RouletteWheelHandle = {
  /** Resolves once the spin animation has fully settled. */
  spin: () => Promise<void>;
};

type RouletteWheelProps = {
  /**
   * `idle` — slow, constant decorative rotation (landing page).
   * `interactive` — controlled via the imperative `spin()` handle (roulette page).
   */
  mode?: 'idle' | 'interactive';
  className?: string;
  /** Hide from assistive tech (decorative landing usage). */
  decorative?: boolean;
};

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export const RouletteWheel = forwardRef<RouletteWheelHandle, RouletteWheelProps>(
  function RouletteWheel({ mode = 'idle', className, decorative }, ref) {
    const diskRef = useRef<HTMLDivElement>(null);
    const rotationRef = useRef(0);

    useImperativeHandle(
      ref,
      () => ({
        spin: () =>
          new Promise<void>((resolve) => {
            const el = diskRef.current;
            if (!el) {
              resolve();
              return;
            }

            // Land on a random slice; extra full turns make it feel substantial.
            const turns = 5 + Math.floor(Math.random() * 3);
            const randomSlice = Math.floor(Math.random() * SLICES.length);
            const target =
              rotationRef.current +
              turns * 360 +
              randomSlice * SLICE_DEG +
              SLICE_DEG / 2;
            rotationRef.current = target;

            if (prefersReducedMotion()) {
              el.style.transition = 'none';
              el.style.transform = `rotate(${target}deg)`;
              resolve();
              return;
            }

            let settled = false;
            const done = () => {
              if (settled) return;
              settled = true;
              el.removeEventListener('transitionend', done);
              resolve();
            };

            // y > 1 control points produce a slight overshoot + settle.
            el.style.transition =
              'transform 3.8s cubic-bezier(0.16, 1.12, 0.23, 1)';
            // Force reflow so the new transition + transform animate.
            void el.offsetWidth;
            el.style.transform = `rotate(${target}deg)`;

            el.addEventListener('transitionend', done);
            // Fallback in case transitionend is missed.
            window.setTimeout(done, 4200);
          }),
      }),
      []
    );

    const isIdle = mode === 'idle';

    const diskStyle: CSSProperties = {
      background: CONIC,
      ...(isIdle ? {} : { transform: `rotate(0deg)` }),
    };

    return (
      <div
        className={cn(
          // Responsive + never wider than the viewport at 375px.
          'relative aspect-square w-[clamp(220px,70vw,320px)] max-w-full select-none',
          className
        )}
        aria-hidden={decorative ? true : undefined}
      >
        {/* Soft halo so the wheel lifts off a low-contrast background. */}
        <div className="pointer-events-none absolute -inset-4 rounded-full bg-white/70 blur-xl" />

        {/* Pointer */}
        <div className="absolute -top-1 left-1/2 z-20 -translate-x-1/2">
          <div className="size-0 border-x-[12px] border-x-transparent border-b-[18px] border-b-primary drop-shadow" />
        </div>

        {/* Rotating disk */}
        <div
          ref={diskRef}
          style={diskStyle}
          className={cn(
            'absolute inset-0 rounded-full shadow-xl ring-4 ring-primary/30',
            isIdle && 'wb-wheel-idle'
          )}
        >
          {SLICES.map((slice, i) => {
            const angle = i * SLICE_DEG + SLICE_DEG / 2;
            return (
              <div
                key={slice.emoji}
                className="absolute inset-0"
                style={{ transform: `rotate(${angle}deg)` }}
              >
                <span
                  className="absolute left-1/2 top-[7%] text-2xl drop-shadow-sm sm:text-3xl"
                  style={{
                    transform: `translateX(-50%) rotate(${-angle}deg)`,
                  }}
                >
                  {slice.emoji}
                </span>
              </div>
            );
          })}
        </div>

        {/* Center hub */}
        <div className="absolute left-1/2 top-1/2 z-10 flex size-[34%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-3xl shadow-inner ring-2 ring-primary/40">
          🎲
        </div>

        <style>{`
          @keyframes wb-wheel-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          .wb-wheel-idle {
            animation: wb-wheel-spin 18s linear infinite;
          }
          @media (prefers-reduced-motion: reduce) {
            .wb-wheel-idle { animation: none; }
          }
        `}</style>
      </div>
    );
  }
);
