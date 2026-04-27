'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Dices, Home, UtensilsCrossed, User, HelpCircle, Stamp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  activePaths?: readonly string[];
  /** Shown on mobile when `label` is shortened (e.g. tab bar space). */
  ariaLabel?: string;
};

const ITEMS: NavItem[] = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/how-it-works', label: 'How it Works', icon: HelpCircle },
  {
    href: '/roulette',
    label: 'Roulette',
    icon: Dices,
    ariaLabel: 'Wanderbite Roulette',
  },
  { href: '/restaurants', label: 'Restaurants', icon: UtensilsCrossed },
  { href: '/passport', label: 'Passport', icon: Stamp },
  {
    href: '/account',
    label: 'Account',
    icon: User,
    activePaths: ['/account', '/profile', '/login', '/signin', '/signup'],
  },
];

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200 bg-white/90 px-6 pb-6 pt-3 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.08)] backdrop-blur-md lg:hidden"
      style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
      aria-label="Mobile navigation"
    >
      <div className="mb-3 flex w-full items-center justify-center">
        <Link
          href="/"
          aria-label="Wanderbite"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            textDecoration: 'none',
          }}
        >
          <div
            style={{
              background: '#e8d3ff',
              borderRadius: '10px',
              padding: '4px 8px',
            }}
          >
            <img
              src="/logo.svg"
              alt=""
              style={{
                width: '28px',
                height: '28px',
                objectFit: 'contain',
                objectPosition: 'top',
                display: 'block',
              }}
            />
          </div>
          <span style={{ fontWeight: 600, fontSize: '14px', color: '#111111' }}>
            Wanderbite
          </span>
        </Link>
      </div>
      <div className="flex w-full items-center justify-between">
        {ITEMS.map(({ href, label, icon: Icon, activePaths, ariaLabel }) => {
          const resolvedHref =
            href === '/roulette' && pathname === '/' ? '/#roulette' : href;
          const isActive = activePaths
            ? activePaths.includes(pathname)
            : pathname === href;
          return (
            <Link
              key={href}
              href={resolvedHref}
              aria-label={ariaLabel}
              className={cn(
                'flex flex-col items-center gap-1 min-w-0 flex-1 transition-colors',
                isActive ? 'text-violet-600' : 'text-slate-500 hover:text-slate-700'
              )}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon className="size-6 shrink-0" aria-hidden />
              <span className="text-[10px] font-medium truncate w-full text-center">
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
// v2 update