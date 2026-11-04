import type { ReactNode, RefObject } from 'react';
import { AreaHoldNotice } from '@/components/area-hold-notice';
import { IncompleteProfileNotice } from '@/components/account/incomplete-profile-notice';
import { PillLabel } from '@/components/wb/pill-label';
import { StatTile } from '@/components/wb/stat-tile';
import type { AdventureStatTile } from '@/lib/challenges/adventure-header';

type ChallengesGoldenProps = {
  monthName: string;
  daysLabel: string;
  tiles: AdventureStatTile[];
  headingRef: RefObject<HTMLHeadingElement | null>;
  revealFocus: boolean;
  showIncompleteProfile: boolean;
  launchEligible: boolean;
  retryMessage: string | null;
  primary: ReactNode;
  streak: ReactNode;
  carried: ReactNode;
};

export function ChallengesGolden({
  monthName,
  daysLabel,
  tiles,
  headingRef,
  revealFocus,
  showIncompleteProfile,
  launchEligible,
  retryMessage,
  primary,
  streak,
  carried,
}: ChallengesGoldenProps) {
  const tileColumns = tiles.length >= 3 ? 'grid-cols-3' : tiles.length === 2 ? 'grid-cols-2' : 'grid-cols-1';

  return (
    <div>
      <header className="wb-dark relative overflow-hidden">
        <div
          aria-hidden="true"
          className="wb-aurora pointer-events-none absolute -left-24 -top-20 h-80 w-80 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.55) 0%, rgba(139,92,246,0) 70%)' }}
        />
        <div
          aria-hidden="true"
          className="wb-aurora-2 pointer-events-none absolute -right-28 top-8 h-80 w-80 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(251,113,133,0.42) 0%, rgba(251,113,133,0) 70%)' }}
        />
        <div className="relative mx-auto flex max-w-5xl flex-col gap-3 px-5 pb-12 pt-4 sm:px-8 sm:pt-8">
          <PillLabel>{daysLabel}</PillLabel>
          <h1
            ref={headingRef}
            tabIndex={revealFocus ? -1 : undefined}
            className="wb-display m-0 text-[40px] text-white outline-none sm:text-[52px]"
          >
            Your <em>{monthName}</em> adventures
          </h1>
          {tiles.length > 0 ? (
            <div className={`mt-1 grid gap-2 ${tileColumns}`}>
              {tiles.map((tile) => (
                <StatTile key={tile.id} value={tile.value} suffix={tile.suffix} label={tile.label} />
              ))}
            </div>
          ) : null}
        </div>
      </header>
      <div className="wb-sheet">
        <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 pb-16 pt-5 sm:px-8">
          {showIncompleteProfile ? <IncompleteProfileNotice /> : null}
          {launchEligible ? null : <AreaHoldNotice />}
          {retryMessage ? (
            <p role="alert" className="text-sm text-destructive">
              {retryMessage}
            </p>
          ) : null}
          {primary}
          {streak}
          {carried}
        </div>
      </div>
    </div>
  );
}
