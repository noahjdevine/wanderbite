import type { LucideIcon } from 'lucide-react';
import {
  Dices,
  Home,
  HelpCircle,
  UtensilsCrossed,
  CreditCard,
  Target,
  Map,
} from 'lucide-react';

export type NavItem = {
  href: string;
  label: string;
  icon?: LucideIcon;
  /** Shown when `label` is shortened on mobile. */
  ariaLabel?: string;
  /** Optional extra paths that mark this item active (e.g. hub sub-views). */
  activePaths?: readonly string[];
};

/** Resolve Wanderbite Roulette link (homepage anchor vs standalone page). */
export function resolveRouletteHref(pathname: string): string {
  return pathname === '/' ? '/#roulette' : '/roulette';
}

/** Public nav — identical on desktop and mobile when logged out. */
export const PUBLIC_NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/how-it-works', label: 'How it Works', icon: HelpCircle },
  {
    href: '/roulette',
    label: 'Wanderbite Roulette',
    icon: Dices,
    ariaLabel: 'Wanderbite Roulette',
  },
  { href: '/restaurants', label: 'Restaurants', icon: UtensilsCrossed },
  { href: '/pricing', label: 'Pricing', icon: CreditCard },
];

/** Member nav — replaces public nav entirely when logged in. */
export const MEMBER_NAV_ITEMS: NavItem[] = [
  {
    href: '/roulette',
    label: 'Wanderbite Roulette',
    icon: Dices,
    ariaLabel: 'Wanderbite Roulette',
  },
  { href: '/restaurants', label: 'Restaurants', icon: UtensilsCrossed },
  { href: '/challenges', label: 'Challenges', icon: Target },
  {
    href: '/journey',
    label: 'My Journey',
    icon: Map,
    activePaths: ['/journey', '/journal', '/passport'],
  },
];

export function resolveNavHref(item: NavItem, pathname: string): string {
  if (item.href === '/roulette') {
    return resolveRouletteHref(pathname);
  }
  return item.href;
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.activePaths?.length) {
    return item.activePaths.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`)
    );
  }
  const href = item.href === '/roulette' ? '/roulette' : item.href;
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
