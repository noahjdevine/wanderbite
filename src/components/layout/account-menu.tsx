'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronDown, User as UserIcon } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type AccountMenuProps = {
  /** Compact icon-only trigger for mobile top bar. */
  variant?: 'default' | 'icon';
};

export function AccountMenu({ variant = 'default' }: AccountMenuProps) {
  const router = useRouter();

  async function handleSignOut() {
    const client = createClient();
    await client.auth.signOut();
    router.push('/signin');
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size={variant === 'icon' ? 'icon-sm' : 'sm'}
          className={variant === 'icon' ? 'px-2' : 'gap-1.5 px-2'}
          aria-label="Account menu"
        >
          <UserIcon className="size-4" />
          {variant === 'default' ? (
            <ChevronDown className="size-4 opacity-50" />
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href="/account">Account</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/billing">Billing</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/suggest">Suggest a Restaurant</Link>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleSignOut}>Sign Out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
