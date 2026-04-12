'use client';

import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Star } from 'lucide-react';
import { getPublicReviews, type PublicReview } from '@/app/actions/bite-notes';
import { cn } from '@/lib/utils';

// TODO: Link to Google Reviews API in future

type Props = {
  restaurantId: string;
  className?: string;
};

function StarRowReadOnly({ rating }: { rating: number }) {
  const n = Math.min(5, Math.max(1, Math.round(rating)));
  return (
    <div className="flex items-center gap-0.5" aria-label={`${n} of 5 stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={cn(
            'size-3.5',
            i < n
              ? 'fill-amber-400 text-amber-400'
              : 'fill-transparent text-muted-foreground/35'
          )}
          aria-hidden
        />
      ))}
    </div>
  );
}

export function RestaurantReviews({ restaurantId, className }: Props) {
  const [reviews, setReviews] = useState<PublicReview[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await getPublicReviews(restaurantId);
    if (res.ok) {
      setReviews(res.data);
    } else {
      setReviews([]);
      setError(res.error);
    }
  }, [restaurantId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className={cn('space-y-2 text-left', className)}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Member reviews
      </p>
      {reviews === null ? (
        <p className="text-xs text-muted-foreground">Loading reviews…</p>
      ) : error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : reviews.length === 0 ? (
        <p className="text-sm text-muted-foreground">No reviews yet — be the first!</p>
      ) : (
        <ul className="space-y-3">
          {reviews.map((r) => (
            <li
              key={r.id}
              className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-foreground">{r.maskedAuthor}</span>
                <StarRowReadOnly rating={r.rating} />
              </div>
              {r.note ? (
                <p className="mt-1 whitespace-pre-wrap text-xs leading-snug text-muted-foreground">
                  {r.note}
                </p>
              ) : null}
              <p className="mt-1 text-[10px] text-muted-foreground">
                {format(new Date(r.created_at), 'MMM d, yyyy')}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[10px] text-muted-foreground">
        Reviews come from verified Wanderbite members
      </p>
    </div>
  );
}
