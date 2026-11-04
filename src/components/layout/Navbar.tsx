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
  const { signedIn, loading } = useSupabaseUser();
  const pathname = usePathname();
  const items = signedIn ? MEMBER_NAV_ITEMS : PUBLIC_NAV_ITEMS;
  const onDarkHero = pathname === '/';

  return (
    <header
      className={cn(
        'top-0 z-40 hidden w-full xl:flex',
        onDarkHero
          ? 'wb-dark absolute inset-x-0 border-transparent bg-transparent'
          : 'sticky border-b border-white/20 bg-white/80 backdrop-blur-md',
      )}
    >
      <nav
        className={cn(
          'mx-auto flex h-14 w-full items-center gap-4 px-4 sm:gap-6 sm:px-6',
          onDarkHero && 'max-w-[1280px] sm:px-10',
          !onDarkHero && 'max-w-6xl',
        )}
      >
        <WanderbiteLogoLink />

        <div
          className={cn(
            'flex min-w-0 flex-1 items-center justify-center',
            onDarkHero
              ? 'gap-1 rounded-full border border-white/20 bg-[rgba(18,10,36,0.78)] px-1.5 py-1 backdrop-blur-md'
              : 'gap-8',
          )}
        >
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
                  onDarkHero
                    ? active
                      ? 'rounded-full bg-white/15 px-3 py-2 text-white'
                      : 'rounded-full px-3 py-2 text-white/85 hover:bg-white/10 hover:text-white'
                    : active
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
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
            <div className={cn('h-9 w-24 animate-pulse rounded-md', onDarkHero ? 'bg-white/15' : 'bg-muted')} />
          ) : signedIn ? (
            <AccountMenu className={onDarkHero ? 'border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white' : undefined} />
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                className={onDarkHero ? 'border-transparent bg-white text-wb-plum hover:bg-white/90 hover:text-wb-plum' : undefined}
                asChild
              >
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
