'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useSupabaseUser } from '@/hooks/use-supabase-user';

const linkClass = 'text-sm text-muted-foreground transition-colors hover:text-foreground';

function FooterSignOut() {
  const router = useRouter();

  async function handleSignOut() {
    const client = createClient();
    await client.auth.signOut();
    router.push('/signin');
    router.refresh();
  }

  return (
    <button type="button" onClick={handleSignOut} className={linkClass}>
      Sign Out
    </button>
  );
}

export function Footer() {
  const currentYear = new Date().getFullYear();
  const { signedIn, loading } = useSupabaseUser();

  return (
    <footer className="border-t bg-background">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-6 sm:flex-row sm:px-6">
        <p className="text-sm text-muted-foreground">
          © {currentYear} Wanderbite. All rights reserved.
        </p>
        <nav className="flex flex-wrap items-center justify-center gap-6">
          <Link href="/#how-it-works" className={linkClass}>
            How it Works
          </Link>
          <Link href="/restaurants" className={linkClass}>
            Restaurants
          </Link>
          <Link href="/pricing" className={linkClass}>
            Pricing
          </Link>
          <Link href="/terms" className={linkClass}>
            Terms of Service
          </Link>
          <Link href="/privacy" className={linkClass}>
            Privacy Policy
          </Link>
          <Link href="/rules" className={linkClass}>
            Rules
          </Link>
          <Link href="/contact" className={linkClass}>
            Contact
          </Link>
          {loading ? (
            <span className="h-4 w-16 animate-pulse rounded bg-muted" aria-hidden />
          ) : signedIn ? (
            <>
              <Link href="/account" className={linkClass}>
                Account
              </Link>
              <Link href="/billing" className={linkClass}>
                Billing
              </Link>
              <Link href="/suggest" className={linkClass}>
                Suggest a Restaurant
              </Link>
              <FooterSignOut />
            </>
          ) : (
            <>
              <Link href="/signup" className={linkClass}>
                Sign up
              </Link>
              <Link href="/signin" className={linkClass}>
                Sign in
              </Link>
            </>
          )}
        </nav>
      </div>
    </footer>
  );
}
