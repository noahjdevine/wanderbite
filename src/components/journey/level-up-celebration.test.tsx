import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LevelUpCelebration } from '@/components/journey/level-up-celebration';
import { levelUpSeenKey } from '@/lib/progression/level-up-seen';
import type { MemberProgressionMilestone } from '@/lib/progression/read-model';

const confetti = vi.hoisted(() => vi.fn());

vi.mock('canvas-confetti', () => ({
  default: (...args: unknown[]) => confetti(...args),
}));

function milestone(level: number, name: string): MemberProgressionMilestone {
  return {
    id: `m${level}`,
    level,
    name,
    reachedAt: '2026-11-14T18:00:00.000Z',
    quarterKey: '2026-Q4',
    hasEntry: false,
  };
}

const explorer = milestone(1, 'The Explorer');
const tastemaker = milestone(2, 'The Tastemaker');

function setReducedMotion(reduced: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

beforeEach(() => {
  confetti.mockReset();
  localStorage.clear();
  setReducedMotion(false);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('level-up celebration', () => {
  it('shows an unseen milestone when the flag is on and stays closed when it is off', async () => {
    const { rerender } = render(
      <LevelUpCelebration enabled={false} milestones={[explorer]} />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();

    rerender(<LevelUpCelebration enabled milestones={[explorer]} />);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.textContent).toContain('The Explorer');
    expect(dialog.textContent).toContain('Level 1');
    expect(dialog.textContent).toContain('Nice work. That’s a new level on your journey.');
    expect(screen.getByRole('button', { name: 'Got it' })).toBeTruthy();
    await waitFor(() => {
      expect(confetti).toHaveBeenCalled();
    });
  });

  it('marks every unseen milestone seen and does not show again after dismiss', async () => {
    function Harness({ open }: { open: boolean }) {
      return (
        <>
          <button type="button">Before</button>
          <LevelUpCelebration enabled={open} milestones={open ? [explorer, tastemaker] : []} />
        </>
      );
    }
    const { rerender } = render(<Harness open={false} />);
    screen.getByRole('button', { name: 'Before' }).focus();
    rerender(<Harness open />);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('The Tastemaker');
    expect(dialog.textContent).not.toContain('The Explorer');
    const dismiss = screen.getByRole('button', { name: 'Got it' });
    await waitFor(() => {
      expect(document.activeElement).toBe(dismiss);
    });

    fireEvent.click(dismiss);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem(levelUpSeenKey('m1'))).toBe('1');
    expect(localStorage.getItem(levelUpSeenKey('m2'))).toBe('1');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Before' }));

    rerender(
      <>
        <button type="button">Before</button>
        <LevelUpCelebration enabled milestones={[explorer, tastemaker]} />
      </>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Escape', async () => {
    render(<LevelUpCelebration enabled milestones={[explorer]} />);
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem(levelUpSeenKey('m1'))).toBe('1');
  });

  it('renders the static dialog and does not call confetti when motion is reduced', async () => {
    setReducedMotion(true);
    render(<LevelUpCelebration enabled milestones={[explorer]} />);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('data-motion')).toBe('static');
    expect(dialog.textContent).toContain('The Explorer');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(confetti).not.toHaveBeenCalled();
  });

  it('stays closed when localStorage throws', async () => {
    const original = window.localStorage;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem() {
          throw new Error('private');
        },
        setItem() {
          throw new Error('private');
        },
        removeItem() {
          throw new Error('private');
        },
      },
    });
    try {
      render(<LevelUpCelebration enabled milestones={[explorer]} />);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(confetti).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'localStorage', { configurable: true, value: original });
    }
  });
});
