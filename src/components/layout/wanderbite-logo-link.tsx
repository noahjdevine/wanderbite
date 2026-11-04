'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { WANDERBITE_RESET_ROULETTE_EVENT } from '@/lib/wanderbite-roulette-events';
import { cn } from '@/lib/utils';

type WanderbiteLogoLinkProps = {
  compact?: boolean;
};

export function WanderbiteLogoLink({ compact }: WanderbiteLogoLinkProps) {
  const pathname = usePathname();

  return (
    <Link
      href="/"
      aria-label="Wanderbite"
      onClick={(e) => {
        if (pathname !== '/') return;
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        window.dispatchEvent(new Event(WANDERBITE_RESET_ROULETTE_EVENT));
      }}
      className={cn('wb-wordmark shrink-0', compact && 'wb-wordmark--compact')}
    >
      Wanderbite
    </Link>
  );
}
