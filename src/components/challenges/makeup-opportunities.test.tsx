import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MakeupOpportunities } from '@/components/challenges/makeup-opportunities';

describe('make-up challenge spots', () => {
  it('explains one extra visit and leaves an empty list blank', () => {
    const { container } = render(
      <MakeupOpportunities spots={[{ id: 'spot-1', restaurantName: 'Test Grill' }]} />,
    );
    expect(screen.getByRole('heading', { name: 'Make-up challenge' })).toBeTruthy();
    expect(container.textContent).toContain('One extra visit is ready');
    expect(container.textContent).toContain('review of Test Grill');
    expect(container.textContent).toContain('original visit stays on your record');
    expect(container.textContent).toContain('does not add a credit');
  });

  it('renders nothing when there is no spot', () => {
    const { container } = render(<MakeupOpportunities spots={[]} />);
    expect(container.textContent).toBe('');
  });
});
