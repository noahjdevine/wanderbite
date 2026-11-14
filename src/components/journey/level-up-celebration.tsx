'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { celebrate } from '@/lib/confetti';
import { XP_LEVELS } from '@/lib/progress/rules';
import {
  browserLevelUpStorage,
  markLevelUpsSeen,
  pickLevelUpCelebration,
} from '@/lib/progression/level-up-seen';
import type { MemberProgressionMilestone } from '@/lib/progression/read-model';

type LevelUpCelebrationProps = {
  /** Exact member progression UI flag. Off renders nothing. */
  enabled: boolean;
  milestones: readonly MemberProgressionMilestone[];
};

const CONGRATULATIONS = 'Nice work. That’s a new level on your journey.';

function subscribeLevelUpStorage(onChange: () => void) {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

function levelUpSnapshot(
  enabled: boolean,
  milestones: readonly MemberProgressionMilestone[],
  revision: number,
): string {
  if (!enabled || revision < 0) return '';
  const choice = pickLevelUpCelebration(milestones, browserLevelUpStorage());
  if (!choice) return '';
  return `${choice.milestone.id}\n${choice.markIds.join('\n')}`;
}

/**
 * One celebration for the highest unseen milestone. Dismiss marks every unseen
 * milestone seen in this browser. This does not write the ledger.
 */
export function LevelUpCelebration({ enabled, milestones }: LevelUpCelebrationProps) {
  const titleId = useId();
  const descriptionId = useId();
  const medalId = useId();
  const dismissRef = useRef<HTMLButtonElement>(null);
  const [revision, setRevision] = useState(0);
  const snapshot = useSyncExternalStore(
    subscribeLevelUpStorage,
    () => levelUpSnapshot(enabled, milestones, revision),
    () => '',
  );
  const [id = '', ...markIds] = snapshot ? snapshot.split('\n') : [];
  const milestone = milestones.find((row) => row.id === id) ?? null;
  const reducedMotion =
    milestone != null && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (!milestone) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    void celebrate();
  }, [milestone]);

  useEffect(() => {
    if (!milestone) return;
    const previous = document.activeElement;
    const restore = previous instanceof HTMLElement ? previous : null;
    dismissRef.current?.focus();
    return () => {
      restore?.focus();
    };
  }, [milestone]);

  function dismiss() {
    if (milestone) markLevelUpsSeen(markIds.length > 0 ? markIds : [milestone.id], browserLevelUpStorage());
    setRevision((value) => value + 1);
  }

  if (!milestone) return null;
  const known = XP_LEVELS.find((tier) => tier.level === milestone.level);
  const name = known?.name ?? milestone.name;
  const safeMedalId = medalId.replace(/:/g, '');

  return (
    <Dialog open onOpenChange={(open) => { if (!open) dismiss(); }}>
      <DialogContent
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-motion={reducedMotion ? 'static' : 'confetti'}
        className="mx-4 flex w-[min(100%,36rem)] max-w-xl flex-col items-center gap-5 border-wb-line bg-wb-cream px-8 py-12 text-center text-wb-ink shadow-2xl sm:px-12"
      >
        <LevelMedal level={milestone.level} gradientId={safeMedalId} />
        <p className="m-0 text-sm font-semibold uppercase tracking-[0.14em] text-wb-muted">
          Level {milestone.level}
        </p>
        <DialogTitle
          id={titleId}
          className="wb-display text-5xl leading-none tracking-normal text-wb-ink sm:text-6xl"
        >
          {name}
        </DialogTitle>
        <DialogDescription id={descriptionId} className="max-w-sm text-base text-wb-ink">
          {CONGRATULATIONS}
        </DialogDescription>
        <button
          ref={dismissRef}
          type="button"
          className="wb-cta mt-2 min-h-12 min-w-40"
          onClick={dismiss}
        >
          Got it
        </button>
      </DialogContent>
    </Dialog>
  );
}

function LevelMedal({ level, gradientId }: { level: number; gradientId: string }) {
  return (
    <svg aria-hidden="true" width="132" height="132" viewBox="0 0 132 132">
      <defs>
        <radialGradient id={gradientId} cx="30%" cy="25%" r="75%">
          <stop offset="0%" stopColor="#ddd6fe" />
          <stop offset="45%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#4c1d95" />
        </radialGradient>
      </defs>
      <circle cx="66" cy="66" r="58" fill={`url(#${gradientId})`} />
      <circle cx="66" cy="66" r="46" fill="none" stroke="white" strokeOpacity="0.7" strokeWidth="3" />
      <path
        d="M66 38l6.4 13.2 14.6 2.1-10.5 10.2 2.5 14.5L66 71.2 52.9 78l2.5-14.5L45 53.3l14.6-2.1L66 38z"
        fill="white"
        fillOpacity="0.95"
      />
      <text
        x="66"
        y="108"
        textAnchor="middle"
        fill="white"
        fontSize="18"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontWeight="700"
      >
        {level}
      </text>
    </svg>
  );
}
