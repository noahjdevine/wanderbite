import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState, type ReactNode } from 'react';

const session = vi.hoisted(() => ({
  signedIn: false,
  loading: false,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a data-next-link="" href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/hooks/use-supabase-user', () => ({
  useSupabaseUser: () => session,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signOut: vi.fn() } }),
}));

import AccountLayout from '@/app/account/layout';
import SiteLayout from '@/app/(site)/layout';
import { MEMBER_TAB_NAV_LABEL } from '@/components/layout/member-tab-bar';

let pathname = '/challenges';
let search = '';

const TAB_HREFS = ['/roulette', '/challenges', '/journey', '/journey?view=passport'] as const;

function memberNav() {
  return screen.queryByRole('navigation', { name: MEMBER_TAB_NAV_LABEL });
}

describe('member tab bar layout', () => {
  beforeEach(() => {
    pathname = '/challenges';
    search = '';
    session.signedIn = false;
    session.loading = false;
    document.documentElement.classList.remove('wb-member-tabbar-on');
  });

  afterEach(() => {
    cleanup();
    document.documentElement.classList.remove('wb-member-tabbar-on');
  });

  it('renders the bar for a signed-in member and marks exactly one tab', () => {
    session.signedIn = true;
    render(
      <SiteLayout>
        <p>Challenges body</p>
      </SiteLayout>,
    );

    const nav = screen.getByRole('navigation', { name: MEMBER_TAB_NAV_LABEL });
    expect(nav.className).toContain('wb-member-tabbar');
    expect(document.querySelector('.wb-member-tabbar-pad')).toBeTruthy();
    expect(document.documentElement.classList.contains('wb-member-tabbar-on')).toBe(true);

    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Discover', 'Challenges', 'Progress', 'Passport']);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([...TAB_HREFS]);
    expect(links.every((link) => link.dataset.nextLink != null)).toBe(true);
    expect(links.every((link) => link.tabIndex >= 0)).toBe(true);

    const current = links.filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toBe('Challenges');

    const names = screen.getAllByRole('navigation').map((node) => node.getAttribute('aria-label'));
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('Main');
    expect(names).toContain('Member');
    expect(names.filter((name) => name === 'Main')).toHaveLength(1);
    expect(names.filter((name) => name === 'Member')).toHaveLength(1);
  });

  it('lights Passport on Timeline and Map, and Progress on a journey sub-route', () => {
    session.signedIn = true;
    pathname = '/journey';
    search = 'view=journal';
    const view = render(
      <SiteLayout>
        <p>Timeline</p>
      </SiteLayout>,
    );
    let nav = screen.getByRole('navigation', { name: MEMBER_TAB_NAV_LABEL });
    expect(within(nav).getByRole('link', { name: 'Passport' }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Progress' }).getAttribute('aria-current')).toBeNull();

    search = 'view=map';
    view.rerender(
      <SiteLayout>
        <p>Map</p>
      </SiteLayout>,
    );
    nav = screen.getByRole('navigation', { name: MEMBER_TAB_NAV_LABEL });
    expect(within(nav).getByRole('link', { name: 'Passport' }).getAttribute('aria-current')).toBe('page');

    pathname = '/journey/saved';
    search = '';
    view.rerender(
      <SiteLayout>
        <p>Saved</p>
      </SiteLayout>,
    );
    nav = screen.getByRole('navigation', { name: MEMBER_TAB_NAV_LABEL });
    const current = within(nav)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toBe('Progress');
  });

  it('does not render for signed-out visitors or excluded routes', () => {
    render(
      <SiteLayout>
        <p>Home</p>
      </SiteLayout>,
    );
    expect(memberNav()).toBeNull();
    expect(document.querySelector('.wb-member-tabbar-slot')).toBeTruthy();
    expect(document.querySelector('.wb-member-tabbar-pad')).toBeNull();

    session.signedIn = true;
    for (const path of ['/signin', '/signup', '/onboarding', '/partner/yard', '/admin', '/contact', '/privacy', '/terms', '/rules', '/challenges/show/red-1']) {
      pathname = path;
      const view = render(
        <SiteLayout>
          <p>{path}</p>
        </SiteLayout>,
      );
      expect(memberNav()).toBeNull();
      view.unmount();
    }
  });

  it('keeps a stateful page mounted when the session becomes signed in', () => {
    pathname = '/roulette';
    session.signedIn = false;
    let mounts = 0;

    function StatefulChild() {
      const [mountId] = useState(() => {
        mounts += 1;
        return mounts;
      });
      const [draft, setDraft] = useState('start');
      return (
        <label>
          Draft
          <input
            aria-label="Draft"
            data-mounts={mountId}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
      );
    }

    const view = render(
      <SiteLayout>
        <StatefulChild />
      </SiteLayout>,
    );
    const slot = document.querySelector('.wb-member-tabbar-slot');
    expect(slot).toBeTruthy();
    expect(slot?.className).not.toContain('wb-member-tabbar-pad');
    fireEvent.change(screen.getByRole('textbox', { name: 'Draft' }), { target: { value: 'tacos' } });

    session.signedIn = true;
    view.rerender(
      <SiteLayout>
        <StatefulChild />
      </SiteLayout>,
    );

    const input = screen.getByRole('textbox', { name: 'Draft' });
    expect(input.getAttribute('data-mounts')).toBe('1');
    expect(mounts).toBe(1);
    expect((input as HTMLInputElement).value).toBe('tacos');
    expect(document.querySelector('.wb-member-tabbar-slot')).toBe(slot);
    expect(slot?.className).toContain('wb-member-tabbar-pad');
    expect(memberNav()).toBeTruthy();
  });

  it('mounts the same bar on the account layout and stays out of excluded layouts', () => {
    session.signedIn = true;
    pathname = '/account';
    render(
      <AccountLayout>
        <p>Account</p>
      </AccountLayout>,
    );
    const nav = screen.getByRole('navigation', { name: MEMBER_TAB_NAV_LABEL });
    const current = within(nav)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(0);

    const root = process.cwd();
    for (const file of ['src/app/partner/layout.tsx', 'src/app/onboarding/layout.tsx', 'src/app/checkout/layout.tsx']) {
      expect(readFileSync(path.join(root, file), 'utf8')).not.toContain('MemberTabBarSlot');
    }
    const css = readFileSync(path.join(root, 'src/app/styles/wanderbite-theme.css'), 'utf8');
    expect(css).toContain('.wb-tabbar > a:focus-visible');
    expect(css).toContain('outline: 2px solid var(--wb-blush)');
    expect(css).toContain('min-width: 44px');
    expect(css).toContain('@media (width >= 80rem)');
    expect(css).toContain('.wb-member-tabbar {\n    display: none;');
    expect(css).toContain('env(safe-area-inset-bottom, 0px)');
    const tabAt = css.indexOf('.wb-tabbar,');
    const tabMotion = css.slice(tabAt - 80, tabAt + 220);
    expect(tabMotion).toContain('prefers-reduced-motion: reduce');
    expect(tabMotion).toContain('animation: none');
  });
});
