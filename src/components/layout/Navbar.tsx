'use client';

import { useEffect, useState } from 'react';
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
import { ChevronDown, User as UserIcon } from 'lucide-react';

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
      <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-8 px-4 sm:px-6">
        {/* Left: Logo */}
        <Link href="/" className="flex shrink-0 items-center gap-1.5 font-bold text-lg tracking-tight text-primary">
          <span aria-hidden>🍔</span>
          <span>Wanderbite</span>
        </Link>

        {/* Center: Links */}
        <div className="hidden items-center gap-8 md:flex">
          <Link
            href="/#how-it-works"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            How it Works
          </Link>
          <Link
            href="/locations"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Locations
          </Link>
          <Link
            href="/pricing"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Pricing
          </Link>
        </div>

        {/* Right: Auth */}
        <div className="flex items-center gap-2">
          {loading ? (
            <div className="h-9 w-20 rounded-md bg-muted animate-pulse" />
          ) : user ? (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard">Dashboard</Link>
              </Button>
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
                  <DropdownMenuItem onClick={handleSignOut}>
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/login">Log In</Link>
              </Button>
              <Button size="sm" asChild>
                <Link href="/login">Get Started</Link>
              </Button>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
