import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

import { HomeHeroPrompt } from '@/components/landing/home-hero-prompt';

const RUN = /^\/roulette\?q=([^&]+)&run=[0-9a-f-]{36}$/i;

function askField() {
  return screen.getByLabelText('What are you in the mood for?') as HTMLInputElement;
}

describe('HomeHeroPrompt', () => {
  beforeEach(() => {
    push.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('rotates dietary examples while the ask is empty', () => {
    render(<HomeHeroPrompt />);
    expect(screen.getByText('halal tacos near downtown…')).toBeTruthy();
    expect(screen.getByText('vegan brunch for 4…')).toBeTruthy();
    expect(screen.getByText('gluten-free date night…')).toBeTruthy();
    expect(askField().value).toBe('');
  });

  it('appends optional need chips and still submits once', () => {
    render(<HomeHeroPrompt />);
    fireEvent.change(askField(), { target: { value: 'tacos near downtown' } });
    const halal = screen.getByRole('button', { name: 'Halal' });
    const vegan = screen.getByRole('button', { name: 'Vegan' });
    expect(halal.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('Optional. Add a dietary or religious need.')).toBeTruthy();

    fireEvent.click(halal);
    expect(push).not.toHaveBeenCalled();
    expect(halal.getAttribute('aria-pressed')).toBe('true');
    expect(askField().value).toBe('tacos near downtown, Halal');
    expect(screen.queryByText('halal tacos near downtown…')).toBeNull();

    fireEvent.click(vegan);
    expect(askField().value).toBe('tacos near downtown, Halal, Vegan');
    expect(vegan.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(halal);
    expect(halal.getAttribute('aria-pressed')).toBe('false');
    expect(askField().value).toBe('tacos near downtown, Vegan');

    fireEvent.click(screen.getByRole('button', { name: 'Ask Bea' }));
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]?.[0]).toMatch(RUN);
    expect(decodeURIComponent(String(push.mock.calls[0]?.[0]).split('q=')[1]?.split('&')[0])).toBe(
      'tacos near downtown, Vegan',
    );
  });

  it('submits a typed ask once when no chip is used', () => {
    render(<HomeHeroPrompt />);
    fireEvent.change(askField(), { target: { value: 'spicy noodles' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask Bea' }));
    expect(push).toHaveBeenCalledTimes(1);
    expect(String(push.mock.calls[0]?.[0])).toContain('q=spicy%20noodles&run=');
  });

  it('submits a quick start once', () => {
    render(<HomeHeroPrompt />);
    fireEvent.click(screen.getByRole('link', { name: 'Date night' }));
    expect(push).toHaveBeenCalledTimes(1);
    expect(String(push.mock.calls[0]?.[0])).toContain('q=Date%20night&run=');
  });
});
