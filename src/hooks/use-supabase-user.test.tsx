import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.fn();
const unsubscribe = vi.fn();
const onAuthStateChange = vi.fn(() => ({
  data: { subscription: { unsubscribe } },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser, onAuthStateChange },
  }),
}));

import { useSupabaseUser } from '@/hooks/use-supabase-user';

let pathname = '/signin';

function Probe() {
  const { signedIn, loading } = useSupabaseUser();
  return <div data-signed-in={signedIn ? 'yes' : 'no'} data-loading={loading ? 'yes' : 'no'} />;
}

describe('useSupabaseUser', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    pathname = '/signin';
    document.cookie = 'sb-example-auth-token=; max-age=0';
    getUser.mockReset();
    onAuthStateChange.mockClear();
    unsubscribe.mockClear();
    getUser.mockResolvedValue({ data: { user: null } });
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

  it('shows the signed-in nav on the first render after sign-in, then confirms with getUser', async () => {
    const first = await render(<Probe />);
    expect(first.firstElementChild?.getAttribute('data-signed-in')).toBe('no');
    expect(getUser).toHaveBeenCalledTimes(1);

    pathname = '/challenges';
    document.cookie = 'sb-example-auth-token.0=session';
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    await act(async () => {
      root.render(<Probe />);
    });

    expect(container.firstElementChild?.getAttribute('data-signed-in')).toBe('yes');
    expect(container.firstElementChild?.getAttribute('data-loading')).toBe('no');
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  it('does not treat a PKCE verifier cookie as a session', async () => {
    pathname = '/pricing';
    document.cookie = 'sb-example-auth-token-code-verifier=verifier';
    await render(<Probe />);
    expect(container.firstElementChild?.getAttribute('data-signed-in')).toBe('no');
  });
});
