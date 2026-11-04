'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
  const { signedIn, loading } = useSupabaseUser();
  const pathname = usePathname();
  const items = signedIn ? MEMBER_NAV_ITEMS : PUBLIC_NAV_ITEMS;
  const onDarkHero = pathname === '/';

  return (
    <header
      className={cn(
        'wb-dark top-0 z-40 hidden h-16 w-full bg-wb-night text-white xl:flex',
        onDarkHero ? 'absolute inset-x-0' : 'sticky',
      )}
    >
      <nav
        aria-label="Main"
        className="mx-auto flex h-full w-full max-w-[1280px] items-center justify-between gap-4 px-6 xl:px-10"
      >
        <WanderbiteLogoLink />

        <div className="wb-nav-pill">
          {items.map((item) => {
            const href = resolveNavHref(item);
            const active = isNavItemActive(item, pathname);
            const Icon = item.icon;
            return (
              <Link
                key={item.href + item.label}
                href={href}
                aria-label={item.ariaLabel}
                aria-current={active ? 'page' : undefined}
                className="wb-nav-link"
              >
                {Icon ? <Icon className="size-4 shrink-0" aria-hidden /> : null}
                {item.label}
              </Link>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2">
          {loading ? (
            <div className="h-11 w-24 rounded-full bg-white/15" />
          ) : signedIn ? (
            <AccountMenu />
          ) : (
            <>
              <Link href="/signin" className="wb-nav-signin">
                Sign In
              </Link>
              <Link href="/signup" className="wb-nav-cta">
                Start Your Adventure
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
