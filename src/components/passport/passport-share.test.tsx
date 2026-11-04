import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const shareOrCopy = vi.hoisted(() => vi.fn(async () => 'copied' as const));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/share', () => ({
  shareOrCopy,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('react-map-gl/maplibre', () => ({
  default: () => null,
  Marker: () => null,
  NavigationControl: () => null,
  Popup: () => null,
}));

import { PassportClient } from '@/components/passport/passport-client';

describe('Share My Passport', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    shareOrCopy.mockClear();
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

  it('shares a wanderbite.co link and singular counts', async () => {
    const view = await render(
      <PassportClient
        userDisplayName="Noah"
        visits={[]}
        ratingsByRestaurantId={{}}
        biteNotesByRestaurantId={{}}
        currentStreak={1}
        longestStreak={1}
        totalMonthsActive={1}
        uniqueRestaurants={1}
        neighborhoods={1}
        earnedBadges={[]}
        showFirstBiteLocked={false}
      />,
    );
    const button = [...view.querySelectorAll('button')].find((node) =>
      node.textContent?.includes('Share My Passport'),
    );
    expect(button).toBeTruthy();
    await act(async () => {
      button?.click();
    });
    expect(shareOrCopy).toHaveBeenCalledWith({
      title: 'My Wanderbite Food Passport',
      text: "I've explored 1 restaurant across 1 neighborhood with Wanderbite 🍽️🔥 1 month streak and counting.",
      url: 'https://wanderbite.co',
    });
    expect(view.textContent).toContain('1 restaurant');
    expect(view.textContent).toContain('1 neighborhood');
    expect(view.textContent).not.toContain('1 restaurants');
  });
});
