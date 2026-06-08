'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
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

export function MobileNav() {
  const { user, loading } = useSupabaseUser();
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const items = user ? MEMBER_NAV_ITEMS : PUBLIC_NAV_ITEMS;

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  useEffect(() => {
    closeDrawer();
  }, [pathname, closeDrawer]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDrawer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen, closeDrawer]);

  async function handleSignOut() {
    closeDrawer();
    const client = createClient();
    await client.auth.signOut();
    router.push('/signin');
    router.refresh();
  }

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/20 bg-white/90 backdrop-blur-md md:hidden">
      <div className="flex h-14 items-center gap-2 px-4">
        <WanderbiteLogoLink compact />

        <div className="flex flex-1 items-center justify-end gap-2">
          {loading ? (
            <div className="h-8 w-20 animate-pulse rounded-md bg-muted" />
          ) : user ? (
            <AccountMenu variant="icon" />
          ) : (
            <Button size="sm" className="shrink-0 text-xs sm:text-sm" asChild>
              <Link href="/signup">Start Your Adventure</Link>
            </Button>
          )}

          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-expanded={drawerOpen}
            aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setDrawerOpen((o) => !o)}
          >
            {drawerOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>
        </div>
      </div>

      {drawerOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 top-14 z-40 bg-black/30"
            aria-label="Close menu"
            onClick={closeDrawer}
          />
          <nav
            className="absolute left-0 right-0 top-full z-50 border-b border-border bg-background px-4 py-4 shadow-lg"
            aria-label="Mobile menu"
          >
            <ul className="space-y-1">
              {items.map((item) => {
                const href = resolveNavHref(item);
                const active = isNavItemActive(item, pathname);
                const Icon = item.icon;
                return (
                  <li key={item.href + item.label}>
                    <Link
                      href={href}
                      onClick={closeDrawer}
                      aria-label={item.ariaLabel}
                      className={cn(
                        'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium',
                        active
                          ? 'bg-primary/10 text-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                    >
                      {Icon ? <Icon className="size-5 shrink-0" aria-hidden /> : null}
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>

            <hr className="my-4 border-border" />

            {user ? (
              <button
                type="button"
                onClick={handleSignOut}
                className="w-full rounded-md px-3 py-2.5 text-left text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Sign Out
              </button>
            ) : (
              <Link
                href="/signin"
                onClick={closeDrawer}
                className="block rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Sign In
              </Link>
            )}
          </nav>
        </>
      ) : null}
    </header>
  );
}
