'use client';

import { Suspense, useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { BookOpen, Compass, Target, Trophy } from 'lucide-react';
import { GlassTabBar, type GlassTabLinkProps } from '@/components/wb/glass-tab-bar';
import { useSupabaseUser } from '@/hooks/use-supabase-user';
import {
  CHALLENGES_TAB_HREF,
  DISCOVER_TAB_HREF,
  PASSPORT_TAB_HREF,
  PROGRESS_TAB_HREF,
  resolveMemberTabHref,
  shouldShowMemberTabBar,
} from '@/lib/member-tab-bar';

/** Distinct from the header nav, which is already named "Main". */
export const MEMBER_TAB_NAV_LABEL = 'Member';

const MEMBER_TAB_ITEMS = [
  { href: DISCOVER_TAB_HREF, label: 'Discover', icon: Compass },
  { href: CHALLENGES_TAB_HREF, label: 'Challenges', icon: Target },
  { href: PROGRESS_TAB_HREF, label: 'Progress', icon: Trophy },
  { href: PASSPORT_TAB_HREF, label: 'Passport', icon: BookOpen },
] as const;

function MemberTabLink({ href, className, children, ...props }: GlassTabLinkProps) {
  return (
    <Link href={href} className={className} {...props}>
      {children}
    </Link>
  );
}

function MemberTabBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeHref = resolveMemberTabHref(pathname, searchParams.toString());

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('wb-member-tabbar-on');
    return () => root.classList.remove('wb-member-tabbar-on');
  }, []);

  return (
    <GlassTabBar
      className="wb-member-tabbar"
      ariaLabel={MEMBER_TAB_NAV_LABEL}
      activeHref={activeHref}
      items={MEMBER_TAB_ITEMS}
      linkComponent={MemberTabLink}
    />
  );
}

/**
 * Wraps site content only while the bar is shown, so signed-out and excluded
 * routes keep the same DOM as before. The bar itself is hidden at the xl
 * breakpoint in CSS.
 */
export function MemberTabBarSlot({ children }: { children: ReactNode }) {
  const { signedIn } = useSupabaseUser();
  const pathname = usePathname();
  if (!shouldShowMemberTabBar(pathname, signedIn)) return children;

  return (
    <>
      <div className="wb-member-tabbar-pad">{children}</div>
      <Suspense fallback={null}>
        <MemberTabBar />
      </Suspense>
    </>
  );
}
