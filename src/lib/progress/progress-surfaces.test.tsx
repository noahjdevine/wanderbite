import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardClient } from '@/components/dashboard/dashboard-client';
import { PassportClient } from '@/components/passport/passport-client';
import { PROGRESS_UNAVAILABLE_MESSAGE } from '@/lib/progress/rules';

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

vi.mock('@/app/actions/bite-notes', () => ({
  saveBiteNote: vi.fn(),
}));

const earned = [
  {
    id: 'first_bite',
    name: 'First Bite',
    earnedOn: 'Earned on Sep 15, 2026',
  },
];

describe('progress surfaces', () => {
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

  it('shows the same First Bite date and streak on Challenges and Passport', async () => {
    const challenges = await render(
      <DashboardClient
        launchEligible
        currentChallenge={null}
        streak={{ currentStreak: 2, longestStreak: 2, totalMonthsActive: 2 }}
        earnedBadges={earned}
        showFirstBiteLocked={false}
        biteNotes={[]}
      />,
    );
    expect(challenges.textContent).toContain('2 month streak');
    expect(challenges.textContent).toContain('First Bite · Earned on Sep 15, 2026');
    expect(challenges.textContent).toContain('Longest streak:');
    expect(challenges.textContent).toContain('2 months');

    const passport = await render(
      <PassportClient
        userDisplayName="Noah"
        visits={[]}
        ratingsByRestaurantId={{}}
        biteNotesByRestaurantId={{}}
        currentStreak={2}
        longestStreak={2}
        totalMonthsActive={2}
        uniqueRestaurants={2}
        neighborhoods={2}
        earnedBadges={earned}
        showFirstBiteLocked={false}
      />,
    );
    expect(passport.textContent).toContain('2 months streak');
    expect(passport.textContent).toContain('First Bite · Earned on Sep 15, 2026');
    expect(passport.textContent).toContain('Longest streak: 2 months');
    expect(passport.textContent).toContain('2 restaurants');
  });

  it('shows First Bite locked on both surfaces', async () => {
    const challenges = await render(
      <DashboardClient
        launchEligible
        currentChallenge={null}
        streak={{ currentStreak: 0, longestStreak: 0, totalMonthsActive: 0 }}
        earnedBadges={[]}
        showFirstBiteLocked
        biteNotes={[]}
      />,
    );
    expect(challenges.textContent).toContain('First Bite locked');
    expect(challenges.textContent).not.toContain('First Bite · Earned');

    const passport = await render(
      <PassportClient
        userDisplayName="Noah"
        visits={[]}
        ratingsByRestaurantId={{}}
        biteNotesByRestaurantId={{}}
        currentStreak={0}
        longestStreak={0}
        totalMonthsActive={0}
        uniqueRestaurants={0}
        neighborhoods={0}
        earnedBadges={[]}
        showFirstBiteLocked
      />,
    );
    expect(passport.textContent).toContain('First Bite locked');
    expect(passport.textContent).not.toContain('Earned on');
  });

  it('shows the unavailable message instead of a zero streak', async () => {
    const challenges = await render(
      <DashboardClient
        launchEligible
        currentChallenge={null}
        streak={{ currentStreak: 0, longestStreak: 0, totalMonthsActive: 0 }}
        progressUnavailable
        biteNotes={[]}
      />,
    );
    expect(challenges.textContent).toContain(PROGRESS_UNAVAILABLE_MESSAGE);
    expect(challenges.textContent).not.toContain('0 month');
    expect(challenges.textContent).not.toContain('Longest streak');

    const passport = await render(
      <PassportClient
        userDisplayName="Noah"
        visits={[]}
        ratingsByRestaurantId={{}}
        biteNotesByRestaurantId={{}}
        currentStreak={0}
        longestStreak={0}
        totalMonthsActive={0}
        progressUnavailable
        uniqueRestaurants={0}
        neighborhoods={0}
        earnedBadges={[]}
        showFirstBiteLocked={false}
      />,
    );
    expect(passport.textContent).toContain('Passport temporarily unavailable');
    expect(passport.textContent).not.toContain('0 restaurants');
    expect(passport.textContent).not.toContain('0 months streak');
  });
});
