'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  activateRestaurant,
  getOfferDraft,
  previewOfferDraft,
  publishOfferDraft,
  saveOfferDraft,
  withdrawCurrentOffer,
  type OfferDraftInput,
} from './offer-actions';
import type { OfferQuote } from '@/lib/offers/calculator';

type RestaurantOption = { id: string; name: string };

const EMPTY: OfferDraftInput = {
  restaurantId: '',
  timezone: 'America/Chicago',
  validFrom: null,
  validUntil: null,
  tiers: [{ thresholdCents: 4000, discountCents: 1000 }],
  boosts: [],
  capacityTimezone: 'America/Chicago',
  capacityMaxRedemptions: 50,
  boostSessionMinutes: 240,
};

export function OfferDraftCard({ restaurants }: { restaurants: RestaurantOption[] }) {
  const [draft, setDraft] = useState<OfferDraftInput>(EMPTY);
  const [message, setMessage] = useState<string | null>(null);
  const [quote, setQuote] = useState<OfferQuote | null>(null);
  const [pairText, setPairText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [subtotal, setSubtotal] = useState('4000');
  const [compareDiscount, setCompareDiscount] = useState('1000');

  async function load(restaurantId: string) {
    setBusy(true);
    setMessage(null);
    setQuote(null);
    try {
      const result = await getOfferDraft(restaurantId);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setDraft(
        result.draft ?? {
          ...EMPTY,
          restaurantId,
        },
      );
    } finally {
      setBusy(false);
    }
  }

  function tier(index: number, field: 'thresholdCents' | 'discountCents', value: string) {
    const next = [...draft.tiers];
    const current = next[index] ?? { thresholdCents: 0, discountCents: 0 };
    next[index] = { ...current, [field]: Number(value) };
    setDraft({ ...draft, tiers: next });
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await saveOfferDraft(draft);
      setMessage(result.ok ? 'Draft saved. This screen does not publish.' : result.error);
    } finally {
      setBusy(false);
    }
  }

  async function preview() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await previewOfferDraft({
        tiers: draft.tiers,
        boosts: draft.boosts,
        timeZone: draft.timezone || 'America/Chicago',
        validFrom: draft.validFrom || new Date().toISOString(),
        validUntil: draft.validUntil || new Date(Date.now() + 86_400_000).toISOString(),
        eligibleSubtotalCents: Number(subtotal),
        at: new Date().toISOString(),
        checkInAt: null,
        mode: 'selection',
        redemptionDeadline: null,
        comparisonTiers: [{ thresholdCents: 4000, discountCents: Number(compareDiscount) }],
      });
      if (!result.ok) {
        setMessage(result.error);
        setQuote(null);
        return;
      }
      setQuote(result.quote);
      setPairText(
        `${result.modelLabel}: pair base ${result.pair.baseCents} cents, qualifying spend ${result.pair.qualifyingSpendCents} cents, $20 target ${result.targetCents} cents, ${result.pair.ok ? 'pass' : result.pair.reason}.`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-primary">Offer draft</CardTitle>
        <CardDescription>
          Save a draft, preview, publish, or activate a paused restaurant that already has a current version.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="block text-sm font-medium" htmlFor="offer-restaurant">
          Restaurant
        </label>
        <select
          id="offer-restaurant"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={draft.restaurantId}
          onChange={(event) => void load(event.target.value)}
        >
          <option value="">Select a restaurant</option>
          {restaurants.map((restaurant) => (
            <option key={restaurant.id} value={restaurant.id}>
              {restaurant.name}
            </option>
          ))}
        </select>
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            aria-label="Offer timezone"
            className="rounded-md border bg-background px-3 py-2 text-sm"
            value={draft.timezone ?? ''}
            onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}
          />
          <input
            aria-label="Capacity timezone"
            className="rounded-md border bg-background px-3 py-2 text-sm"
            value={draft.capacityTimezone ?? ''}
            onChange={(event) => setDraft({ ...draft, capacityTimezone: event.target.value })}
          />
          <input
            aria-label="Valid from"
            type="datetime-local"
            className="rounded-md border bg-background px-3 py-2 text-sm"
            value={draft.validFrom ? draft.validFrom.slice(0, 16) : ''}
            onChange={(event) =>
              setDraft({
                ...draft,
                validFrom: event.target.value ? new Date(event.target.value).toISOString() : null,
              })
            }
          />
          <input
            aria-label="Valid until"
            type="datetime-local"
            className="rounded-md border bg-background px-3 py-2 text-sm"
            value={draft.validUntil ? draft.validUntil.slice(0, 16) : ''}
            onChange={(event) =>
              setDraft({
                ...draft,
                validUntil: event.target.value ? new Date(event.target.value).toISOString() : null,
              })
            }
          />
          <input
            aria-label="Tier threshold cents"
            className="rounded-md border bg-background px-3 py-2 text-sm"
            value={draft.tiers[0]?.thresholdCents ?? ''}
            onChange={(event) => tier(0, 'thresholdCents', event.target.value)}
          />
          <input
            aria-label="Tier discount cents"
            className="rounded-md border bg-background px-3 py-2 text-sm"
            value={draft.tiers[0]?.discountCents ?? ''}
            onChange={(event) => tier(0, 'discountCents', event.target.value)}
          />
          <input
            aria-label="Capacity max redemptions"
            className="rounded-md border bg-background px-3 py-2 text-sm"
            value={draft.capacityMaxRedemptions ?? ''}
            onChange={(event) =>
              setDraft({ ...draft, capacityMaxRedemptions: Number(event.target.value) })
            }
          />
          <input
            aria-label="Boost session minutes"
            className="rounded-md border bg-background px-3 py-2 text-sm"
            value={draft.boostSessionMinutes ?? ''}
            onChange={(event) =>
              setDraft({ ...draft, boostSessionMinutes: Number(event.target.value) })
            }
          />
          <input
            aria-label="Preview subtotal cents"
            className="rounded-md border bg-background px-3 py-2 text-sm"
            value={subtotal}
            onChange={(event) => setSubtotal(event.target.value)}
          />
          <input
            aria-label="Comparison discount cents"
            className="rounded-md border bg-background px-3 py-2 text-sm"
            value={compareDiscount}
            onChange={(event) => setCompareDiscount(event.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button type="button" disabled={busy || !draft.restaurantId} onClick={() => void save()}>
            Save draft
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void preview()}>
            Preview
          </Button>
          <Button
            type="button"
            disabled={busy || !draft.restaurantId}
            onClick={() =>
              void (async () => {
                setBusy(true);
                setMessage(null);
                try {
                  const result = await publishOfferDraft(draft.restaurantId);
                  setMessage(result.ok ? 'Published. The restaurant stays paused until you activate it.' : result.error);
                } finally {
                  setBusy(false);
                }
              })()
            }
          >
            Publish
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || !draft.restaurantId}
            onClick={() =>
              void (async () => {
                setBusy(true);
                setMessage(null);
                try {
                  const result = await withdrawCurrentOffer(draft.restaurantId);
                  setMessage(result.ok ? 'Withdrawn from new selection.' : result.error);
                } finally {
                  setBusy(false);
                }
              })()
            }
          >
            Withdraw
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || !draft.restaurantId}
            onClick={() =>
              void (async () => {
                setBusy(true);
                setMessage(null);
                try {
                  const result = await activateRestaurant(draft.restaurantId);
                  setMessage(result.ok ? 'Restaurant is active.' : result.error);
                } finally {
                  setBusy(false);
                }
              })()
            }
          >
            Activate
          </Button>
        </div>
        {message ? <p className="text-sm">{message}</p> : null}
        {quote ? (
          <p className="text-sm">
            Preview discount {quote.discountCents} cents ({quote.reason}).
          </p>
        ) : null}
        {pairText ? <p className="text-sm">{pairText}</p> : null}
      </CardContent>
    </Card>
  );
}
