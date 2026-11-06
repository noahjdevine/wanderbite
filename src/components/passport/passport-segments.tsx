'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { segmentHref, type PassportSegmentId } from '@/lib/passport/passport-board';

const SEGMENTS: { id: PassportSegmentId; label: string }[] = [
  { id: 'stamps', label: 'Passport' },
  { id: 'map', label: 'Map' },
];

type PassportSegmentsProps = {
  active: PassportSegmentId;
};

export function PassportSegments({ active }: PassportSegmentsProps) {
  const router = useRouter();

  useEffect(() => {
    if (typeof router.prefetch !== 'function') return;
    router.prefetch(segmentHref('stamps'));
    router.prefetch(segmentHref('map'));
  }, [router]);

  function go(segment: PassportSegmentId) {
    router.push(segmentHref(segment));
  }

  function onSegmentClick(event: React.MouseEvent<HTMLAnchorElement>, segment: PassportSegmentId) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    if (segment === active) return;
    go(segment);
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
      className="grid grid-cols-2 gap-1 rounded-full border border-white/20 bg-white/10 p-1"
      onKeyDown={onKeyDown}
    >
      {SEGMENTS.map((segment) => {
        const selected = segment.id === active;
        const className = [
          'flex min-h-11 items-center justify-center rounded-full px-2 text-sm font-semibold',
          selected ? 'bg-white text-wb-ink' : 'text-white/85',
        ].join(' ');
        return (
          <a
            key={segment.id}
            id={`passport-segment-${segment.id}`}
            href={segmentHref(segment.id)}
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={className}
            onClick={(event) => onSegmentClick(event, segment.id)}
          >
            {segment.label}
          </a>
        );
      })}
    </div>
  );
}
