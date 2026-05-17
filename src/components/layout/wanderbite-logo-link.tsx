'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { WANDERBITE_RESET_ROULETTE_EVENT } from '@/lib/wanderbite-roulette-events';

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
      className="flex shrink-0 items-center gap-2 no-underline"
    >
      <div
        className="rounded-[10px] px-2 py-1"
        style={{ background: '#e8d3ff' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.svg"
          alt=""
          className="block object-contain object-top"
          style={{
            width: compact ? 28 : 32,
            height: compact ? 28 : 32,
          }}
        />
      </div>
      <span
        className="font-semibold text-[#111111]"
        style={{ fontSize: compact ? 14 : 16 }}
      >
        Wanderbite
      </span>
    </Link>
  );
}
