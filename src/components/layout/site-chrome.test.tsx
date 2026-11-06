import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({
  signedIn: false,
  loading: false,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/hooks/use-supabase-user', () => ({
  useSupabaseUser: () => session,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signOut: vi.fn() } }),
}));

import { Footer } from '@/components/layout/Footer';
import { MobileNav } from '@/components/layout/MobileNav';
import { Navbar } from '@/components/layout/Navbar';

let pathname = '/';
let search = '';

const PUBLIC_LINKS = [
  ['Home', '/'],
  ['How it Works', '/how-it-works'],
  ['Discover', '/roulette'],
  ['Restaurants', '/restaurants'],
  ['Pricing', '/pricing'],
] as const;

const MEMBER_LINKS = [
  ['Discover', '/roulette'],
  ['Restaurants', '/restaurants'],
  ['Challenges', '/challenges'],
  ['Progress', '/journey'],
  ['Journal', '/journal'],
  ['Passport', '/journey?view=passport'],
] as const;

const FOOTER_LINKS = [
  ['How it Works', '/#how-it-works'],
  ['Restaurants', '/restaurants'],
  ['Pricing', '/pricing'],
  ['Terms of Service', '/terms'],
  ['Privacy Policy', '/privacy'],
  ['Rules', '/rules'],
  ['Contact', '/contact'],
] as const;

function hrefs(names: readonly (readonly [string, string])[]) {
  return names.map(([name, href]) => {
    const link = screen.getByRole('link', { name });
    expect(link.getAttribute('href')).toBe(href);
    return link;
  });
}

function linear(channel: number) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string) {
  const channels = [0, 1, 2].map((index) => parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16));
  return 0.2126 * linear(channels[0]) + 0.7152 * linear(channels[1]) + 0.0722 * linear(channels[2]);
}

function contrast(foreground: string, background: string) {
  const hi = Math.max(luminance(foreground), luminance(background));
  const lo = Math.min(luminance(foreground), luminance(background));
  return (hi + 0.05) / (lo + 0.05);
}

function mix(top: string, bottom: string, alpha: number) {
  const channel = (index: number) => {
    const start = 1 + index * 2;
    const fg = parseInt(top.slice(start, start + 2), 16);
    const bg = parseInt(bottom.slice(start, start + 2), 16);
    return Math.round(fg * alpha + bg * (1 - alpha));
  };
  return `#${[0, 1, 2].map((index) => channel(index).toString(16).padStart(2, '0')).join('')}`;
}

function token(css: string, name: string) {
  const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match?.[1]) throw new Error(`missing ${name}`);
  return match[1].toLowerCase();
}

describe('site header and footer', () => {
  beforeEach(() => {
    pathname = '/';
    search = '';
    session.signedIn = false;
    session.loading = false;
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps the signed-out desktop links, order, and xl row', () => {
    const view = render(<Navbar />);
    expect(view.container.querySelector('header')?.className).toContain('xl:flex');
    expect(view.container.querySelector('header')?.className).toContain('absolute');
    expect(screen.getByRole('link', { name: 'Wanderbite' }).getAttribute('href')).toBe('/');
    hrefs(PUBLIC_LINKS);
    expect(screen.getByRole('link', { name: 'Sign In' }).getAttribute('href')).toBe('/signin');
    expect(screen.getByRole('link', { name: 'Start Your Adventure' }).getAttribute('href')).toBe('/signup');
    expect(screen.queryByRole('link', { name: 'Challenges' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Account menu' })).toBeNull();
    const names = screen.getAllByRole('link').map((link) => link.textContent?.replace(/\s+/g, ' ').trim());
    expect(names).toEqual([
      'Wanderbite',
      'Home',
      'How it Works',
      'Discover',
      'Restaurants',
      'Pricing',
      'Sign In',
      'Start Your Adventure',
    ]);
  });

  it('uses a sticky night bar on a light page and marks the active link', () => {
    pathname = '/restaurants';
    const view = render(<Navbar />);
    const header = view.container.querySelector('header');
    expect(header?.className).toContain('sticky');
    expect(header?.className).toContain('bg-wb-night');
    expect(header?.className).not.toContain('absolute');
    expect(screen.getByRole('link', { name: 'Restaurants' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('aria-current')).toBeNull();
  });

  it('marks Progress, Journal, and Passport apart when they share /journey', () => {
    session.signedIn = true;
    pathname = '/journey';
    search = '';
    const view = render(<Navbar />);
    expect(screen.getByRole('link', { name: 'Progress' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Journal' }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('link', { name: 'Passport' }).getAttribute('aria-current')).toBeNull();

    search = 'view=passport';
    view.rerender(<Navbar />);
    expect(screen.getByRole('link', { name: 'Passport' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Progress' }).getAttribute('aria-current')).toBeNull();

    search = 'view=map';
    view.rerender(<Navbar />);
    expect(screen.getByRole('link', { name: 'Passport' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Journal' }).getAttribute('aria-current')).toBeNull();

    search = 'view=journal';
    view.rerender(<Navbar />);
    expect(screen.getByRole('link', { name: 'Journal' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Progress' }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('link', { name: 'Passport' }).getAttribute('aria-current')).toBeNull();

    pathname = '/journal/notes/abc';
    search = '';
    view.rerender(<Navbar />);
    expect(screen.getByRole('link', { name: 'Journal' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Passport' }).getAttribute('aria-current')).toBeNull();

    pathname = '/passport';
    view.rerender(<Navbar />);
    expect(screen.getByRole('link', { name: 'Passport' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Progress' }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('link', { name: 'Journal' }).getAttribute('aria-current')).toBeNull();
  });

  it('marks Journal in the hamburger and leaves Passport dark', () => {
    session.signedIn = true;
    pathname = '/journal';
    render(<MobileNav />);
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const menu = screen.getByRole('dialog', { name: 'Menu' });
    expect(within(menu).getByRole('link', { name: 'Journal' }).getAttribute('aria-current')).toBe('page');
    expect(within(menu).getByRole('link', { name: 'Passport' }).getAttribute('aria-current')).toBeNull();
    expect(within(menu).getByRole('link', { name: 'Progress' }).getAttribute('aria-current')).toBeNull();
  });

  it('keeps the signed-in desktop links and the same account actions', () => {
    session.signedIn = true;
    pathname = '/challenges';
    render(<Navbar />);
    hrefs(MEMBER_LINKS);
    expect(screen.queryByRole('link', { name: 'Sign In' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Start Your Adventure' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Home' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(screen.getByRole('link', { name: 'Account' }).getAttribute('href')).toBe('/account');
    expect(screen.getByRole('link', { name: 'Billing' }).getAttribute('href')).toBe('/billing');
    expect(screen.getByRole('link', { name: 'Suggest a Restaurant' }).getAttribute('href')).toBe('/suggest');
    expect(screen.getByRole('menuitem', { name: 'Sign Out' })).toBeTruthy();
  });

  it('opens the same signed-out menu from the toggle, traps tab, and returns focus on Escape', () => {
    render(<MobileNav />);
    const header = document.querySelector('header');
    expect(header?.className).toContain('xl:hidden');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const menu = screen.getByRole('dialog', { name: 'Menu' });
    expect(menu.className).toContain('wb-nav-menu');
    hrefs(PUBLIC_LINKS);
    expect(within(menu).getByRole('link', { name: 'Sign In' }).getAttribute('href')).toBe('/signin');
    expect(within(menu).queryByRole('link', { name: 'Start Your Adventure' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Start Your Adventure' }).getAttribute('href')).toBe('/signup');

    const home = within(menu).getByRole('link', { name: 'Home' });
    home.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(home);

    const signIn = within(menu).getByRole('link', { name: 'Sign In' });
    signIn.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    const toggle = screen.getByRole('button', { name: 'Close menu' });
    expect(document.activeElement).toBe(toggle);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(signIn);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open menu' }));
  });

  it('lists the same signed-in menu actions and does not offer sign-in', () => {
    session.signedIn = true;
    render(<MobileNav />);
    expect(screen.queryByRole('link', { name: 'Sign In' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Start Your Adventure' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    hrefs(MEMBER_LINKS);
    expect(screen.getByRole('button', { name: 'Sign Out' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Sign In' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Sign up' })).toBeNull();
  });

  it('keeps the #98 breakpoint, content offset, and session re-read', () => {
    const root = process.cwd();
    const navbar = readFileSync(path.join(root, 'src/components/layout/Navbar.tsx'), 'utf8');
    const mobile = readFileSync(path.join(root, 'src/components/layout/MobileNav.tsx'), 'utf8');
    const site = readFileSync(path.join(root, 'src/app/(site)/layout.tsx'), 'utf8');
    const account = readFileSync(path.join(root, 'src/app/account/layout.tsx'), 'utf8');
    const hook = readFileSync(path.join(root, 'src/hooks/use-supabase-user.ts'), 'utf8');
    expect(navbar).toContain('xl:flex');
    expect(navbar).not.toContain('lg:flex');
    expect(mobile).toContain('xl:hidden');
    expect(mobile).not.toContain('document.body');
    expect(site).toContain('pt-14 xl:pt-0');
    expect(account).toContain('pt-14 xl:pt-0');
    expect(hook).toContain('getUser()');
    expect(hook).toContain('[pathname]');
  });

  it('keeps footer link groups and swaps auth actions with the session', () => {
    const signedOut = render(<Footer />);
    for (const [name, href] of FOOTER_LINKS) {
      expect(signedOut.getByRole('link', { name }).getAttribute('href')).toBe(href);
    }
    expect(signedOut.getByRole('link', { name: 'Sign up' }).getAttribute('href')).toBe('/signup');
    expect(signedOut.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/signin');
    expect(signedOut.queryByRole('button', { name: 'Sign Out' })).toBeNull();
    expect(signedOut.container.textContent).not.toContain('wanderbite.com');

    session.signedIn = true;
    signedOut.rerender(<Footer />);
    expect(screen.getByRole('link', { name: 'Account' }).getAttribute('href')).toBe('/account');
    expect(screen.getByRole('link', { name: 'Billing' }).getAttribute('href')).toBe('/billing');
    expect(screen.getByRole('link', { name: 'Suggest a Restaurant' }).getAttribute('href')).toBe('/suggest');
    expect(screen.getByRole('button', { name: 'Sign Out' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Sign up' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
  });

  it('keeps menu motion off and link text on night above WCAG AA', () => {
    const root = process.cwd();
    const css = readFileSync(path.join(root, 'src/app/styles/wanderbite-theme.css'), 'utf8');
    const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.wb-nav-menu');
    expect(reduced).toContain('animation: none');
    expect(reduced).toContain('transition: none');
    expect(css).toContain('background: linear-gradient(135deg, var(--wb-violet) 0%, var(--wb-pink) 100%)');

    const night = token(css, '--wb-night');
    const night2 = token(css, '--wb-night-2');
    const cream = token(css, '--wb-cream');
    const lavender = token(css, '--wb-lavender-2');
    const blush = token(css, '--wb-blush');
    const violet = token(css, '--wb-violet');
    const pink = token(css, '--wb-pink');
    const page = token(readFileSync(path.join(root, 'src/app/globals.css'), 'utf8'), '--background');
    expect(contrast('#ffffff', night)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(cream, night)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(lavender, night)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(blush, night)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(night2, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffffff', violet)).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffffff', pink)).toBeGreaterThanOrEqual(4.5);
    const menuOnPage = mix(night, page, 0.98);
    expect(contrast('#ffffff', menuOnPage)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(cream, menuOnPage)).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffffff', mix('#ffffff', night, 0.16))).toBeGreaterThanOrEqual(4.5);
  });
});
