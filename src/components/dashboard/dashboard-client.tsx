'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, MapPin, RefreshCw, Ticket } from 'lucide-react';
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
import {
  generateMonthlyChallenge,
  type GeneratedChallenge,
  type GeneratedChallengeItem,
} from '@/app/actions/generate-challenge';
import { swapChallengeItem } from '@/app/actions/swap-challenge';
import { redeemChallengeItem } from '@/app/actions/redeem-challenge';

type TestUser = {
  id: string;
  email: string | null;
  dietary_flags: string[] | null;
};

type DashboardClientProps = {
  testUser: TestUser;
  marketId: string;
  currentChallenge: GeneratedChallenge | null;
};

function formatOffer(discountCents: number, minSpendCents: number): string {
  const dollars = discountCents / 100;
  const minDollars = minSpendCents / 100;
  return `$${dollars} off when you spend $${minDollars}+`;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

type RestaurantCardProps = {
  item: GeneratedChallengeItem;
  cycleCreatedAt: string;
  canSwap: boolean;
  isSwapping: boolean;
  isRedeeming: boolean;
  onSwap: (challengeItemId: string) => void;
  onRedeem: (challengeItemId: string) => void;
};

function RestaurantCard({
  item,
  cycleCreatedAt,
  canSwap,
  isSwapping,
  isRedeeming,
  onSwap,
  onRedeem,
}: RestaurantCardProps) {
  const isExpired = Date.now() - new Date(cycleCreatedAt).getTime() > THIRTY_DAYS_MS;
  const tags = item.restaurant.cuisine_tags ?? [];
  const offerText = formatOffer(
    item.offer.discount_amount_cents,
    item.offer.min_spend_cents
  );
  const discountDollars = item.offer.discount_amount_cents / 100;
  const isAssigned = item.challengeItem.status === 'assigned';
  const isRedeemed = item.challengeItem.status === 'redeemed';
  const token = item.redemptionToken ?? null;
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
    <Card className={isExpired ? 'opacity-75 grayscale' : ''}>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>{item.restaurant.name}</CardTitle>
            {isExpired && (
              <Badge variant="secondary">Expired</Badge>
            )}
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
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            asChild
          >
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
        {isRedeemed && token && (
          <div className="rounded-lg border-2 border-green-600 bg-green-50 p-4 dark:border-green-500 dark:bg-green-950/30">
            <p className="text-center text-lg font-mono font-bold tracking-wide text-green-800 dark:text-green-200">
              CODE: {token}
            </p>
            <p className="mt-1 text-center text-sm text-green-700 dark:text-green-300">
              Show to server for ${discountDollars} off
            </p>
          </div>
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

export function DashboardClient({
  testUser,
  marketId,
  currentChallenge,
}: DashboardClientProps) {
  const router = useRouter();
  const [isGenerating, setIsGenerating] = useState(false);
  const [swappingItemId, setSwappingItemId] = useState<string | null>(null);
  const [redeemingItemId, setRedeemingItemId] = useState<string | null>(null);

  async function handleGenerate() {
    setIsGenerating(true);
    try {
      const result = await generateMonthlyChallenge(testUser.id, marketId);
      if (result.ok) {
        toast.success('Challenge generated!');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleSwap(challengeItemId: string) {
    setSwappingItemId(challengeItemId);
    try {
      const result = await swapChallengeItem(challengeItemId, testUser.id);
      if (result.ok) {
        toast.success(`Swapped to ${result.data.newRestaurant.name}`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setSwappingItemId(null);
    }
  }

  async function handleRedeem(challengeItemId: string) {
    setRedeemingItemId(challengeItemId);
    try {
      const result = await redeemChallengeItem(challengeItemId, testUser.id);
      if (result.ok) {
        toast.success(`Redeemed! Show code ${result.data.token} to your server.`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setRedeemingItemId(null);
    }
  }

  const swapCountUsed = currentChallenge?.cycle.swap_count_used ?? 0;
  const swapsRemaining = Math.max(0, 1 - swapCountUsed);
  const canSwap = swapsRemaining > 0;
  const activeItems =
    currentChallenge?.items.filter(
      (item) =>
        item.challengeItem.status === 'assigned' ||
        item.challengeItem.status === 'redeemed'
    ) ?? [];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 p-6">
      {currentChallenge ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">This month&apos;s challenges</h2>
            <p className="text-sm text-muted-foreground">
              Swaps remaining: <span className="font-medium text-foreground">{swapsRemaining}/1</span>
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {activeItems.map((item) => (
              <RestaurantCard
                key={item.challengeItem.id}
                item={item}
                cycleCreatedAt={currentChallenge.cycle.created_at}
                canSwap={canSwap}
                isSwapping={swappingItemId === item.challengeItem.id}
                isRedeeming={redeemingItemId === item.challengeItem.id}
                onSwap={handleSwap}
                onRedeem={handleRedeem}
              />
            ))}
          </div>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Welcome! Start your journey</CardTitle>
            <CardDescription>
              Generate your two restaurant challenges for this month.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={handleGenerate}
              disabled={isGenerating}
            >
              {isGenerating ? 'Generating…' : 'Generate Challenge'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
