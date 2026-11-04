import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({
  signedIn: false,
  loading: false,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/hooks/use-supabase-user', () => ({
  useSupabaseUser: () => session,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signOut: vi.fn() } }),
}));

import { Footer } from '@/components/layout/Footer';

describe('Footer auth links', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    session.signedIn = false;
    session.loading = false;
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

  it('shows account actions for a signed-in member', async () => {
    session.signedIn = true;
    const view = await render(<Footer />);
    const text = view.textContent ?? '';
    expect(text).toContain('Account');
    expect(text).toContain('Billing');
    expect(text).toContain('Suggest a Restaurant');
    expect(text).toContain('Sign Out');
    expect(text).not.toContain('Sign up');
    expect(text).not.toContain('Sign in');
    expect(view.querySelector('a[href="/account"]')).not.toBeNull();
    expect(view.querySelector('a[href="/signin"]')).toBeNull();
    expect(view.querySelector('a[href="/signup"]')).toBeNull();
  });

  it('shows Sign up and Sign in when signed out', async () => {
    const view = await render(<Footer />);
    const text = view.textContent ?? '';
    expect(text).toContain('Sign up');
    expect(text).toContain('Sign in');
    expect(text).not.toContain('Sign Out');
    expect(view.querySelector('a[href="/account"]')).toBeNull();
  });
});
