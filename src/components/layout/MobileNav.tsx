'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSupabaseUser } from '@/hooks/use-supabase-user';
import {
  MEMBER_NAV_ITEMS,
  PUBLIC_NAV_ITEMS,
  isNavItemActive,
  resolveNavHref,
  type NavItem,
} from '@/lib/nav-items';
import { AccountMenu } from '@/components/layout/account-menu';
import { WanderbiteLogoLink } from '@/components/layout/wanderbite-logo-link';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableElements(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (node) => node.tabIndex >= 0 && !node.hasAttribute('disabled'),
  );
}

function MenuLinks({
  items,
  search,
  onNavigate,
}: {
  items: NavItem[];
  search: string;
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  return (
    <ul className="space-y-1">
      {items.map((item) => {
        const href = resolveNavHref(item);
        const active = isNavItemActive(item, pathname, search);
        const Icon = item.icon;
        return (
          <li key={item.href + item.label}>
            <Link
              href={href}
              onClick={onNavigate}
              aria-label={item.ariaLabel}
              aria-current={active ? 'page' : undefined}
              className="wb-nav-menu-link"
            >
              {Icon ? <Icon className="size-5 shrink-0" aria-hidden /> : null}
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function MenuLinksWithSearch({
  items,
  onNavigate,
}: {
  items: NavItem[];
  onNavigate: () => void;
}) {
  const search = useSearchParams().toString();
  return <MenuLinks items={items} search={search} onNavigate={onNavigate} />;
}

export function MobileNav() {
  const { signedIn, loading } = useSupabaseUser();
  const pathname = usePathname();
  const router = useRouter();
  const [drawerState, setDrawerState] = useState({ pathname, open: false });
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  const items = signedIn ? MEMBER_NAV_ITEMS : PUBLIC_NAV_ITEMS;

  const drawerOpen = drawerState.pathname === pathname ? drawerState.open : false;

  const closeDrawer = useCallback(() => {
    setDrawerState({ pathname, open: false });
  }, [pathname]);

  const toggleDrawer = useCallback(() => {
    setDrawerState((prev) =>
      prev.pathname === pathname ? { pathname, open: !prev.open } : { pathname, open: true },
    );
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDrawer();
        toggleRef.current?.focus();
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      const toggle = toggleRef.current;
      if (!panel) return;
      const itemsInTrap = [...(toggle ? [toggle] : []), ...focusableElements(panel)];
      if (itemsInTrap.length === 0) return;
      const current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const index = current ? itemsInTrap.indexOf(current) : -1;
      if (event.shiftKey) {
        if (index <= 0) {
          event.preventDefault();
          itemsInTrap[itemsInTrap.length - 1]?.focus();
        }
        return;
      }
      if (index === -1 || index === itemsInTrap.length - 1) {
        event.preventDefault();
        itemsInTrap[0]?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen, closeDrawer]);

  async function handleSignOut() {
    closeDrawer();
    const client = createClient();
    await client.auth.signOut();
    router.push('/signin');
    router.refresh();
  }

  return (
    <header className="wb-dark fixed inset-x-0 top-0 z-50 bg-wb-night text-white xl:hidden">
      <div className="flex h-14 items-center gap-2 px-3">
        <WanderbiteLogoLink compact />

        <div className="flex flex-1 items-center justify-end gap-2">
          {loading ? (
            <div className="h-11 w-20 rounded-full bg-white/15" />
          ) : signedIn ? (
            <AccountMenu variant="icon" />
          ) : (
            <Link href="/signup" className="wb-nav-cta wb-nav-cta--compact">
              Start Your Adventure
            </Link>
          )}

          <button
            ref={toggleRef}
            type="button"
            aria-expanded={drawerOpen}
            aria-controls="site-menu"
            aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
            onClick={toggleDrawer}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-white/25 bg-white/10 text-white"
          >
            {drawerOpen ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          </button>
        </div>
      </div>

      {drawerOpen ? (
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Dismiss menu"
            className="fixed inset-0 top-14 z-40 bg-black/45"
            onClick={() => {
              closeDrawer();
              toggleRef.current?.focus();
            }}
          />
          <nav
            ref={panelRef}
            id="site-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="wb-nav-menu absolute left-0 right-0 top-full z-50 px-3 py-3"
          >
            <Suspense fallback={<MenuLinks items={items} search="" onNavigate={closeDrawer} />}>
              <MenuLinksWithSearch items={items} onNavigate={closeDrawer} />
            </Suspense>

            <hr className="my-3 border-white/15" />

            {signedIn ? (
              <button type="button" onClick={handleSignOut} className="wb-nav-menu-link">
                Sign Out
              </button>
            ) : (
              <Link href="/signin" onClick={closeDrawer} className="wb-nav-signin w-full">
                Sign In
              </Link>
            )}
          </nav>
        </>
      ) : null}
    </header>
  );
}
