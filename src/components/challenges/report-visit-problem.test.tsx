import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeneratedChallengeItem } from '@/app/actions/generate-challenge';
import { AdventureTicket } from '@/components/challenges/adventure-ticket';
import { ShowRedemptionCode } from '@/components/challenges/show-redemption-code';
import { RestaurantCard } from '@/components/dashboard/restaurant-card';
import type { MemberVisitProblem } from '@/lib/boost/visit-problem';
import { ACTIVITY_NOTE_HEADING } from '@/lib/activities/types';
import { RECIPES_SECTION_HEADING, type RecipeCardModel } from '@/lib/recipes/display';

const getOwnVisitProblem = vi.fn();
const submitVisitProblem = vi.fn();

vi.mock('@/app/actions/visit-problems', () => ({
  getOwnVisitProblem: (...args: unknown[]) => getOwnVisitProblem(...args),
  submitVisitProblem: (...args: unknown[]) => submitVisitProblem(...args),
}));

vi.mock('@/app/actions/get-redemption-code', () => ({
  getRedemptionCode: vi.fn(),
}));

vi.mock('@/app/actions/redeem-challenge', () => ({
  redeemChallengeItem: vi.fn(),
}));

vi.mock('@/components/restaurants/restaurant-reviews', () => ({
  RestaurantReviews: () => null,
}));

vi.mock('@/components/restaurants/restaurant-photo', () => ({
  RestaurantPhoto: () => <span data-photo="fixed" />,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const problem: MemberVisitProblem = {
  id: 'case-1',
  challengeItemId: '44444444-4444-4444-8444-444444444444',
  redemptionId: null,
  category: 'check_in_code',
  categoryLabel: 'Check-in or code trouble',
  explanation: 'The code would not scan.',
  status: 'under_review',
  statusLabel: 'Under review',
  response: 'We are looking at the code.',
  createdAt: '2026-11-09T01:00:00.000Z',
  updatedAt: '2026-11-09T01:10:00.000Z',
};

function item(status: 'assigned' | 'swapped_out' = 'assigned'): GeneratedChallengeItem {
  return {
    challengeItem: {
      id: '44444444-4444-4444-8444-444444444444',
      cycle_id: 'cycle-1',
      restaurant_id: 'restaurant-1',
      slot_number: 1,
      status,
      offer_version_id: 'version-1',
      redemption_deadline: '2026-12-01T00:00:00.000Z',
      credit_id: null,
    },
    restaurant: {
      id: 'restaurant-1',
      name: 'Test Grill',
      cuisine_tags: [],
      address: null,
      lat: null,
      lon: null,
      status: 'active',
      market_id: 'market-1',
      org_id: 'org-1',
    },
    offer: { available: true, discount_amount_cents: 1000, min_spend_cents: 4000 },
    visitStatus: 'ready',
  };
}

describe('report a visit problem', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    getOwnVisitProblem.mockReset();
    submitVisitProblem.mockReset();
    getOwnVisitProblem.mockResolvedValue({ ok: true, problem: null });
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

  function ticket(visitProblems: boolean, row = item()) {
    return (
      <AdventureTicket
        item={row}
        cycleCreatedAt="2026-11-01T18:00:00.000Z"
        canSwap={false}
        swapsRemaining={1}
        isSwapping={false}
        isRedeeming={false}
        onSwap={() => undefined}
        onRedeem={() => undefined}
        visitProblems={visitProblems}
      />
    );
  }

  it('keeps the challenge card unchanged when the flag is off', async () => {
    const view = await render(ticket(false));
    expect(view.textContent).toContain("I'm here — get my code");
    expect(view.textContent).not.toContain('Report it here');
    expect(getOwnVisitProblem).not.toHaveBeenCalled();
  });

  it('reports from the challenge card without a code and shows the member response', async () => {
    const view = await render(ticket(true));
    expect(getOwnVisitProblem).toHaveBeenCalledWith('44444444-4444-4444-8444-444444444444');
    const open = [...view.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Report it here'),
    );
    expect(open?.textContent).toContain('Report it here');
    await act(async () => {
      open?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const form = view.querySelector('form');
    const explanation = view.querySelector('textarea');
    expect(form).toBeTruthy();
    expect(explanation).toBeTruthy();
    if (explanation) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(explanation, 'The code would not scan.');
      explanation.dispatchEvent(new Event('input', { bubbles: true }));
      explanation.dispatchEvent(new Event('change', { bubbles: true }));
    }
    submitVisitProblem.mockResolvedValue({ ok: true, problem });
    await act(async () => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(submitVisitProblem).toHaveBeenCalledWith(
      expect.objectContaining({
        challengeItemId: '44444444-4444-4444-8444-444444444444',
        redemptionId: null,
        category: 'check_in_code',
        explanation: 'The code would not scan.',
      }),
    );
    expect(view.textContent).toContain('Under review');
    expect(view.textContent).toContain('We are looking at the code.');
    expect(view.textContent).not.toContain('internal-only');
  });

  it('does not offer a report on a swapped visit', async () => {
    const view = await render(ticket(true, item('swapped_out')));
    expect(view.textContent).not.toContain('Report it here');
    expect(getOwnVisitProblem).not.toHaveBeenCalled();
  });

  it('puts the same report on the visit detail screen only when enabled', async () => {
    const hidden = await render(
      <ShowRedemptionCode
        redemptionId="66666666-6666-4666-8666-666666666666"
        challengeItemId="44444444-4444-4444-8444-444444444444"
        code="WB-TEST"
        expiresAt="2026-11-09T02:00:00.000Z"
        redemptionDeadline="2026-12-01T00:00:00.000Z"
        canReissue={false}
        restaurantName="Test Grill"
        restaurantSlug="test-grill"
        discountLabel="$10 off"
        minSpendLabel="$40 minimum spend"
        status="issued"
        visitProblems={false}
      />,
    );
    expect(hidden.textContent).not.toContain('Report it here');
    expect(getOwnVisitProblem).not.toHaveBeenCalled();

    getOwnVisitProblem.mockResolvedValue({ ok: true, problem });
    const shown = await render(
      <ShowRedemptionCode
        redemptionId="66666666-6666-4666-8666-666666666666"
        challengeItemId="44444444-4444-4444-8444-444444444444"
        code="WB-TEST"
        expiresAt="2026-11-09T02:00:00.000Z"
        redemptionDeadline="2026-12-01T00:00:00.000Z"
        canReissue={false}
        restaurantName="Test Grill"
        restaurantSlug="test-grill"
        discountLabel="$10 off"
        minSpendLabel="$40 minimum spend"
        status="issued"
        visitProblems
      />,
    );
    expect(shown.textContent).toContain('Your visit report');
    expect(shown.textContent).toContain('Under review');
    expect(shown.textContent).toContain('We are looking at the code.');
    expect(shown.textContent).not.toContain('Correct savings');
    expect(shown.textContent).not.toContain('Report it here');
    expect(shown.querySelector('h4')).toBeNull();
    expect(shown.querySelector('[data-visit-problem]')?.getAttribute('aria-label')).toBe('Visit problem');
    expect(shown.querySelector('[data-visit-problem]')?.className).not.toContain('border-t');
    const report = shown.querySelector('[data-visit-problem]');
    const back = [...shown.querySelectorAll('a')].find((link) => link.textContent?.includes('Back to challenges'));
    expect(report).toBeTruthy();
    expect(back).toBeTruthy();
    expect(report && back && (report.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
    expect(getOwnVisitProblem).toHaveBeenCalled();
  });

  it('shows an inline error when the explanation is empty or only whitespace', async () => {
    const view = await render(ticket(true));
    const open = [...view.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Report it here'),
    );
    await act(async () => {
      open?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const form = view.querySelector('form');
    await act(async () => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(view.textContent).toContain('Tell us what happened');
    expect(submitVisitProblem).not.toHaveBeenCalled();

    const explanation = view.querySelector('textarea');
    if (explanation) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(explanation, '   ');
      explanation.dispatchEvent(new Event('input', { bubbles: true }));
      explanation.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await act(async () => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(view.textContent).toContain('Tell us what happened');
    expect(submitVisitProblem).not.toHaveBeenCalled();
  });

  it('shows one underlined report control and no visit-problem header', async () => {
    const view = await render(ticket(true));
    const section = view.querySelector('[data-visit-problem]');
    expect(section?.querySelector('h4')).toBeNull();
    expect(section?.getAttribute('aria-label')).toBe('Visit problem');
    expect(view.textContent).not.toContain('Checking this visit');
    const buttons = [...(section?.querySelectorAll('button') ?? [])];
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toContain('Having a problem with your visit?');
    expect(buttons[0]?.className).toContain('min-h-11');
    const label = buttons[0]?.querySelector('span');
    expect(label?.textContent).toBe('Report it here');
    expect(label?.className).toContain('text-wb-plum');
    expect(label?.className).toContain('font-medium');
    expect(label?.className).toContain('underline');
  });

  it('renders nothing while the existing report is still loading', async () => {
    let resolveCheck: (value: { ok: true; problem: null }) => void = () => undefined;
    getOwnVisitProblem.mockReturnValue(
      new Promise((resolve) => {
        resolveCheck = resolve;
      }),
    );
    await act(async () => {
      root.render(ticket(true));
    });
    expect(container.textContent).not.toContain('Checking this visit');
    expect(container.querySelector('[data-visit-problem]')).toBeNull();
    await act(async () => {
      resolveCheck({ ok: true, problem: null });
    });
    expect(container.textContent).toContain('Report it here');
  });

  it('labels an existing report and hides the report control', async () => {
    getOwnVisitProblem.mockResolvedValue({ ok: true, problem });
    const view = await render(ticket(true));
    expect(view.textContent).toContain('Your visit report');
    expect(view.textContent).toContain('Under review');
    expect(view.querySelector('[data-visit-problem] button')).toBeNull();
    expect(view.querySelector('h4')).toBeNull();
  });

  it('places the report control after recipes and the note', async () => {
    const recipe: RecipeCardModel = {
      id: 'recipe-1',
      slug: 'sample-chili',
      title: 'Sample Chili',
      recipeType: 'inspired_by',
      typeLabel: 'Inspired-by home recipe',
      restaurantId: 'restaurant-1',
      servings: 2,
      estMinutes: 20,
      ingredients: [{ name: 'beans', quantity: '1', unit: 'cup' }],
      steps: [{ order: 1, text: 'Simmer.' }],
      substitutions: [],
      dietaryTags: [],
      description: null,
      sourceUrl: null,
      sourceName: null,
      sourceKind: null,
      provenanceLabel: null,
      retrievedAtLabel: null,
      paraphraseLine: null,
      rightsBasis: null,
      checkedAtLabel: 'Nov 1, 2026',
      version: 1,
      isDemo: false,
      demoLabel: null,
      uncertaintyLine: null,
      dietaryWarning: null,
      saved: false,
    };
    const note = 'Wander through Chestnut Square Village and let the meal settle. The night stays easy.';
    getOwnVisitProblem.mockResolvedValue({ ok: true, problem: null });
    const placed = await render(
      <AdventureTicket
        item={item()}
        cycleCreatedAt="2026-11-01T18:00:00.000Z"
        canSwap={false}
        swapsRemaining={1}
        isSwapping={false}
        isRedeeming={false}
        onSwap={() => undefined}
        onRedeem={() => undefined}
        visitProblems
        recipes={[recipe]}
        activityNotesMode
        activityNote={note}
      />,
    );
    const placedText = placed.textContent ?? '';
    expect(placedText.indexOf(RECIPES_SECTION_HEADING)).toBeLessThan(placedText.indexOf(ACTIVITY_NOTE_HEADING));
    expect(placedText.indexOf(ACTIVITY_NOTE_HEADING)).toBeLessThan(placedText.indexOf('Report it here'));
    const ticketStack = [...(placed.querySelector('article')?.children ?? [])].find((node) =>
      node.classList.contains('flex-col'),
    );
    expect(ticketStack?.lastElementChild?.getAttribute('data-visit-problem')).toBe('');
    expect(ticketStack?.lastElementChild?.className).toContain('border-t');
    expect(ticketStack?.lastElementChild?.className).toContain('border-[#e3d9c6]');

    const card = await render(
      <RestaurantCard
        item={item()}
        cycleCreatedAt="2026-11-01T18:00:00.000Z"
        canSwap={false}
        isSwapping={false}
        isRedeeming={false}
        onSwap={() => undefined}
        onRedeem={() => undefined}
        visitProblems
        recipes={[recipe]}
        activityNotesMode
        activityNote={note}
      />,
    );
    const cardText = card.textContent ?? '';
    expect(cardText.indexOf(RECIPES_SECTION_HEADING)).toBeLessThan(cardText.indexOf(ACTIVITY_NOTE_HEADING));
    expect(cardText.indexOf(ACTIVITY_NOTE_HEADING)).toBeLessThan(cardText.indexOf('Report it here'));
    expect(card.querySelector('[data-slot="card"]')?.lastElementChild?.getAttribute('data-visit-problem')).toBe('');
  });
});
