import type { LucideIcon } from 'lucide-react';
import {
  BookOpen,
  Compass,
  CreditCard,
  HelpCircle,
  Home,
  Map,
  NotebookPen,
  Target,
  UtensilsCrossed,
} from 'lucide-react';

export type NavItem = {
  href: string;
  label: string;
  icon?: LucideIcon;
  /** Shown when `label` is shortened on mobile. */
  ariaLabel?: string;
  /**
   * Progress, Journal, and Passport share `/journey` and differ by `?view=`.
   * Set this so the active item follows the surface, not the pathname alone.
   */
  surface?: 'progress' | 'journal' | 'passport';
  /** Optional extra paths that mark this item active. */
  activePaths?: readonly string[];
};

/** Public nav — identical on desktop and mobile when logged out. */
export const PUBLIC_NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/how-it-works', label: 'How it Works', icon: HelpCircle },
  {
    href: '/roulette',
    label: 'Discover',
    icon: Compass,
    ariaLabel: 'Discover',
  },
  { href: '/restaurants', label: 'Restaurants', icon: UtensilsCrossed },
  { href: '/pricing', label: 'Pricing', icon: CreditCard },
];

/** Member nav — replaces public nav entirely when logged in. */
export const MEMBER_NAV_ITEMS: NavItem[] = [
  {
    href: '/roulette',
    label: 'Discover',
    icon: Compass,
    ariaLabel: 'Discover',
  },
  { href: '/restaurants', label: 'Restaurants', icon: UtensilsCrossed },
  { href: '/challenges', label: 'Challenges', icon: Target },
  {
    href: '/journey',
    label: 'Progress',
    icon: Map,
    surface: 'progress',
  },
  {
    href: '/journal',
    label: 'Journal',
    icon: NotebookPen,
    surface: 'journal',
  },
  {
    href: '/journey?view=passport',
    label: 'Passport',
    icon: BookOpen,
    surface: 'passport',
  },
];

export function resolveNavHref(item: NavItem): string {
  return item.href;
}

function normalizeNavPath(pathname: string): string {
  const path = pathname.split('?')[0]?.split('#')[0] ?? '/';
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path || '/';
}

function pathMatches(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function searchView(search: string): string | null {
  const query = search.startsWith('?') ? search.slice(1) : search;
  return new URLSearchParams(query).get('view');
}

/**
 * Progress is only the progress view of `/journey`.
 * Journal is `/journal` (including the note editor) and `/journey?view=journal`.
 * Passport is stamps and map, plus the legacy `/passport` path.
 */
export function isNavItemActive(item: NavItem, pathname: string, search = ''): boolean {
  const path = normalizeNavPath(pathname);
  const view = searchView(search);

  if (item.surface === 'journal') {
    if (pathMatches(path, '/journal')) return true;
    return path === '/journey' && view === 'journal';
  }

  if (item.surface === 'passport') {
    if (pathMatches(path, '/passport')) return true;
    return path === '/journey' && (view === 'passport' || view === 'map');
  }

  if (item.surface === 'progress') {
    if (pathMatches(path, '/journal') || pathMatches(path, '/passport')) return false;
    if (!pathMatches(path, '/journey')) return false;
    if (path === '/journey' && (view === 'journal' || view === 'passport' || view === 'map')) {
      return false;
    }
    return true;
  }

  if (item.activePaths?.length) {
    return item.activePaths.some((p) => path === p || path.startsWith(`${p}/`));
  }
  const href = (item.href.split('?')[0] ?? item.href) || '/';
  if (href === '/') return path === '/';
  return path === href || path.startsWith(`${href}/`);
}
