import { Star, StarHalf } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Round average to nearest 0.5 for display (e.g. 4.3 → 4.5, 4.2 → 4.0). */
export function roundAvgRatingToHalf(avg: number): number {
  return Math.round(avg * 2) / 2;
}

type SocialProofRatingBlockProps = {
  avgRating: number;
  totalRatings: number;
  /** When false, renders nothing (caller can pass totalRatings &lt; 3). */
  show?: boolean;
  className?: string;
};

/**
 * Star row (0.5 steps) + “X Wanderbiters visited”. Caller should only mount when totalRatings ≥ 3.
 */
export function SocialProofRatingBlock({
  avgRating,
  totalRatings,
  show = true,
  className,
}: SocialProofRatingBlockProps) {
  if (!show || totalRatings < 3) return null;

  const rounded = roundAvgRatingToHalf(avgRating);
  const fullStars = Math.floor(rounded);
  const hasHalf = rounded - fullStars >= 0.5;
  const emptyStars = 5 - fullStars - (hasHalf ? 1 : 0);

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center gap-0.5" aria-label={`${rounded} out of 5 average from ${totalRatings} ratings`}>
        {Array.from({ length: fullStars }, (_, i) => (
          <Star
            key={`f-${i}`}
            className="size-4 fill-amber-400 text-amber-400"
            aria-hidden
          />
        ))}
        {hasHalf ? (
          <StarHalf className="size-4 fill-amber-400 text-amber-400" aria-hidden />
        ) : null}
        {Array.from({ length: emptyStars }, (_, i) => (
          <Star
            key={`e-${i}`}
            className="size-4 fill-transparent text-muted-foreground/35"
            aria-hidden
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {totalRatings} Wanderbiters visited
      </p>
    </div>
  );
}
