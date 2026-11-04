import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeneratedChallenge } from '@/app/actions/generate-challenge';
import { DashboardClient } from '@/components/dashboard/dashboard-client';
import { PassportClient, type PassportVisit } from '@/components/passport/passport-client';
import { StatusTrack } from '@/components/wb/status-track';
import { visitStatusLabel, type VisitStatus } from '@/lib/visits/visit-status';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/app/actions/generate-challenge', () => ({
  generateMonthlyChallenge: vi.fn(),
}));

vi.mock('@/app/actions/swap-challenge', () => ({
  swapChallengeItem: vi.fn(),
}));

vi.mock('@/app/actions/redeem-challenge', () => ({
  redeemChallengeItem: vi.fn(),
}));

vi.mock('@/app/actions/get-redemption-code', () => ({
  getRedemptionCode: vi.fn(),
}));

vi.mock('@/app/actions/bite-notes', () => ({
  saveBiteNote: vi.fn(),
  toggleNoteVisibility: vi.fn(),
}));

vi.mock('@/components/restaurants/restaurant-reviews', () => ({
  RestaurantReviews: () => null,
}));

vi.mock('@/components/restaurants/restaurant-photo', () => ({
  RestaurantPhoto: () => null,
  PassportVisitRestaurantPhoto: () => null,
}));

vi.mock('react-map-gl/maplibre', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Marker: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  NavigationControl: () => null,
  Popup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

const streak = { currentStreak: 0, longestStreak: 0, totalMonthsActive: 0 };

function item(
  id: string,
  status: 'assigned' | 'redeemed' | 'expired',
  visitStatus: VisitStatus,
): GeneratedChallenge['items'][number] {
  return {
    challengeItem: {
      id,
      cycle_id: 'cycle-1',
      restaurant_id: id,
      slot_number: 1,
      status,
      offer_version_id: null,
      redemption_deadline: '2026-12-01T00:00:00.000Z',
      credit_id: null,
    },
    restaurant: {
      id,
      name: id,
      cuisine_tags: [],
      address: null,
      lat: null,
      lon: null,
      status: 'active',
      market_id: 'market-1',
      org_id: 'org-1',
    },
    offer: { available: true, discount_amount_cents: 1000, min_spend_cents: 4000 },
    visitStatus,
  };
}

function challenge(items: GeneratedChallenge['items']): GeneratedChallenge {
  return {
    distanceMatch: null,
    cycle: {
      id: 'cycle-1',
      user_id: 'user-1',
      cycle_month: '2026-11-01',
      status: 'active',
      swap_count_used: 0,
      created_at: '2026-11-01T18:00:00.000Z',
    },
    items,
  };
}

function visit(status: VisitStatus): PassportVisit {
  return {
    id: 'red-1',
    verifiedAt: '2026-10-02T15:00:00.000Z',
    visitStatus: status,
    restaurant: {
      id: 'rest-1',
      name: 'North Grill',
      address: null,
      lat: null,
      lon: null,
      cuisine_tags: [],
      neighborhood: null,
      image_url: null,
      google_place_id: null,
    },
  };
}

describe('visit status surfaces', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  async function render(node: ReactElement) {
    await act(async () => {
      root.render(node);
    });
    return container;
  }

  it('maps code_expired to the code step and expired to the closed adventure', async () => {
    const expiredCode = await render(<StatusTrack status="code_expired" />);
    expect(expiredCode.querySelector('[aria-label="Status: Code expired. Get a new one"]')).not.toBeNull();
    expect(expiredCode.textContent).toContain('Code');
    expect(expiredCode.textContent).toContain('Code expired. Get a new one');
    expect(expiredCode.textContent).not.toContain('This adventure is no longer active.');

    const ended = await render(<StatusTrack status="expired" />);
    expect(ended.textContent).toContain('Expired');
    expect(ended.textContent).toContain('This adventure is no longer active.');
    expect(ended.textContent).not.toContain('Get a new one');

    const swapped = await render(<StatusTrack status="swapped" />);
    expect(swapped.textContent).toContain('Swapped');
    expect(swapped.getAttribute('data-visit-status') ?? swapped.querySelector('[data-visit-status="swapped"]')).toBeTruthy();
  });

  it('shows Ready and code_expired on Challenges without calling the adventure over', async () => {
    const view = await render(
      <DashboardClient
        launchEligible
        currentChallenge={challenge([
          item('ready-1', 'assigned', 'ready'),
          item('code-1', 'redeemed', 'code_expired'),
        ])}
        streak={streak}
        biteNotes={[]}
      />,
    );
    expect(view.querySelector('[data-visit-status="ready"]')?.textContent).toContain('Ready');
    expect(view.querySelector('[data-visit-status="code_expired"]')?.textContent).toContain(
      visitStatusLabel('code_expired'),
    );
    expect(view.textContent).not.toContain('This adventure is no longer active.');
  });

  it('shows the closed adventure on an expired challenge item', async () => {
    const view = await render(
      <DashboardClient
        launchEligible
        currentChallenge={challenge([item('ended-1', 'expired', 'expired')])}
        streak={streak}
        biteNotes={[]}
      />,
    );
    expect(view.textContent).toContain(visitStatusLabel('expired'));
    expect(view.textContent).not.toContain('Get a new one');
  });

  it('uses the same Note added label on Challenges and Passport', async () => {
    const challenges = await render(
      <DashboardClient
        launchEligible
        currentChallenge={challenge([item('noted-1', 'redeemed', 'note_added')])}
        streak={streak}
        biteNotes={[]}
      />,
    );
    const challengeLabel = challenges.querySelector('[data-visit-status="note_added"]')?.textContent ?? '';
    expect(challengeLabel).toContain(visitStatusLabel('note_added'));

    const passport = await render(
      <PassportClient
        userDisplayName="Noah"
        visits={[visit('note_added')]}
        ratingsByRestaurantId={{}}
        biteNotesByRestaurantId={{}}
        currentStreak={0}
        longestStreak={0}
        totalMonthsActive={0}
        uniqueRestaurants={1}
        neighborhoods={1}
        earnedBadges={[]}
        showFirstBiteLocked={false}
      />,
    );
    const passportLabel = passport.querySelector('[data-visit-status="note_added"]')?.textContent ?? '';
    expect(passportLabel).toContain(visitStatusLabel('note_added'));
    expect(challengeLabel).toContain(passportLabel.trim());
  });
});
