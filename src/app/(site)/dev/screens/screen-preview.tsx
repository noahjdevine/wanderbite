'use client';

import { useState } from 'react';
import type { GeneratedChallenge } from '@/app/actions/generate-challenge';
import { ShowRedemptionCode } from '@/components/challenges/show-redemption-code';
import { DashboardClient } from '@/components/dashboard/dashboard-client';

const streak = { currentStreak: 2, longestStreak: 4, totalMonthsActive: 3 };

function sampleChallenge(createdAt: string): GeneratedChallenge {
  return {
    distanceMatch: null,
    cycle: {
      id: 'cycle-preview',
      user_id: 'user-preview',
      cycle_month: '2026-11-01',
      status: 'active',
      swap_count_used: 1,
      created_at: createdAt,
    },
    items: [
      {
        challengeItem: {
          id: 'item-ready',
          cycle_id: 'cycle-preview',
          restaurant_id: 'rest-table',
          slot_number: 1,
          status: 'assigned',
          offer_version_id: null,
          redemption_deadline: null,
          credit_id: null,
        },
        restaurant: {
          id: 'rest-table',
          name: 'The Common Table',
          cuisine_tags: ['McKinney'],
          address: null,
          lat: null,
          lon: null,
          status: 'active',
          market_id: 'market-1',
          org_id: 'org-1',
        },
        offer: { available: true, discount_amount_cents: 1000, min_spend_cents: 4000 },
        visitStatus: 'ready',
      },
      {
        challengeItem: {
          id: 'item-code',
          cycle_id: 'cycle-preview',
          restaurant_id: 'rest-zen',
          slot_number: 2,
          status: 'redeemed',
          offer_version_id: null,
          redemption_deadline: null,
          credit_id: null,
        },
        restaurant: {
          id: 'rest-zen',
          name: 'Zen Sushi & Grill',
          cuisine_tags: ['Stonebridge'],
          address: null,
          lat: null,
          lon: null,
          status: 'active',
          market_id: 'market-1',
          org_id: 'org-1',
        },
        offer: { available: true, discount_amount_cents: 1000, min_spend_cents: 4000 },
        visitStatus: 'code_issued',
        redemptionId: 'red-preview',
      },
    ],
  };
}

export function ScreenPreview({ screen }: { screen: 'challenges' | 'redeem' }) {
  const [createdAt] = useState(() => new Date().toISOString());
  const [expiresAt] = useState(() => new Date(Date.now() + 12 * 60 * 1000).toISOString());

  if (screen === 'redeem') {
    return (
      <ShowRedemptionCode
        redemptionId="red-preview"
        challengeItemId="item-code"
        code="WB-4K7QM"
        expiresAt={expiresAt}
        redemptionDeadline={null}
        canReissue
        restaurantName="The Common Table"
        restaurantSlug="the-common-table"
        discountLabel="$10 off"
        minSpendLabel="$40 minimum spend"
        status="issued"
      />
    );
  }

  return (
    <DashboardClient
      appearance="golden"
      launchEligible
      currentChallenge={sampleChallenge(createdAt)}
      streak={streak}
      earnedBadges={[{ id: 'first_bite', name: 'First Bite', earnedOn: 'Earned on Sep 15, 2026' }]}
      biteNotes={[]}
    />
  );
}
