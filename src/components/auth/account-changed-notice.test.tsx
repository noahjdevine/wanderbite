import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAccountChanged } from '@/components/auth/account-changed-notice';
import { renderedAccountState } from '@/lib/auth/account-changed';

type Listener = (
  event: string,
  session: { user: { id: string } | null } | null,
) => void;

let listener: Listener | null = null;

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (callback: Listener) => {
        listener = callback;
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
    },
  }),
}));

function Probe({ userId }: { userId: string }) {
  const state = useAccountChanged(userId);
  if (state === 'pending') return <p>pending</p>;
  if (state === 'changed') return <p>changed</p>;
  return <form>preferences</form>;
}

describe('rendered account session', () => {
  it('treats a missing or different session as changed', () => {
    expect(renderedAccountState('user-1', null)).toBe('changed');
    expect(renderedAccountState('user-1', undefined)).toBe('changed');
    expect(renderedAccountState('user-1', 'user-2')).toBe('changed');
    expect(renderedAccountState('user-1', 'user-1')).toBe('ready');
  });
});

describe('useAccountChanged', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
    listener = null;
  });

  async function renderProbe() {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<Probe userId="user-1" />);
    });
  }

  it('hides the form until the browser confirms the rendered user', async () => {
    await renderProbe();
    expect(container?.textContent).toBe('pending');
    expect(container?.querySelector('form')).toBeNull();

    await act(async () => {
      listener?.('INITIAL_SESSION', { user: { id: 'user-1' } });
    });
    expect(container?.querySelector('form')).not.toBeNull();
  });

  it('shows the reload state when the initial session is missing or belongs to someone else', async () => {
    await renderProbe();
    await act(async () => {
      listener?.('INITIAL_SESSION', null);
    });
    expect(container?.textContent).toBe('changed');
    expect(container?.querySelector('form')).toBeNull();

    await act(async () => {
      listener?.('SIGNED_IN', { user: { id: 'user-2' } });
    });
    expect(container?.querySelector('form')).toBeNull();
  });
});
