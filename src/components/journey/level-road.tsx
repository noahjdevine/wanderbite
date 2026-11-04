'use client';

import { useId, useState } from 'react';
import { XP_LEVELS } from '@/lib/progress/rules';

type LevelRoadProps = {
  xp: number;
};

/** Keyboard disclosure for the existing 300 / 1000 / 1500 / 2500 tiers. */
export function LevelRoad({ xp }: LevelRoadProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-14 items-center justify-between gap-3 rounded-[18px] border border-wb-line bg-white px-[18px] text-left text-wb-ink"
      >
        <span className="flex flex-col gap-0.5">
          <span className="text-[15px] font-semibold">Road to Local Legend</span>
          <span className="text-xs text-wb-muted">{XP_LEVELS.length} levels</span>
        </span>
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={open ? 'rotate-180' : undefined}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <ul id={panelId} className="m-0 flex list-none flex-col gap-2 p-0">
          {XP_LEVELS.map((tier) => {
            const unlocked = xp >= tier.minXp;
            return (
              <li
                key={tier.level}
                className="flex items-center justify-between gap-3 rounded-2xl border border-wb-line bg-white px-4 py-3"
              >
                <span>
                  <span className="block text-sm font-semibold text-wb-ink">
                    Level {tier.level} · {tier.name}
                  </span>
                  <span className="text-xs text-wb-muted">{tier.minXp} XP</span>
                </span>
                <span className="text-xs font-semibold text-wb-ink">
                  {unlocked ? 'Unlocked' : 'Locked'}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
