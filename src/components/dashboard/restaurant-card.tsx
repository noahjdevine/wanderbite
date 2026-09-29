'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, MapPin, RefreshCw, Star, Ticket } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { GeneratedChallengeItem } from '@/app/actions/generate-challenge';
import { getRedemptionCode } from '@/app/actions/get-redemption-code';
import {
  saveBiteNote,
  toggleNoteVisibility,
  type BiteNoteSummary,
} from '@/app/actions/bite-notes';
import { RestaurantReviews } from '@/components/restaurants/restaurant-reviews';
import { RestaurantPhoto } from '@/components/restaurants/restaurant-photo';
import { SocialProofRatingBlock } from '@/components/restaurant-social-proof';
import {
  challengeCardExpired,
  formatChicagoDeadline,
} from '@/lib/challenges/challenge-deadline';

function formatOffer(discountCents: number, minSpendCents: number): string {
  const dollars = discountCents / 100;
  const minDollars = minSpendCents / 100;
  return `$${dollars} off when you spend $${minDollars}+`;
}

const BITE_NOTE_MAX = 280;

function StarRow({
  value,
  onChange,
  readOnly,
}: {
  value: number;
  onChange?: (n: number) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="flex items-center gap-0.5" role="img" aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) =>
        readOnly ? (
          <Star
            key={n}
            className={cn(
              'size-6',
              n <= value
                ? 'fill-amber-400 text-amber-400'
                : 'fill-transparent text-muted-foreground/40'
            )}
            aria-hidden
          />
        ) : (
          <button
            key={n}
            type="button"
            onClick={() => onChange?.(n)}
            className="rounded p-0.5 transition-opacity hover:opacity-90"
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
          >
            <Star
              className={cn(
                'size-6',
                n <= value
                  ? 'fill-amber-400 text-amber-400'
                  : 'fill-transparent text-muted-foreground/50'
              )}
            />
          </button>
        )
      )}
    </div>
  );
}

function BiteNotesInline({
  redemptionId,
  saved,
}: {
  redemptionId: string;
  saved: BiteNoteSummary | undefined;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [rating, setRating] = useState(saved?.rating ?? 5);
  const [text, setText] = useState(saved?.note ?? '');
  const [formIsPublic, setFormIsPublic] = useState(saved?.is_public ?? false);
  const [publicLocal, setPublicLocal] = useState(Boolean(saved?.is_public));
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [saving, setSaving] = useState(false);

  const hasSaved = Boolean(saved);

  useEffect(() => {
    setPublicLocal(Boolean(saved?.is_public));
  }, [saved?.id, saved?.is_public]);

  function openEdit() {
    setRating(saved?.rating ?? 5);
    setText(saved?.note ?? '');
    setFormIsPublic(saved?.is_public ?? false);
    setShowForm(true);
  }

  async function handleVisibilityChange(next: boolean) {
    if (!saved?.id) return;
    setVisibilitySaving(true);
    try {
      const res = await toggleNoteVisibility(saved.id, next);
      if (res.ok) {
        setPublicLocal(next);
        toast.success(next ? 'Your review is now public' : 'Your review is now private');
        router.refresh();
      } else {
        toast.error(res.error);
      }
    } finally {
      setVisibilitySaving(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await saveBiteNote(redemptionId, text, rating, formIsPublic);
      if (res.ok) {
        toast.success('Bite Note saved');
        setShowForm(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-dashed border-muted-foreground/25 bg-muted/20 p-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Bite Notes
      </p>
      {hasSaved && !showForm && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <StarRow value={saved!.rating} readOnly />
            {saved!.is_public ? (
              <Badge variant="secondary" className="text-xs">
                Public review
              </Badge>
            ) : null}
          </div>
          {saved!.note ? (
            <p className="whitespace-pre-wrap text-sm text-foreground">{saved!.note}</p>
          ) : (
            <p className="text-sm italic text-muted-foreground">No written note</p>
          )}
          {saved?.id ? (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="size-3.5 rounded border-input accent-[#E85D26]"
                checked={publicLocal}
                disabled={visibilitySaving}
                onChange={(e) => void handleVisibilityChange(e.target.checked)}
              />
              <span>Share publicly as a review</span>
            </label>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={openEdit}>
            Edit
          </Button>
        </div>
      )}
      {!hasSaved && !showForm && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setFormIsPublic(false);
            setShowForm(true);
          }}
        >
          Leave a Bite Note
        </Button>
      )}
      {showForm && (
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Rating</p>
            <StarRow value={rating} onChange={setRating} />
          </div>
          <div>
            <label htmlFor={`bite-note-${redemptionId}`} className="mb-1 block text-xs text-muted-foreground">
              How was it? (optional)
            </label>
            <textarea
              id={`bite-note-${redemptionId}`}
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, BITE_NOTE_MAX))}
              rows={3}
              maxLength={BITE_NOTE_MAX}
              className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              placeholder="Quick memory from your visit…"
            />
            <p className="mt-1 text-right text-xs text-muted-foreground">
              {text.length}/{BITE_NOTE_MAX}
            </p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="size-3.5 rounded border-input accent-[#E85D26]"
              checked={formIsPublic}
              onChange={(e) => setFormIsPublic(e.target.checked)}
            />
            <span>Share this note publicly as a review</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={saving} onClick={handleSave}>
              {saving ? 'Saving…' : 'Save Note'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => {
                if (hasSaved) {
                  setShowForm(false);
                  setRating(saved!.rating);
                  setText(saved!.note ?? '');
                  setFormIsPublic(saved!.is_public);
                } else {
                  setShowForm(false);
                  setRating(5);
                  setText('');
                  setFormIsPublic(false);
                }
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export type RestaurantCardProps = {
  item: GeneratedChallengeItem;
  cycleCreatedAt: string;
  canSwap: boolean;
  isSwapping: boolean;
  isRedeeming: boolean;
  onSwap: (challengeItemId: string) => void;
  onRedeem: (challengeItemId: string) => void;
  biteNote?: BiteNoteSummary;
  /** Credits cards use the stored deadline. Legacy cards keep cycle + 30 days. */
  useStoredDeadline?: boolean;
  storedDeadline?: string | null;
};

export function RestaurantCard({
  item,
  cycleCreatedAt,
  canSwap,
  isSwapping,
  isRedeeming,
  onSwap,
  onRedeem,
  biteNote,
  useStoredDeadline = false,
  storedDeadline = null,
}: RestaurantCardProps) {
  const [nowMs] = useState(() => Date.now());
  const isExpired = challengeCardExpired({
    now: new Date(nowMs),
    cycleCreatedAt,
    useStoredDeadline,
    storedDeadline,
  });
  const deadlineLabel =
    useStoredDeadline && storedDeadline ? formatChicagoDeadline(storedDeadline) : '';
  const tags = item.restaurant.cuisine_tags ?? [];
  const offerText = item.offer.available
    ? formatOffer(item.offer.discount_amount_cents, item.offer.min_spend_cents)
    : 'Offer unavailable';
  const isAssigned = item.challengeItem.status === 'assigned';
  const isRedeemed = item.challengeItem.status === 'redeemed';
  const [displayCode, setDisplayCode] = useState<string | null>(item.redemptionToken ?? null);

  useEffect(() => {
    if (!isRedeemed || !item.redemptionId) return;
    let cancelled = false;
    void getRedemptionCode(item.redemptionId).then((code) => {
      if (!cancelled && code) setDisplayCode(code);
    });
    return () => {
      cancelled = true;
    };
  }, [isRedeemed, item.redemptionId, item.redemptionToken]);
  const hasCoords =
    item.restaurant.lat != null &&
    item.restaurant.lon != null &&
    !Number.isNaN(item.restaurant.lat) &&
    !Number.isNaN(item.restaurant.lon);
  const mapsUrl = hasCoords
    ? `https://www.google.com/maps/search/?api=1&query=${item.restaurant.lat},${item.restaurant.lon}`
    : null;

  const [redeemDialogOpen, setRedeemDialogOpen] = useState(false);

  return (
    <Card className={`overflow-hidden ${isExpired ? 'opacity-75 grayscale' : ''}`}>
      <div className="-mt-6 aspect-[16/9] w-full shrink-0 bg-muted">
        <RestaurantPhoto
          restaurantId={item.restaurant.id}
          imageUrl={item.restaurant.image_url}
          googlePlaceId={item.restaurant.google_place_id}
        />
      </div>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>{item.restaurant.name}</CardTitle>
            {isExpired && <Badge variant="secondary">Expired</Badge>}
          </div>
          <CardDescription className="flex flex-wrap gap-1.5">
            {tags.length > 0 ? (
              tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))
            ) : (
              <span className="text-muted-foreground">No tags</span>
            )}
          </CardDescription>
        </div>
        {mapsUrl && (
          <Button variant="ghost" size="icon" className="shrink-0" asChild>
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Get directions"
            >
              <MapPin className="size-4" />
            </a>
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm font-medium text-primary">{offerText}</p>
        {deadlineLabel ? (
          <p className="text-sm text-muted-foreground">Redeem by {deadlineLabel}</p>
        ) : null}
        {item.socialProof &&
          item.socialProof.totalRatings >= 3 &&
          item.socialProof.avgRating != null && (
            <SocialProofRatingBlock
              avgRating={item.socialProof.avgRating}
              totalRatings={item.socialProof.totalRatings}
            />
          )}
        <RestaurantReviews restaurantId={item.restaurant.id} />
        {isRedeemed && item.redemptionId && (
          <div className="space-y-3">
            {displayCode && (
              <div className="rounded-lg border-2 border-green-600 bg-green-50 p-3 dark:border-green-500 dark:bg-green-950/30">
                <p className="text-center font-mono text-lg font-bold tracking-wide text-green-800 dark:text-green-200">
                  {displayCode}
                </p>
              </div>
            )}
            <Button variant="default" className="w-full gap-2" asChild>
              <Link href={`/challenges/show/${item.redemptionId}`}>
                <Ticket className="size-4" aria-hidden />
                Show code to server
              </Link>
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Open full-screen QR + code for your server to scan or type.
            </p>
          </div>
        )}
        {isRedeemed && item.redemptionId && (
          <BiteNotesInline redemptionId={item.redemptionId} saved={biteNote} />
        )}
      </CardContent>
      {isAssigned && (
        <CardFooter className="flex flex-col gap-2 pt-0">
          <AlertDialog open={redeemDialogOpen} onOpenChange={setRedeemDialogOpen}>
            <Button
              variant="default"
              size="sm"
              className="w-full gap-2"
              disabled={isRedeeming || isExpired}
              onClick={() => setRedeemDialogOpen(true)}
            >
              {isRedeeming ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Redeeming…
                </>
              ) : isExpired ? (
                'Offer expired'
              ) : (
                <>
                  <Ticket className="size-4" aria-hidden />
                  Redeem Offer
                </>
              )}
            </Button>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you at the restaurant?</AlertDialogTitle>
                <AlertDialogDescription>
                  Once you redeem, you have 15 minutes to show this to your server.
                  This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    onRedeem(item.challengeItem.id);
                  }}
                >
                  Yes, Redeem Now
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            disabled={!canSwap || isSwapping || isExpired}
            onClick={() => onSwap(item.challengeItem.id)}
          >
            {isSwapping ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Swapping…
              </>
            ) : canSwap ? (
              <>
                <RefreshCw className="size-4" aria-hidden />
                Swap This Spot
              </>
            ) : (
              'No swaps left'
            )}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
