import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  JournalPending,
  JourneyPending,
  PassportPending,
  ProgressPending,
} from '@/components/layout/member-surface-pending';

const search = vi.hoisted(() => ({ value: '' }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/journey',
  useSearchParams: () => new URLSearchParams(search.value),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

describe('member surface pending shells', () => {
  afterEach(() => {
    cleanup();
    search.value = '';
  });

  it('paints Progress without the passport cover or a Journal title', () => {
    render(<ProgressPending />);
    expect(document.querySelector('[data-surface="progress"]')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Loading Progress');
    expect(screen.queryByRole('radiogroup', { name: 'Passport views' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Journal' })).toBeNull();
    expect(screen.queryByText('Timeline')).toBeNull();
  });

  it('paints Journal as Journal and not the passport cover', () => {
    render(<JournalPending />);
    expect(document.querySelector('[data-surface="journal"]')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Journal' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Loading Journal');
    expect(screen.queryByRole('radiogroup', { name: 'Passport views' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Share My Passport' })).toBeNull();
    expect(screen.queryByText('Timeline')).toBeNull();
    expect(screen.queryByText(/Your Passport|Passport/)).toBeNull();
  });

  it('paints the passport cover for stamps and map without zero counts', () => {
    const stamps = render(<PassportPending segment="stamps" />);
    expect(document.querySelector('[data-surface="passport"]')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Loading Passport');
    expect(screen.getByRole('radio', { name: 'Passport' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Map' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('radio', { name: 'Timeline' })).toBeNull();
    expect(screen.queryByText('0 visits')).toBeNull();
    expect(document.querySelector('.wb-map-frame')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Share My Passport' })).toBeNull();
    stamps.unmount();

    render(<PassportPending segment="map" />);
    expect(screen.getByRole('radio', { name: 'Map' }).getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('.wb-map-frame')).toBeTruthy();
  });

  it('follows the journey URL so Journal does not use the passport shell', () => {
    search.value = 'view=journal';
    const journal = render(<JourneyPending />);
    expect(document.querySelector('[data-surface="journal"]')).toBeTruthy();
    expect(screen.queryByRole('radiogroup', { name: 'Passport views' })).toBeNull();
    journal.unmount();

    search.value = 'view=passport';
    const passport = render(<JourneyPending />);
    expect(document.querySelector('[data-surface="passport"]')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Passport' }).getAttribute('aria-checked')).toBe('true');
    passport.unmount();

    search.value = 'view=map';
    render(<JourneyPending />);
    expect(screen.getByRole('radio', { name: 'Map' }).getAttribute('aria-checked')).toBe('true');
  });
});
