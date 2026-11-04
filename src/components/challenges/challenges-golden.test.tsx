import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeneratedChallenge } from '@/app/actions/generate-challenge';
import { DashboardClient } from '@/components/dashboard/dashboard-client';
import { TICKET_PHOTO_HEIGHT } from '@/components/challenges/adventure-ticket';
import { PROGRESS_UNAVAILABLE_MESSAGE } from '@/lib/progress/rules';
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
  getRedemptionCode: vi.fn(async () => ({ state: 'expired', expiresAt: null })),
}));

vi.mock('@/app/actions/bite-notes', () => ({
  saveBiteNote: vi.fn(),
  toggleNoteVisibility: vi.fn(),
}));

vi.mock('@/components/restaurants/restaurant-reviews', () => ({
  RestaurantReviews: () => null,
}));

vi.mock('@/components/restaurants/restaurant-photo', () => ({
  RestaurantPhoto: () => <span data-photo="fixed" />,
}));

const streak = { currentStreak: 2, longestStreak: 4, totalMonthsActive: 3 };

function item(
  id: string,
  name: string,
  status: 'assigned' | 'redeemed' | 'expired',
  visitStatus: VisitStatus,
  cents: { discount: number; min: number } = { discount: 1000, min: 4000 },
): GeneratedChallenge['items'][number] {
  return {
    challengeItem: {
      id,
      cycle_id: 'cycle-1',
      restaurant_id: id,
      slot_number: 1,
      status,
      offer_version_id: 'ver-1',
      redemption_deadline: '2026-12-01T05:30:00.000Z',
      credit_id: null,
    },
    restaurant: {
      id,
      name,
      cuisine_tags: ['thai'],
      address: null,
      lat: null,
      lon: null,
      status: 'active',
      market_id: 'market-1',
      org_id: 'org-1',
    },
    offer: { available: true, discount_amount_cents: cents.discount, min_spend_cents: cents.min },
    visitStatus,
    redemptionId: status === 'redeemed' ? `red-${id}` : null,
  };
}

function challenge(
  items: GeneratedChallenge['items'],
  swapCount = 0,
): GeneratedChallenge {
  return {
    distanceMatch: null,
    cycle: {
      id: 'cycle-1',
      user_id: 'user-1',
      cycle_month: '2026-11-01',
      status: 'active',
      swap_count_used: swapCount,
      created_at: '2026-11-01T18:00:00.000Z',
    },
    items,
  };
}

describe('golden challenges', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T18:00:00.000Z'));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  async function render(node: ReactElement) {
    await act(async () => {
      root.render(node);
    });
    return container;
  }

  it('leads with the month header and keeps the first ticket ahead of the streak', async () => {
    const view = await render(
      <DashboardClient
        appearance="golden"
        launchEligible
        currentChallenge={challenge([
          item('ready-1', 'The Common Table', 'assigned', 'ready'),
          item('code-1', 'Zen Sushi', 'redeemed', 'code_issued'),
        ])}
        streak={streak}
        earnedBadges={[{ id: 'first_bite', name: 'First Bite', earnedOn: 'Earned on Sep 15, 2026' }]}
        biteNotes={[]}
      />,
    );
    const text = view.textContent ?? '';
    expect(text).toContain('Your');
    expect(text).toContain('November');
    expect(text).toContain('26 days left this month');
    expect(text).toContain('0');
    expect(text).toContain('/2');
    expect(text).toContain('verified');
    expect(text).toContain('code issued');
    expect(text).toContain('1');
    expect(text).toContain('swap left');
    expect(text).toContain("I'm here — get my code");
    expect(text).toContain('Show code to your server');
    expect(text).toContain('$10 off when you spend $40+');
    expect(view.querySelector('[data-visit-status="ready"]')?.textContent).toContain('Ready');
    expect(view.querySelector('[data-visit-status="code_issued"]')?.textContent).toContain(
      visitStatusLabel('code_issued'),
    );
    const actionAt = text.indexOf("I'm here — get my code");
    const streakAt = text.indexOf('Dining streak');
    expect(actionAt).toBeGreaterThan(-1);
    expect(streakAt).toBeGreaterThan(actionAt);
    expect(text).toContain('2 month streak');
    expect(text).toContain('First Bite · Earned on Sep 15, 2026');
    const frames = view.querySelectorAll('article div');
    const heights = Array.from(frames)
      .map((node) => (node as HTMLElement).style.height)
      .filter((height) => height);
    expect(heights).toContain(`${TICKET_PHOTO_HEIGHT}px`);
    expect(heights.every((height) => height === `${TICKET_PHOTO_HEIGHT}px`)).toBe(true);
  });

  it('maps code_expired to the code step and a closed visit to the ended adventure', async () => {
    const open = await render(
      <DashboardClient
        appearance="golden"
        launchEligible
        currentChallenge={challenge([
          item('ready-1', 'North Grill', 'assigned', 'ready'),
          item('code-1', 'South Grill', 'redeemed', 'code_expired'),
        ])}
        streak={streak}
        biteNotes={[]}
      />,
    );
    expect(open.querySelector('[data-visit-status="code_expired"]')?.textContent).toContain(
      visitStatusLabel('code_expired'),
    );
    expect(open.textContent).not.toContain('This adventure is no longer active.');
    expect(open.textContent).toContain('Get a new one');

    const ended = await render(
      <DashboardClient
        appearance="golden"
        launchEligible
        currentChallenge={challenge([item('ended-1', 'Closed Spot', 'expired', 'expired')])}
        streak={streak}
        biteNotes={[]}
      />,
    );
    expect(ended.textContent).toContain(visitStatusLabel('expired'));
    expect(ended.textContent).not.toContain('Get a new one');
    expect(ended.textContent).not.toContain("I'm here — get my code");
  });

  it('drops tiles that are not loaded and keeps reveal copy', async () => {
    const empty = await render(
      <DashboardClient appearance="golden" launchEligible currentChallenge={null} streak={streak} biteNotes={[]} />,
    );
    expect(empty.textContent).toContain('November');
    expect(empty.textContent).toContain('Generate Challenge');
    expect(empty.textContent).not.toContain('verified');
    expect(empty.textContent).not.toContain('code issued');
    expect(empty.textContent).not.toContain('swap left');
    expect(empty.textContent).not.toContain('swaps left');

    const revealed = await render(
      <DashboardClient
        appearance="golden"
        launchEligible
        currentChallenge={challenge(
          [
            item('done', 'Alpha Kitchen', 'redeemed', 'verified', { discount: 2000, min: 5000 }),
            item('open', 'Beta Grill', 'assigned', 'ready', { discount: 1500, min: 4000 }),
          ],
          0,
        )}
        streak={{ currentStreak: 0, longestStreak: 0, totalMonthsActive: 0 }}
        progressUnavailable
        biteNotes={[]}
        monthlyReveal={{ mode: 'revealed', reasons: [] }}
      />,
    );
    const text = revealed.textContent ?? '';
    expect(text).toContain('$20 off when you spend $50+');
    expect(text).toContain('$15 off when you spend $40+');
    expect(text).toContain('Redeem by Nov 30, 2026');
    expect(text).toContain('Completed');
    expect(text).toContain('Not completed yet');
    expect(text).toContain('1');
    expect(text).toContain('swap left');
    expect(text).toContain(PROGRESS_UNAVAILABLE_MESSAGE);
    expect(text).not.toContain('0 month');
    expect(text.toLowerCase()).not.toContain('boost');
  });
});
