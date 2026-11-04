import { act, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Reveal } from '@/components/wb/reveal';

type Observer = {
  callback: IntersectionObserverCallback;
  disconnect: ReturnType<typeof vi.fn>;
  observe: ReturnType<typeof vi.fn>;
};

function mockMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query === '(prefers-reduced-motion: reduce)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  }));
}

function installObserver() {
  const observers: Observer[] = [];
  class IO {
    callback: IntersectionObserverCallback;
    disconnect = vi.fn();
    observe = vi.fn();
    unobserve = vi.fn();
    takeRecords = vi.fn(() => []);
    root = null;
    rootMargin = '';
    thresholds = [];
    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback;
      observers.push(this);
    }
  }
  vi.stubGlobal('IntersectionObserver', IO);
  return observers;
}

describe('Reveal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps server HTML visible before hydration', () => {
    const html = renderToString(
      <Reveal>
        <p>How it works</p>
      </Reveal>,
    );
    expect(html).toContain('How it works');
    expect(html).toContain('data-reveal="pending"');
    expect(html).not.toContain('opacity-0');
  });

  it('stays visible immediately when reduced motion is requested', () => {
    const observers = installObserver();
    mockMotion(true);
    render(
      <Reveal>
        <p>Visible</p>
      </Reveal>,
    );
    const root = screen.getByText('Visible').parentElement;
    expect(root?.getAttribute('data-reveal')).toBe('pending');
    expect(root?.className ?? '').not.toContain('opacity-0');
    expect(root?.className ?? '').not.toContain('transition');
    expect(root?.textContent).toContain('Visible');
    expect(observers).toHaveLength(0);
  });

  it('hides until the first intersection, then reveals once and disconnects', () => {
    mockMotion(false);
    const observers = installObserver();
    render(
      <Reveal>
        <p>Section</p>
      </Reveal>,
    );
    const root = screen.getByText('Section').parentElement;
    expect(root?.getAttribute('data-reveal')).toBe('pending');
    expect(root?.className ?? '').not.toContain('opacity-0');
    expect(root?.textContent).toContain('Section');

    const io = observers[0];
    expect(io).toBeTruthy();
    act(() => {
      io.callback(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        io as unknown as IntersectionObserver,
      );
    });
    expect(root?.getAttribute('data-reveal')).toBe('hidden');
    expect(root?.className).toContain('opacity-0');
    expect(root?.className).toContain('translate-y-[12px]');
    expect(root?.textContent).toContain('Section');
    expect(io.disconnect).not.toHaveBeenCalled();

    act(() => {
      io.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        io as unknown as IntersectionObserver,
      );
    });
    expect(root?.getAttribute('data-reveal')).toBe('shown');
    expect(root?.className ?? '').not.toContain('opacity-0');
    expect(io.disconnect).toHaveBeenCalledTimes(1);

    act(() => {
      io.callback(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        io as unknown as IntersectionObserver,
      );
    });
    expect(root?.getAttribute('data-reveal')).toBe('shown');
    expect(io.disconnect).toHaveBeenCalledTimes(1);
  });
});
