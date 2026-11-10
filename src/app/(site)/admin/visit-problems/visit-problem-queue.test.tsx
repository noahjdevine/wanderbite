import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VisitProblemQueue } from '@/app/(site)/admin/visit-problems/visit-problem-queue';
import type { AdminVisitProblem } from '@/lib/boost/visit-problem';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/app/(site)/admin/visit-problem-actions', () => ({
  reviewVisitProblem: vi.fn(),
  correctVisitSavings: vi.fn(),
  restoreVisitOpportunity: vi.fn(),
}));

function item(overrides: Partial<AdminVisitProblem>): AdminVisitProblem {
  return {
    id: 'case-1',
    userId: 'member-1',
    email: 'member@example.com',
    restaurantName: 'Test Grill',
    challengeItemId: 'item-1',
    redemptionId: null,
    category: 'other',
    categoryLabel: 'Other visit issue',
    explanation: 'Something else went wrong.',
    status: 'submitted',
    statusLabel: 'Submitted',
    response: null,
    createdAt: '2026-11-09T01:00:00.000Z',
    latestReason: null,
    savingsCorrectionCents: null,
    makeupGranted: false,
    ...overrides,
  };
}

describe('visit problem correction controls', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows the fix each category allows and hides both after the case is resolved', () => {
    render(
      <VisitProblemQueue
        cases={[
          item({
            id: 'discount',
            category: 'wrong_discount',
            categoryLabel: 'Wrong discount',
            explanation: 'Discount case.',
          }),
          item({
            id: 'refused',
            category: 'offer_refused',
            categoryLabel: "Restaurant wouldn't honor offer",
            explanation: 'Refused case.',
          }),
          item({
            id: 'both',
            category: 'other',
            categoryLabel: 'Other visit issue',
            explanation: 'Other case.',
          }),
          item({
            id: 'closed',
            category: 'other',
            categoryLabel: 'Other visit issue',
            explanation: 'Closed case.',
            status: 'resolved',
            statusLabel: 'Resolved',
          }),
        ]}
      />,
    );

    const discount = screen.getByText('Discount case.').closest('li');
    const refused = screen.getByText('Refused case.').closest('li');
    const both = screen.getByText('Other case.').closest('li');
    const closed = screen.getByText('Closed case.').closest('li');

    expect(discount?.textContent).toContain('Correct savings');
    expect(discount?.textContent).not.toContain('Grant make-up challenge');
    expect(refused?.textContent).toContain('Grant make-up challenge');
    expect(refused?.textContent).not.toContain('Correct savings');
    expect(both?.textContent).toContain('Correct savings');
    expect(both?.textContent).toContain('Grant make-up challenge');
    expect(closed?.textContent).not.toContain('Correct savings');
    expect(closed?.textContent).not.toContain('Grant make-up challenge');
  });

  it('shows a saved correction without offering it again', () => {
    render(
      <VisitProblemQueue
        cases={[
          item({
            category: 'other',
            savingsCorrectionCents: 2500,
            makeupGranted: true,
          }),
        ]}
      />,
    );
    expect(screen.getByText(/Savings corrected to \$25\.00/)).toBeTruthy();
    expect(screen.getByText(/Make-up challenge granted/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Correct savings' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Grant make-up challenge' })).toBeNull();
  });
});
