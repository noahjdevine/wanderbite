'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useSupabaseUser } from '@/hooks/use-supabase-user';
import {
  MEMBER_NAV_ITEMS,
  PUBLIC_NAV_ITEMS,
  isNavItemActive,
  resolveNavHref,
} from '@/lib/nav-items';
import { cn } from '@/lib/utils';
import { AccountMenu } from '@/components/layout/account-menu';
import { WanderbiteLogoLink } from '@/components/layout/wanderbite-logo-link';

export function Navbar() {
  const { user, loading } = useSupabaseUser();
  const pathname = usePathname();
  const items = user ? MEMBER_NAV_ITEMS : PUBLIC_NAV_ITEMS;

  return (
    <header className="sticky top-0 z-40 hidden w-full border-b border-white/20 bg-white/80 backdrop-blur-md md:flex">
      <nav className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4 sm:gap-6 sm:px-6">
        <WanderbiteLogoLink />

        <div className="flex min-w-0 flex-1 items-center justify-center gap-8">
          {items.map((item) => {
            const href = resolveNavHref(item);
            const active = isNavItemActive(item, pathname);
            const Icon = item.icon;
            return (
              <Link
                key={item.href + item.label}
                href={href}
                aria-label={item.ariaLabel}
                className={cn(
                  'inline-flex items-center gap-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {Icon ? <Icon className="size-4 shrink-0" aria-hidden /> : null}
                {item.label}
              </Link>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2">
          {loading ? (
            <div className="h-9 w-24 animate-pulse rounded-md bg-muted" />
          ) : user ? (
            <AccountMenu />
          ) : (
            <>
              <Button size="sm" variant="outline" asChild>
                <Link href="/signin">Sign In</Link>
              </Button>
              <Button size="sm" asChild>
                <Link href="/signup">Start Your Adventure</Link>
              </Button>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
