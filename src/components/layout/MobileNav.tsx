'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, MapPin, User } from 'lucide-react';
import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/locations', label: 'Explore', icon: MapPin },
  { href: '/profile', label: 'Profile', icon: User },
] as const;

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex md:hidden border-t border-violet-200/80 bg-white/80 backdrop-blur-md shadow-[0_-4px_6px_-1px_rgba(124,58,237,0.1)]"
      aria-label="Mobile navigation"
    >
      <div className="flex w-full items-center justify-around py-2">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive =
            href === '/'
              ? pathname === '/'
              : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center gap-1 rounded-full px-6 py-2 transition-colors',
                isActive
                  ? 'bg-violet-100 text-violet-600'
                  : 'text-slate-400 hover:text-violet-400'
              )}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon className="size-6" aria-hidden />
              <span className="text-xs font-medium">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
