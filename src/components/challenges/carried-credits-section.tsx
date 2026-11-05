'use client';

import type { BiteNoteSummary } from '@/app/actions/bite-notes';
import { CarriedCreditCard } from '@/components/challenges/carried-credit-card';
import type { CarriedCreditView } from '@/lib/challenges/carried-credits';
import type { ActivitySuggestions } from '@/lib/activities/types';
import type { RestaurantBriefings } from '@/lib/briefings/types';
import type { RecipeSections } from '@/lib/recipes/display';

type CarriedCreditsSectionProps = {
  credits: CarriedCreditView[];
  swapsRemaining: number;
  swappingItemId: string | null;
  redeemingItemId: string | null;
  onSwap: (challengeItemId: string) => void;
  onRedeem: (challengeItemId: string) => void;
  biteNoteByRedemptionId: Map<string, BiteNoteSummary>;
  memoryReturnTo?: string;
  launchEligible: boolean;
  recipeSections?: RecipeSections;
  activitySuggestions?: ActivitySuggestions;
  briefings?: RestaurantBriefings;
};

export function CarriedCreditsSection({
  credits,
  swapsRemaining,
  swappingItemId,
  redeemingItemId,
  onSwap,
  onRedeem,
  biteNoteByRedemptionId,
  memoryReturnTo = '/challenges',
  launchEligible,
  recipeSections = { exclusionLine: null, byRestaurantId: {} },
  activitySuggestions = { byRestaurantId: {} },
  briefings = { byRestaurantId: {} },
}: CarriedCreditsSectionProps) {
  if (credits.length === 0) return null;
  const swapCopy = swapsRemaining === 0 ? '0 swaps left' : '1 swap left';

  return (
    <section className="space-y-4" aria-labelledby="carried-credits-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="carried-credits-heading" className="text-lg font-semibold">
          Carried from earlier months
        </h2>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{swapCopy}</span> this month
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {credits.map((credit) => {
          const itemId = credit.item?.challengeItem.id;
          const redemptionId = credit.item?.redemptionId;
          return (
            <CarriedCreditCard
              key={credit.creditId}
              credit={credit}
              canSwap={swapsRemaining > 0 && launchEligible}
              isSwapping={itemId != null && swappingItemId === itemId}
              isRedeeming={itemId != null && redeemingItemId === itemId}
              onSwap={onSwap}
              onRedeem={onRedeem}
              biteNote={redemptionId ? biteNoteByRedemptionId.get(redemptionId) : undefined}
              memoryReturnTo={memoryReturnTo}
              recipes={
                credit.item
                  ? recipeSections.byRestaurantId[credit.item.restaurant.id] ?? []
                  : []
              }
              recipeExclusionLine={recipeSections.exclusionLine}
              activities={
                credit.item
                  ? activitySuggestions.byRestaurantId[credit.item.restaurant.id] ?? []
                  : []
              }
              briefings={
                credit.item ? briefings.byRestaurantId[credit.item.restaurant.id] ?? [] : []
              }
            />
          );
        })}
      </div>
    </section>
  );
}
