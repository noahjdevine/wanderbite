'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronDown, User as UserIcon } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type AccountMenuProps = {
  /** Compact icon-only trigger for mobile top bar. */
  variant?: 'default' | 'icon';
  className?: string;
};

export function AccountMenu({ variant = 'default', className }: AccountMenuProps) {
  const router = useRouter();

  async function handleSignOut() {
    const client = createClient();
    await client.auth.signOut();
    router.push('/signin');
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex items-center justify-center rounded-full border border-white/25 bg-white/10 text-white',
          variant === 'icon' ? 'size-11' : 'h-11 gap-1.5 px-3',
          className,
        )}
        aria-label="Account menu"
      >
        <UserIcon className="size-4" aria-hidden />
        {variant === 'default' ? <ChevronDown className="size-4 opacity-70" aria-hidden /> : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="wb-account-menu min-w-56 p-2">
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
