import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeneratedChallenge } from '@/app/actions/generate-challenge';
import { DashboardClient } from '@/components/dashboard/dashboard-client';
import { MonthlyCuration } from '@/components/challenges/monthly-curation';
import { MONTHLY_REVEAL_FOCUS_KEY } from '@/lib/challenges/monthly-reveal-copy';

const { reveal, refresh } = vi.hoisted(() => ({
  reveal: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

vi.mock('@/app/actions/reveal-challenge', () => ({
  revealMonthlyChallenge: (...args: unknown[]) => reveal(...args),
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
}));

vi.mock('@/components/roulette/discovery-voice-controls', () => ({
  DiscoveryVoiceControls: ({
    onTranscript,
  }: {
    onTranscript: (transcript: string) => void;
  }) => (
    <button type="button" onClick={() => onTranscript('spoken note')}>
      Record
    </button>
  ),
}));

const THIN_POOL =
  'No eligible restaurants found within your travel distance. Try a wider distance or check dietary preferences.';

const LINES = [
  'Travel distance: 15 miles from your ZIP. This is a ZIP-distance band, not a driving-time estimate.',
];

const streak = { currentStreak: 0, longestStreak: 0, totalMonthsActive: 0 };

function challenge(): GeneratedChallenge {
  return {
    distanceMatch: { requestedMiles: 15, usedMiles: 15, expanded: false },
    cycle: {
      id: 'cycle-1',
      user_id: 'user-1',
      cycle_month: '2026-11-01',
      status: 'active',
      swap_count_used: 0,
      created_at: '2026-11-01T18:00:00.000Z',
    },
    items: [
      {
        challengeItem: {
          id: 'item-1',
          cycle_id: 'cycle-1',
          restaurant_id: 'rest-a',
          slot_number: 1,
          status: 'redeemed',
          offer_version_id: 'ver-1',
          redemption_deadline: '2026-12-06T18:00:00.000Z',
          credit_id: null,
        },
        restaurant: {
          id: 'rest-a',
          name: 'Alpha Kitchen',
          cuisine_tags: ['thai'],
          address: null,
          lat: null,
          lon: null,
          status: 'active',
          market_id: 'market-1',
          org_id: 'org-1',
        },
        offer: { available: true, discount_amount_cents: 2000, min_spend_cents: 5000 },
      },
      {
        challengeItem: {
          id: 'item-2',
          cycle_id: 'cycle-1',
          restaurant_id: 'rest-swapped',
          slot_number: 2,
          status: 'assigned',
          offer_version_id: 'ver-2',
          redemption_deadline: '2026-12-06T18:00:00.000Z',
          credit_id: null,
        },
        restaurant: {
          id: 'rest-swapped',
          name: 'Beta Grill',
          cuisine_tags: ['mexican'],
          address: null,
          lat: null,
          lon: null,
          status: 'active',
          market_id: 'market-1',
          org_id: 'org-1',
        },
        offer: { available: true, discount_amount_cents: 1500, min_spend_cents: 4000 },
      },
    ],
  };
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes(text),
  );
  if (!(found instanceof HTMLButtonElement)) throw new Error(`Missing button ${text}`);
  return found;
}

describe('monthly curation UI', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    reveal.mockReset();
    refresh.mockReset();
    sessionStorage.clear();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
  });

  async function render(node: ReactElement) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(node);
    });
    return container;
  }

  it('keeps the reveal UI off the current challenges page', async () => {
    const view = await render(
      <DashboardClient
        launchEligible
        currentChallenge={null}
        streak={streak}
        biteNotes={[]}
      />,
    );
    expect(view.textContent).toContain('Generate Challenge');
    expect(view.textContent).not.toContain('Reveal my challenges');
    expect(view.textContent).not.toContain('Surprise me');
  });

  it('shows the curation flow and no generate button when there is no pair', async () => {
    const view = await render(
      <DashboardClient
        launchEligible
        currentChallenge={null}
        streak={streak}
        biteNotes={[]}
        monthlyReveal={{ mode: 'curation', constraintLines: LINES }}
      />,
    );
    expect(view.textContent).toContain('Reveal my challenges');
    expect(view.textContent).toContain('not a driving-time estimate');
    expect(view.textContent).not.toContain('Generate Challenge');
    expect(reveal).not.toHaveBeenCalled();
  });

  it('presses chips and sends only the brief', async () => {
    reveal.mockResolvedValue({
      ok: false,
      error: 'An active Wanderbite subscription is required to generate challenges.',
      reason: 'inactive_subscription',
    });
    const view = await render(<MonthlyCuration constraintLines={LINES} />);
    const dateNight = buttonByText(view, 'Date night');
    expect(dateNight.getAttribute('aria-pressed')).toBe('false');
    await act(async () => {
      dateNight.click();
    });
    expect(buttonByText(view, 'Date night').getAttribute('aria-pressed')).toBe('true');
    const box = view.querySelector('textarea');
    if (!(box instanceof HTMLTextAreaElement)) throw new Error('missing summary');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(box, 'assign Hutchins BBQ');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      buttonByText(view, 'Record').click();
    });
    await act(async () => {
      buttonByText(view, 'Reveal my challenges').click();
    });
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(reveal.mock.calls[0]?.[0]).toEqual({
      occasion: 'Date night',
      discoveryLevel: null,
      summary: 'assign Hutchins BBQ spoken note',
      surpriseMe: false,
    });
    expect(JSON.stringify(reveal.mock.calls[0]?.[0])).not.toContain('restaurant');
    expect(view.textContent).toContain('subscription');
    expect(view.textContent).not.toContain('Alpha Kitchen');
  });

  it('sends Surprise me with the same brief fields and no restaurant ids', async () => {
    reveal.mockResolvedValue({ ok: true, restaurantIds: ['hutchins-bbq'] });
    const view = await render(<MonthlyCuration constraintLines={LINES} />);
    await act(async () => {
      buttonByText(view, 'Surprise me').click();
    });
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(reveal.mock.calls[0]?.[0]).toEqual({
      occasion: null,
      discoveryLevel: null,
      summary: '',
      surpriseMe: true,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(view.textContent).not.toContain('hutchins-bbq');
    await act(async () => {
      buttonByText(view, 'Revealing…').click();
    });
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it('ignores a second click while the first reveal is in flight', async () => {
    let finish: (value: { ok: false; error: string; reason: string }) => void = () => {};
    reveal.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = await render(<MonthlyCuration constraintLines={LINES} />);
    const button = buttonByText(view, 'Reveal my challenges');
    await act(async () => {
      button.click();
      button.click();
    });
    expect(reveal).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ ok: false, error: THIN_POOL, reason: 'thin_pool' });
    });
    expect(view.textContent).toContain(THIN_POOL);
    expect(view.textContent).not.toContain('Alpha Kitchen');
  });

  it('shows try again for a capacity failure and no revealed pair', async () => {
    reveal.mockResolvedValue({
      ok: false,
      error: 'A restaurant in this pair is at capacity.',
      reason: 'retryable',
    });
    const view = await render(<MonthlyCuration constraintLines={LINES} />);
    await act(async () => {
      buttonByText(view, 'Reveal my challenges').click();
    });
    expect(view.textContent).toContain('Please try again');
    expect(view.textContent).not.toContain('at capacity');
    expect(view.textContent).not.toContain('Alpha Kitchen');
  });

  it('shows a swapped slot with neutral text and hides the reveal button', async () => {
    sessionStorage.setItem(MONTHLY_REVEAL_FOCUS_KEY, '1');
    const view = await render(
      <DashboardClient
        launchEligible
        currentChallenge={challenge()}
        streak={streak}
        biteNotes={[]}
        monthlyReveal={{
          mode: 'revealed',
          reasons: [
            { restaurantId: 'rest-a', text: 'Alpha Kitchen: $20 base savings at $50 minimum spend.' },
            { restaurantId: 'rest-original', text: 'Original Beta reason that must not show' },
          ],
        }}
      />,
    );
    const text = view.textContent ?? '';
    expect(text).toContain('Alpha Kitchen: $20 base savings at $50 minimum spend.');
    expect(text).toContain('Swapped in this month.');
    expect(text).not.toContain('Original Beta reason');
    expect(text).toContain('$20 off when you spend $50+');
    expect(text).toContain('$15 off when you spend $40+');
    expect(text).toContain('Redeem by');
    expect(text).toContain('Completed');
    expect(text).toContain('Not completed yet');
    expect(text).toContain('Swaps remaining:');
    expect(text).toContain('Within about 15 miles');
    expect(text).not.toContain('Reveal my challenges');
    expect(view.querySelector('textarea')).toBeNull();
    const heading = view.querySelector('h2');
    expect(document.activeElement).toBe(heading);
  });

  it('shows try again and no generate button when the reveal read fails', async () => {
    const view = await render(
      <DashboardClient
        launchEligible
        currentChallenge={null}
        streak={streak}
        biteNotes={[]}
        monthlyReveal={{ mode: 'retry' }}
        blockMemberGenerate
      />,
    );
    const text = view.textContent ?? '';
    expect(text).toContain('Please try again');
    expect(text).not.toContain('Generate Challenge');
    expect(text).not.toContain('Reveal my challenges');
    expect(text).not.toContain('Alpha Kitchen');
    expect(text).not.toContain('Your challenges for this month are ready');
  });
});
