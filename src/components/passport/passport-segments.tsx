'use client';

import { useRouter } from 'next/navigation';
import { segmentHref, type PassportSegmentId } from '@/lib/passport/passport-board';

const SEGMENTS: { id: PassportSegmentId; label: string }[] = [
  { id: 'stamps', label: 'Passport' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'map', label: 'Map' },
];

type PassportSegmentsProps = {
  active: PassportSegmentId;
};

export function PassportSegments({ active }: PassportSegmentsProps) {
  const router = useRouter();

  function go(segment: PassportSegmentId) {
    const href = segmentHref(segment);
    if (!href) return;
    router.push(href);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const key = event.key;
    if (key !== 'ArrowRight' && key !== 'ArrowLeft' && key !== 'ArrowDown' && key !== 'ArrowUp' && key !== ' ') {
      return;
    }
    const index = SEGMENTS.findIndex((segment) => segment.id === active);
    if (key === ' ') {
      event.preventDefault();
      go(active);
      return;
    }
    event.preventDefault();
    const delta = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1;
    const next = SEGMENTS[(index + delta + SEGMENTS.length) % SEGMENTS.length];
    if (!next) return;
    const node = document.getElementById(`passport-segment-${next.id}`);
    node?.focus();
    go(next.id);
  }

  return (
    <div
      role="radiogroup"
      aria-label="Passport views"
      className="grid grid-cols-3 gap-1 rounded-full border border-white/20 bg-white/10 p-1"
      onKeyDown={onKeyDown}
    >
      {SEGMENTS.map((segment) => {
        const href = segmentHref(segment.id);
        const selected = segment.id === active;
        const className = [
          'flex min-h-11 flex-col items-center justify-center rounded-full px-2 text-sm font-semibold',
          selected ? 'bg-white text-wb-ink' : 'text-white/85',
          href ? '' : 'cursor-not-allowed text-white/55',
        ].join(' ');
        if (!href) {
          return (
            <button
              key={segment.id}
              id={`passport-segment-${segment.id}`}
              type="button"
              role="radio"
              aria-checked={false}
              aria-disabled="true"
              aria-label="Map, coming later"
              tabIndex={-1}
              className={className}
              onClick={(event) => event.preventDefault()}
            >
              <span>Map</span>
              <span className="text-[10px] leading-none font-medium">Coming later</span>
            </button>
          );
        }
        return (
          <a
            key={segment.id}
            id={`passport-segment-${segment.id}`}
            href={href}
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={className}
          >
            {segment.label}
          </a>
        );
      })}
    </div>
  );
}
