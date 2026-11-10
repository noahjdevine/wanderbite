import type { ReactNode } from 'react';
import { LevelRoad } from '@/components/journey/level-road';
import { FocusVisitFromHash } from '@/components/notes/focus-visit';
import { BadgeMedallion } from '@/components/wb/badge-medallion';
import { CtaButton } from '@/components/wb/cta-button';
import { NextMoveCard } from '@/components/wb/next-move-card';
import { OpenStat } from '@/components/wb/open-stat';
import { pluralNoun } from '@/lib/format/text';
import { visitElementId } from '@/lib/notes/note-rules';
import { SAVINGS_CORRECTION_NOTE } from '@/lib/progress/savings-cents';
import { formatEarnedOn, PROGRESS_UNAVAILABLE_MESSAGE } from '@/lib/progress/rules';
import {
  formatSavingsDollars,
  PROGRESS_RETRY_HREF,
  XP_RULE_COPY,
  type ProgressReadyModel,
} from '@/lib/progress/progress-board';
import type { VisitStatus } from '@/lib/visits/visit-status';

type ProgressViewProps = {
  model: ProgressReadyModel;
  savedRecipes?: ReactNode;
};

export function ProgressView({ model, savedRecipes }: ProgressViewProps) {
  const toGo =
    model.level.nextLevel != null ? model.level.nextLevel.xp - model.xp : null;
  const ringLabel =
    model.level.nextLevel != null && toGo != null
      ? `${model.xp} of ${model.level.nextLevel.xp} XP, ${toGo} to ${model.level.nextLevel.name}`
      : `${model.xp} XP. Max level`;

  return (
    <div className="bg-wb-cream text-wb-ink">
      <FocusVisitFromHash />
      <header className="wb-dark relative overflow-hidden">
        <div
          aria-hidden="true"
          className="wb-aurora pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.6) 0%, rgba(139,92,246,0) 70%)' }}
        />
        <div
          aria-hidden="true"
          className="wb-aurora-2 pointer-events-none absolute -left-28 top-36 h-80 w-80 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(251,113,133,0.4) 0%, rgba(251,113,133,0) 70%)' }}
        />
        <div className="relative mx-auto flex max-w-5xl flex-col gap-6 px-5 pb-16 pt-4 sm:px-8">
          <div className="flex items-center gap-4 sm:gap-[18px]">
            <XpRing percent={model.level.progressPercent} label={ringLabel} initial={model.initial} />
            <div className="min-w-0">
              <h1 className="wb-display m-0 text-[40px] text-white sm:text-[52px]">
                {model.greetingLead}
                {model.greetingName ? (
                  <>
                    , <em>{model.greetingName}</em>
                  </>
                ) : null}
              </h1>
              <p className="m-0 mt-1.5 text-sm text-wb-lavender-2">{model.levelLabel}</p>
            </div>
          </div>
          <XpPanel
            xp={model.xp}
            nextXp={model.level.nextLevel?.xp ?? null}
            nextName={model.level.nextLevel?.name ?? null}
            percent={model.level.progressPercent}
          />
        </div>
      </header>

      <div className="wb-sheet wb-on-cream">
        <div className="mx-auto flex max-w-5xl flex-col gap-8 px-5 pb-16 pt-7 sm:px-8">
          {model.activityUnavailable || !model.nextMove ? (
            <ProgressUnavailableNotice />
          ) : (
            <NextMoveCard
              sentence={
                <>
                  {model.nextMove.sentence}
                  {model.nextMove.accent ? (
                    <>
                      {' '}
                      <em className="text-wb-pink-ink">{model.nextMove.accent}</em>
                    </>
                  ) : null}
                </>
              }
              meta={model.nextMove.meta}
              actionHref={model.nextMove.actionHref}
              actionLabel={model.nextMove.actionLabel}
            />
          )}

          <section
            aria-label="Totals"
            className="grid grid-cols-2 gap-y-6 sm:grid-cols-4 [&>*:nth-child(2n)]:border-l [&>*:nth-child(2n)]:border-wb-line [&>*:nth-child(2n)]:pl-3 sm:[&>*:nth-child(n+2)]:border-l sm:[&>*:nth-child(n+2)]:border-wb-line sm:[&>*:nth-child(n+2)]:pl-3"
          >
            <OpenStat
              value={model.verifiedVisits}
              label={
                model.pendingVisits > 0 ? (
                  <>
                    verified visits
                    <br />+{model.pendingVisits} pending
                  </>
                ) : (
                  'verified visits'
                )
              }
            />
            <OpenStat
              value={model.uniqueRestaurants}
              label={pluralNoun(model.uniqueRestaurants, 'restaurant')}
            />
            <OpenStat
              value={model.neighborhoods == null ? '—' : model.neighborhoods}
              label={
                model.neighborhoods === 1 ? (
                  <>
                    neighborhood
                    <br />
                    explored
                  </>
                ) : (
                  <>
                    neighborhoods
                    <br />
                    explored
                  </>
                )
              }
            />
            <OpenStat
              value={formatSavingsDollars(model.savingsAmount)}
              label="saved so far"
              estimated={model.savingsIsEstimate}
              note={model.savingsCorrected ? SAVINGS_CORRECTION_NOTE : undefined}
            />
          </section>

          <section aria-labelledby="progress-streak" className="flex flex-col gap-3.5">
            <h2 id="progress-streak" className="wb-display m-0 text-[30px] text-wb-ink">
              Monthly streak
            </h2>
            <p className="m-0 text-sm text-wb-muted">
              Current streak: {model.currentMonthlyStreak}. Longest streak: {model.longestStreak}.
            </p>
            {model.activityUnavailable ? null : (
              <>
                <ol className="m-0 grid list-none grid-cols-6 gap-1.5 p-0">
                  {model.streakMonths.map((month) => (
                    <li key={month.key} className="flex flex-col items-center gap-1.5">
                      <StreakMark verified={month.verified} pending={month.pending} label={month.label} />
                      <span
                        className={
                          month.current ? 'text-xs font-bold text-wb-ink' : 'text-xs text-wb-muted'
                        }
                      >
                        {month.label}
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="m-0 text-sm leading-snug text-wb-ink">{model.streakSentence}</p>
              </>
            )}
          </section>

          <section aria-labelledby="progress-badges" className="flex flex-col gap-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="progress-badges" className="wb-display m-0 text-[30px] text-wb-ink">
                Badges
              </h2>
              <span className="text-[13px] text-wb-muted">
                {model.badges.filter((badge) => badge.earnedAt != null).length} of {model.badges.length}
              </span>
            </div>
            {model.badges.length === 0 ? (
              <p className="m-0 text-sm text-wb-muted">No badges available yet.</p>
            ) : (
              <div className="grid grid-cols-4 gap-1 sm:gap-2">
                {model.badges.map((badge) => {
                  const earned = badge.earnedAt != null;
                  return (
                    <BadgeMedallion
                      key={badge.id}
                      name={badge.name}
                      earned={earned}
                      earnedLabel={earned && badge.earnedAt ? formatEarnedOn(badge.earnedAt) : undefined}
                      progress={earned ? undefined : badge.progress}
                      icon={<span aria-hidden="true">{badge.icon}</span>}
                    />
                  );
                })}
              </div>
            )}
            <LevelRoad xp={model.xp} />
          </section>

          <section aria-labelledby="progress-recent" className="flex flex-col gap-4">
            <h2 id="progress-recent" className="wb-display m-0 text-[30px] text-wb-ink">
              Recent adventures
            </h2>
            {model.activityUnavailable ? (
              <ProgressUnavailableNotice />
            ) : model.emptyVisits || model.adventures.length === 0 ? (
              <p className="m-0 text-sm text-wb-muted">
                No visits yet. A verified visit will show up here.
              </p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-4 p-0">
                {model.adventures.map((adventure) => {
                  const anchor = adventure.redemptionId
                    ? visitElementId(adventure.redemptionId)
                    : null;
                  return (
                    <li
                      key={adventure.id}
                      id={anchor ?? undefined}
                      tabIndex={anchor ? -1 : undefined}
                      data-visit-status={adventure.visitStatus}
                      className="flex scroll-mt-24 flex-wrap items-center gap-3.5 outline-none"
                    >
                      {/* Cards stay on img. The proxy path is same-origin. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={adventure.imageUrl}
                        alt=""
                        width={60}
                        height={60}
                        className="h-[60px] w-[60px] shrink-0 rounded-[18px] object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="m-0 text-base font-semibold">{adventure.restaurantName}</p>
                        {adventure.meta ? (
                          <p className="m-0 text-[13px] text-wb-muted">{adventure.meta}</p>
                        ) : null}
                      </div>
                      <StatusChip status={adventure.visitStatus} label={adventure.statusLabel} />
                      {adventure.memoryHref && adventure.memoryLabel ? (
                        <a
                          href={adventure.memoryHref}
                          data-memory-action={adventure.memoryLabel === 'Add memory' ? 'add' : 'edit'}
                          className="inline-flex min-h-11 items-center rounded-full border border-[#d9cfe6] px-3 text-[13px] font-semibold text-wb-plum"
                        >
                          {adventure.memoryLabel}
                        </a>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {savedRecipes}
        </div>
      </div>
    </div>
  );
}

export function ProgressUnavailable({ headerLabel }: { headerLabel: string }) {
  return (
    <div className="wb-sheet wb-on-cream" style={{ marginTop: 0 }}>
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-8 sm:px-8">
        <h1 className="wb-display m-0 text-[40px] text-wb-ink">{headerLabel}</h1>
        <ProgressUnavailableNotice />
      </div>
    </div>
  );
}

function ProgressUnavailableNotice() {
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="m-0 text-base text-wb-ink">{PROGRESS_UNAVAILABLE_MESSAGE}</p>
      <CtaButton href={PROGRESS_RETRY_HREF}>Retry</CtaButton>
    </div>
  );
}

function XpRing({ percent, label, initial }: { percent: number; label: string; initial: string }) {
  const turn = `${Math.max(0, Math.min(100, percent))}%`;
  return (
    <div className="relative h-[92px] w-[92px] shrink-0" role="img" aria-label={label}>
      <span className="sr-only">{label}</span>
      <div
        aria-hidden="true"
        className="absolute inset-0 rounded-full"
        style={{
          background: `conic-gradient(#fb7185 0 ${turn}, rgba(255,255,255,0.14) ${turn} 100%)`,
        }}
      />
      <div
        aria-hidden="true"
        className="wb-spin pointer-events-none absolute -inset-2.5 rounded-full border border-dashed border-[rgba(255,201,214,0.35)]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-1.5 flex items-center justify-center rounded-full font-display text-[38px] text-white"
        style={{ background: 'radial-gradient(circle at 30% 25%, #4c2a7a, #1d1033)' }}
      >
        {initial}
      </div>
    </div>
  );
}

function XpPanel({
  xp,
  nextXp,
  nextName,
  percent,
}: {
  xp: number;
  nextXp: number | null;
  nextName: string | null;
  percent: number;
}) {
  const width = `${Math.max(0, Math.min(100, percent))}%`;
  const toGo = nextXp != null ? nextXp - xp : null;
  const label =
    nextName != null && toGo != null
      ? `${xp} of ${nextXp} XP, ${toGo} to ${nextName}`
      : `${xp} XP. Max level`;

  return (
    <div className="wb-glass flex flex-col gap-2.5 rounded-[22px] px-[18px] py-4 text-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-display m-0 text-[30px] leading-none">
          {xp}{' '}
          <span className="font-sans text-sm text-white/70">
            {nextXp != null ? `/ ${nextXp} XP` : 'XP'}
          </span>
        </p>
        <p className="m-0 text-[13px] text-[#fbcfe8]">
          {nextName != null && toGo != null ? `${toGo} to ${nextName}` : 'Max level'}
        </p>
      </div>
      <div
        className="relative h-2.5 overflow-hidden rounded-full bg-white/15"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={nextXp ?? xp}
        aria-valuenow={xp}
      >
        <div
          className="wb-xp-fill relative h-2.5 overflow-hidden rounded-full"
          style={{
            width,
            background: 'linear-gradient(90deg, #8b5cf6, #f472b6)',
          }}
        >
          <span
            aria-hidden="true"
            className="wb-shine pointer-events-none absolute top-[-10px] left-0 h-[30px] w-[30px] bg-white/55 blur-[6px]"
          />
        </div>
      </div>
      <p className="m-0 text-xs text-white/65">{XP_RULE_COPY}</p>
    </div>
  );
}

function StreakMark({
  verified,
  pending,
  label,
}: {
  verified: boolean;
  pending: boolean;
  label: string;
}) {
  if (verified) {
    return (
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-wb-plum text-white">
        <span className="sr-only">{label} verified</span>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
    );
  }
  if (pending) {
    return (
      <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-dashed border-wb-pink text-wb-pink-ink">
        <span className="sr-only">{label} pending</span>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </span>
    );
  }
  return (
    <span className="h-10 w-10 rounded-full border border-wb-line">
      <span className="sr-only">{label} no visit</span>
    </span>
  );
}

function StatusChip({ status, label }: { status: VisitStatus; label: string }) {
  const tone =
    status === 'verified' || status === 'note_added'
      ? 'bg-wb-ok-bg text-wb-ok-fg'
      : status === 'code_issued' || status === 'code_expired'
        ? 'bg-wb-wait-bg text-wb-wait-fg'
        : 'bg-wb-line text-wb-ink';
  return (
    <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${tone}`}>{label}</span>
  );
}
