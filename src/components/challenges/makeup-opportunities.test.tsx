import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MakeupOpportunities } from '@/components/challenges/makeup-opportunities';
import {
  MAKEUP_RESTAURANT_CLOSED,
  makeupSpotAvailability,
} from '@/lib/boost/visit-problem';
import type { MemberMakeupSpot } from '@/lib/boost/visit-problem';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/app/actions/visit-problems', () => ({
  startMakeupVisit: vi.fn(),
}));

const NOW = new Date('2026-11-09T18:00:00.000Z');

function spot(overrides: Partial<MemberMakeupSpot> = {}): MemberMakeupSpot {
  return {
    id: 'spot-1',
    restaurantName: 'Test Grill',
    status: 'available',
    bookable: true,
    unavailableMessage: null,
    ...overrides,
  };
}

describe('make-up challenge spots', () => {
  afterEach(() => {
    cleanup();
  });

  it('offers a code at the restaurant while the spot is available', () => {
    render(<MakeupOpportunities spots={[spot()]} />);
    expect(screen.getByRole('heading', { name: 'Make-up challenge' })).toBeTruthy();
    expect(screen.getByText('Extra visit at Test Grill')).toBeTruthy();
    expect(screen.getByText('You can use this visit to get your code.')).toBeTruthy();
    expect(screen.getByRole('button', { name: "I'm here — get my code" })).toBeTruthy();
    expect(screen.queryByText(/does not add/i)).toBeNull();
    expect(screen.queryByText(/ready/i)).toBeNull();
  });

  it('shows a used spot as used', () => {
    render(<MakeupOpportunities spots={[spot({ status: 'used', bookable: false })]} />);
    expect(screen.getByText('Used.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: "I'm here — get my code" })).toBeNull();
    expect(screen.queryByText(/ready/i)).toBeNull();
  });

  it('shows a message and no button when the restaurant is not live', () => {
    render(
      <MakeupOpportunities
        spots={[
          spot({
            bookable: false,
            unavailableMessage: MAKEUP_RESTAURANT_CLOSED,
          }),
        ]}
      />,
    );
    expect(screen.getByText(MAKEUP_RESTAURANT_CLOSED)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders nothing when there is no spot', () => {
    const { container } = render(<MakeupOpportunities spots={[]} />);
    expect(container.textContent).toBe('');
  });
});

describe('makeup visit availability', () => {
  const offer = {
    validFrom: '2026-09-01T00:00:00.000Z',
    validUntil: '2026-12-01T00:00:00.000Z',
    withdrawnAt: null,
  };

  it('stays bookable for an active restaurant and a live offer inside the visit window', () => {
    expect(
      makeupSpotAvailability({
        status: 'available',
        restaurantStatus: 'active',
        offerVersionId: 'version-1',
        offer,
        redemptionDeadline: '2026-11-20T00:00:00.000Z',
        now: NOW,
      }),
    ).toEqual({ bookable: true, unavailableMessage: null });
  });

  it('refuses a paused restaurant, a closed offer, a closed window, and a used spot', () => {
    expect(
      makeupSpotAvailability({
        status: 'available',
        restaurantStatus: 'paused',
        offerVersionId: 'version-1',
        offer,
        redemptionDeadline: '2026-11-20T00:00:00.000Z',
        now: NOW,
      }).unavailableMessage,
    ).toBe('This restaurant is not taking visits right now.');
    expect(
      makeupSpotAvailability({
        status: 'available',
        restaurantStatus: 'active',
        offerVersionId: 'version-1',
        offer: { ...offer, withdrawnAt: '2026-11-01T00:00:00.000Z' },
        redemptionDeadline: '2026-11-20T00:00:00.000Z',
        now: NOW,
      }).unavailableMessage,
    ).toBe('This offer is no longer available.');
    expect(
      makeupSpotAvailability({
        status: 'available',
        restaurantStatus: 'active',
        offerVersionId: null,
        offer: null,
        redemptionDeadline: '2026-11-01T00:00:00.000Z',
        now: NOW,
      }).unavailableMessage,
    ).toBe('This visit window has closed.');
    expect(
      makeupSpotAvailability({
        status: 'used',
        restaurantStatus: 'active',
        offerVersionId: 'version-1',
        offer,
        redemptionDeadline: '2026-11-20T00:00:00.000Z',
        now: NOW,
      }),
    ).toEqual({ bookable: false, unavailableMessage: null });
  });
});
