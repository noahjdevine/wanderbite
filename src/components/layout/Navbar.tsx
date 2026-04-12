'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown, Dices, UtensilsCrossed, User as UserIcon } from 'lucide-react';

export function Navbar() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const client = createClient();
    async function init() {
      const { data: { user: u } } = await client.auth.getUser();
      setUser(u ?? null);
      setLoading(false);
    }
    init();
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleSignOut() {
    const client = createClient();
    await client.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 hidden w-full border-b border-white/20 bg-white/80 backdrop-blur-md md:flex">
      <nav className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4 sm:px-6 sm:gap-6">
        {/* Left: Logo + wordmark (SVG) — always links to / */}
        <div className="flex shrink-0 items-center">
          <Link href="/">
            <div
              style={{
                background: '#e8d3ff',
                borderRadius: '12px',
                padding: '6px 12px',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              <Image
                src="/logo.svg"
                alt="Wanderbite"
                width={120}
                height={32}
                priority
                style={{ objectFit: 'contain' }}
              />
            </div>
          </Link>
        </div>

        {/* Center: Links */}
        <div className="hidden min-w-0 flex-1 items-center justify-center gap-8 md:flex">
          <Link
            href="/how-it-works"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            How it Works
          </Link>
          <Link
            href="/roulette"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Dices className="size-4 shrink-0" aria-hidden />
            Wanderbite Roulette
          </Link>
          {user ? (
            <>
              <Link
                href="/restaurants"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <UtensilsCrossed className="size-4 shrink-0" aria-hidden />
                Restaurants
              </Link>
              <Link
                href="/challenges"
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Challenges
              </Link>
              <Link
                href="/journey"
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                My Journey
              </Link>
              <Link
                href="/journal"
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Journal
              </Link>
              <Link
                href="/passport"
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Passport
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/restaurants"
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Restaurants
              </Link>
              <Link
                href="/pricing"
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Pricing
              </Link>
            </>
          )}
        </div>

        {/* Right: Auth */}
        <div className="flex shrink-0 items-center justify-end gap-2 self-center">
          {loading ? (
            <div className="h-9 w-20 rounded-md bg-muted animate-pulse" />
          ) : user ? (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon-sm" className="gap-1.5 px-2">
                    <UserIcon className="size-4" />
                    <ChevronDown className="size-4 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link href="/profile">Profile</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/billing">Billing</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/suggest">Suggest a Restaurant</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleSignOut}>
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <Button size="sm" asChild>
              <Link href="/login">Log In</Link>
            </Button>
          )}
        </div>
      </nav>
    </header>
  );
}
