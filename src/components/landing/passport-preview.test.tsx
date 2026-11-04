import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PassportPreview } from '@/components/landing/passport-preview';
import { cuisineInk } from '@/lib/passport/passport-board';

describe('PassportPreview', () => {
  afterEach(() => {
    cleanup();
  });

  it('labels the stamps as an example and reuses cuisine ink', () => {
    render(<PassportPreview />);
    expect(screen.getByText(/example only/i).textContent).toMatch(/not a member/i);
    const kitchen = screen.getByRole('link', { name: /Example Kitchen/ });
    expect(kitchen.getAttribute('data-ink')).toBe(cuisineInk(['Pizza']).color);
    expect(screen.getByRole('link', { name: /Sample Counter/ }).getAttribute('data-ink')).toBe(
      cuisineInk(['Sushi']).color,
    );
    expect(screen.getByRole('link', { name: /Preview Table/ }).getAttribute('data-ink')).toBe(
      cuisineInk(['Tacos']).color,
    );
    expect(screen.getByRole('link', { name: 'Create a free account' }).getAttribute('href')).toBe(
      '/signup',
    );
    expect(document.body.textContent).not.toMatch(/Noah|@/);
  });
});
