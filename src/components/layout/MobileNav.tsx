'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, MapPin, User, HelpCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  activePaths?: readonly string[];
};

const ITEMS: NavItem[] = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/how-it-works', label: 'How it Works', icon: HelpCircle },
  { href: '/restaurants', label: 'Restaurants', icon: MapPin },
  {
    href: '/profile',
    label: 'Profile',
    icon: User,
    activePaths: ['/profile', '/login'],
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
      <div className="flex items-center justify-between">
        {ITEMS.map(({ href, label, icon: Icon, activePaths }) => {
          const isActive = activePaths
            ? activePaths.includes(pathname)
            : pathname === href;
          return (
            <Link
              key={href}
              href={href}
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