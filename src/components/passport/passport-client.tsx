'use client';

import { useMemo, useState } from 'react';
import { FocusVisitFromHash } from '@/components/notes/focus-visit';
import { PassportChrome } from '@/components/passport/passport-chrome';
import { PassportMemoryCard, QuickMemoryCard } from '@/components/passport/passport-memory';
import { RecipeCards } from '@/components/recipes/recipe-cards';
import { SocialProofRatingBlock } from '@/components/restaurant-social-proof';
import { EmptyStampSlot, PendingStamp, Stamp } from '@/components/wb';
import { LAUNCH_MARKET } from '@/lib/launch-market';
import { visitElementId } from '@/lib/notes/note-rules';
import {
  chicagoVisitDate,
  cuisineInk,
  passportHolderLine,
  passportIssuedOn,
  passportPageCount,
  passportPageItems,
  PASSPORT_PAGE_SIZE,
  stampKind,
  stampRotationDegrees,
  type PassportSegmentId,
} from '@/lib/passport/passport-board';
import { RECIPES_SECTION_HEADING, type RecipeSections } from '@/lib/recipes/display';
import { useStampUnlock } from '@/lib/passport/stamp-unlock';
import { visitStatusLabel, type VisitStatus } from '@/lib/visits/visit-status';
import type { BiteNoteRow } from '@/app/actions/bite-notes';

export type PassportVisit = {
  id: string;
  verifiedAt: string;
  visitStatus: VisitStatus;
  redemptionStatus?: string | null;
  verifiedOnShort?: string | null;
  verifiedOnLong?: string | null;
  chicagoMonth?: string | null;
  restaurant: {
    id: string;
    name: string;
    address: string | null;
    lat: number | null;
    lon: number | null;
    cuisine_tags: string[] | null;
    neighborhood: string | null;
    image_url: string | null;
    google_place_id: string | null;
  };
};

export type PassportRestaurantRatings = Record<
  string,
  { avgRating: number; totalRatings: number }
>;

export type PassportBiteNoteEntry = Pick<
  BiteNoteRow,
  'id' | 'rating' | 'note' | 'restaurant_id' | 'redemption_id' | 'updated_at' | 'is_public'
>;

export type PassportBiteNotesByRestaurant = Record<string, PassportBiteNoteEntry[]>;

export type PassportClientProps = {
  userDisplayName: string;
  visits: PassportVisit[];
  ratingsByRestaurantId: PassportRestaurantRatings;
  biteNotesByRestaurantId: PassportBiteNotesByRestaurant;
  currentStreak: number;
  longestStreak: number;
  totalMonthsActive: number;
  progressUnavailable?: boolean;
  uniqueRestaurants: number;
  neighborhoods: number | null;
  verifiedVisits?: number;
  pendingVisits?: number;
  earnedBadges: { id: string; name: string; earnedOn: string | null }[];
  showFirstBiteLocked: boolean;
  pageYear?: string;
  recipeSections?: RecipeSections;
  segment?: Extract<PassportSegmentId, 'stamps' | 'map'>;
  /** Distinct neighborhoods on active launch-market restaurants. Null when that read did not load. */
  partnerNeighborhoods?: number | null;
  /**
   * Map counter only. Distinct neighborhoods of stamp visits whose restaurant
   * is in the active launch-market set. The header still uses `neighborhoods`.
   */
  exploredNeighborhoods?: number | null;
};

const CITY = LAUNCH_MARKET.displayName.split(',')[0] ?? 'McKinney';

function PassportGuilloche({ define = false }: { define?: boolean }) {
  return (
    <svg aria-hidden="true" focusable="false" className="pointer-events-none absolute inset-0 h-full w-full">
      {define ? (
        <defs>
          <pattern id="wb-passport-guilloche" width="32" height="18" patternUnits="userSpaceOnUse">
            <path d="M0 9c8-8 24-8 32 0" fill="none" stroke="#8a7355" strokeWidth="0.6" />
            <path d="M0 9c8 8 24 8 32 0" fill="none" stroke="#8a7355" strokeWidth="0.6" />
          </pattern>
        </defs>
      ) : null}
      <rect width="100%" height="100%" fill="url(#wb-passport-guilloche)" opacity="0.28" />
    </svg>
  );
}

function biteNoteForVisit(
  visit: PassportVisit,
  byRestaurant: PassportBiteNotesByRestaurant,
): PassportBiteNoteEntry | null {
  const list = byRestaurant[visit.restaurant.id];
  if (!list?.length) return null;
  return list.find((note) => note.redemption_id === visit.id) ?? null;
}

function faceDate(visit: PassportVisit): string {
  if (visit.verifiedOnShort) return visit.verifiedOnShort;
  return chicagoVisitDate(visit.verifiedAt)?.short ?? '';
}

function spokenDate(visit: PassportVisit): string {
  if (visit.verifiedOnLong) return visit.verifiedOnLong;
  return chicagoVisitDate(visit.verifiedAt)?.long ?? faceDate(visit);
}

export function PassportClient({
  userDisplayName,
  visits,
  ratingsByRestaurantId,
  biteNotesByRestaurantId,
  currentStreak,
  longestStreak,
  totalMonthsActive: _totalMonthsActive,
  progressUnavailable = false,
  uniqueRestaurants,
  neighborhoods,
  verifiedVisits,
  pendingVisits,
  earnedBadges,
  showFirstBiteLocked,
  pageYear,
  recipeSections = { exclusionLine: null, byRestaurantId: {} },
}: PassportClientProps) {
  const stamps = useMemo(
    () => visits.filter((visit) => stampKind(visit.visitStatus) === 'stamp'),
    [visits],
  );
  const pending = useMemo(
    () => visits.filter((visit) => stampKind(visit.visitStatus) === 'pending'),
    [visits],
  );
  const [selectedId, setSelectedId] = useState<string | null>(stamps[0]?.id ?? null);

  const selected = stamps.find((visit) => visit.id === selectedId) ?? stamps[0] ?? null;
  const selectedNote = selected ? biteNoteForVisit(selected, biteNotesByRestaurantId) : null;
  const quick = stamps.find((visit) => biteNoteForVisit(visit, biteNotesByRestaurantId) == null) ?? null;
  const visitCount = verifiedVisits ?? stamps.length;
  const pendingCount = pendingVisits ?? pending.length;

  const cuisines = useMemo(() => {
    const seen = new Set<string>();
    const chips: { key: string; label: string; pending: boolean; color: string }[] = [];
    for (const visit of stamps) {
      for (const tag of visit.restaurant.cuisine_tags ?? []) {
        const label = tag.trim();
        if (!label) continue;
        const ink = cuisineInk([label]);
        const key = label.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        chips.push({ key, label, pending: false, color: ink.color });
      }
    }
    for (const visit of pending) {
      for (const tag of visit.restaurant.cuisine_tags ?? []) {
        const label = tag.trim();
        if (!label) continue;
        const key = `${label.toLowerCase()}|pending`;
        if (seen.has(label.toLowerCase()) || seen.has(key)) continue;
        seen.add(key);
        chips.push({ key, label: `${label} · pending`, pending: true, color: cuisineInk([label]).color });
      }
    }
    return chips;
  }, [pending, stamps]);

  const unlockCandidates = useMemo(
    () =>
      stamps.map((visit) => ({
        id: visit.id,
        status: visit.visitStatus,
        verifiedAt: visit.verifiedAt || null,
      })),
    [stamps],
  );
  const unlock = useStampUnlock(unlockCandidates, true);
  const announceVisit = unlock.announceId
    ? stamps.find((visit) => visit.id === unlock.announceId) ?? null
    : null;

  const empty = stamps.length === 0 && pending.length === 0;
  const issuedOn = passportIssuedOn(stamps.map((visit) => visit.verifiedAt));
  const slamSlot =
    unlock.slamId == null ? -1 : stamps.findIndex((visit) => visit.id === unlock.slamId);
  const slots = [
    ...stamps.map((visit, index) => ({ kind: 'stamp' as const, visit, index })),
    ...pending.map((visit) => ({ kind: 'pending' as const, visit })),
    { kind: 'empty' as const },
  ];
  const pageCount = passportPageCount(slots.length);
  const [pageIndex, setPageIndex] = useState(0);
  const [turning, setTurning] = useState(false);
  const [dismissedSlam, setDismissedSlam] = useState<string | null>(null);
  const slamPage =
    unlock.slamId && unlock.slamId !== dismissedSlam && slamSlot >= 0
      ? Math.floor(slamSlot / PASSPORT_PAGE_SIZE)
      : null;
  const safePage = Math.min(slamPage ?? pageIndex, pageCount - 1);
  const pageSlots = passportPageItems(slots, safePage);

  function showPage(next: number) {
    const clamped = Math.min(Math.max(next, 0), pageCount - 1);
    if (clamped === safePage) return;
    if (unlock.slamId) setDismissedSlam(unlock.slamId);
    setTurning(true);
    setPageIndex(clamped);
  }

  return (
    <PassportChrome
      displayName={userDisplayName}
      segment="stamps"
      progressUnavailable={progressUnavailable}
      verifiedVisits={visitCount}
      uniqueRestaurants={uniqueRestaurants}
      neighborhoods={neighborhoods}
      currentStreak={currentStreak}
      longestStreak={longestStreak}
      pendingVisits={pendingCount}
      earnedBadges={earnedBadges}
      showFirstBiteLocked={showFirstBiteLocked}
      pageYear={pageYear}
    >
      <FocusVisitFromHash />
      <p className="sr-only" aria-live="polite" data-stamp-announcement="">
        {announceVisit ? `New stamp: ${announceVisit.restaurant.name}` : ''}
      </p>
      <section aria-labelledby="passport-book" className="wb-passport-book">
        <div className="wb-passport-spread">
          <div className="wb-passport-cover">
            <PassportGuilloche define />
            <div className="relative flex flex-col gap-2">
              <h2 id="passport-book" className="font-display m-0 text-[34px] leading-none text-wb-ink">
                Wanderbite Passport
              </h2>
              <p className="m-0 text-lg font-semibold text-wb-ink" data-passport-holder="">
                {passportHolderLine(userDisplayName)}
              </p>
              <p className="m-0 text-sm text-wb-muted">{CITY}</p>
              {issuedOn ? <p className="m-0 text-sm text-wb-ink">Issued {issuedOn}</p> : null}
            </div>
          </div>
          <div className="wb-passport-spine" aria-hidden="true" />
          <div
            className="wb-passport-leaf"
            data-turning={turning ? 'true' : 'false'}
            onAnimationEnd={() => setTurning(false)}
          >
            <PassportGuilloche />
            <div className="relative flex flex-col gap-4">
              {empty ? (
                <p className="m-0 text-sm text-wb-muted" data-passport-empty="">
                  Your passport is empty. A visit shows up here after it is verified.
                </p>
              ) : null}
              <div className="grid grid-cols-2 justify-items-center gap-x-2 gap-y-6">
                {pageSlots.map((slot) => {
                  if (slot.kind === 'empty') {
                    return <EmptyStampSlot key="next-stamp" href="/challenges" challengeName="Challenges" />;
                  }
                  if (slot.kind === 'pending') {
                    return <PendingStamp key={slot.visit.id} name={slot.visit.restaurant.name} />;
                  }
                  const visit = slot.visit;
                  const ink = cuisineInk(visit.restaurant.cuisine_tags);
                  const rotation = stampRotationDegrees(visit.id);
                  const neighborhood = visit.restaurant.neighborhood?.trim() ?? '';
                  return (
                    <div key={visit.id} className="flex flex-col items-center gap-1">
                      <Stamp
                        name={visit.restaurant.name}
                        date={faceDate(visit) || '—'}
                        accessibleDate={spokenDate(visit)}
                        neighborhood={neighborhood}
                        inkColor={ink.color}
                        shape={slot.index === 0 ? 'rect' : 'round'}
                        rotation={rotation}
                        newest={slot.index === 0}
                        playSlam={unlock.slamId === visit.id}
                        statusLabel={visitStatusLabel(visit.visitStatus)}
                        pressed={selected?.id === visit.id}
                        elementId={visitElementId(visit.id) ?? undefined}
                        onSelect={() => setSelectedId(visit.id)}
                      />
                      <span className="sr-only" data-visit-status={visit.visitStatus}>
                        {visitStatusLabel(visit.visitStatus)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div
                className="flex items-center justify-between gap-3"
                role="group"
                aria-label="Passport pages"
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
                  event.preventDefault();
                  showPage(safePage + (event.key === 'ArrowRight' ? 1 : -1));
                }}
              >
                <p className="m-0 text-xs font-bold tracking-[1.4px] text-wb-muted">
                  Page {safePage + 1} of {pageCount}
                </p>
                {pageCount > 1 ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="min-h-11 rounded-full border border-wb-line px-3 text-sm font-semibold text-wb-ink disabled:opacity-40"
                      onClick={() => showPage(safePage - 1)}
                      disabled={safePage === 0}
                    >
                      Previous page
                    </button>
                    <button
                      type="button"
                      className="min-h-11 rounded-full border border-wb-line px-3 text-sm font-semibold text-wb-ink disabled:opacity-40"
                      onClick={() => showPage(safePage + 1)}
                      disabled={safePage >= pageCount - 1}
                    >
                      Next page
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </section>

      {selected ? (
        <PassportMemoryCard
          name={selected.restaurant.name}
          meta={[spokenDate(selected), selected.restaurant.neighborhood?.trim() || null]
            .filter(Boolean)
            .join(' · ')}
          note={selectedNote?.note?.trim() ? selectedNote.note.trim() : null}
          rating={selectedNote ? selectedNote.rating : null}
          photoLabel="Restaurant photo"
          restaurantId={selected.restaurant.id}
          imageUrl={selected.restaurant.image_url}
          googlePlaceId={selected.restaurant.google_place_id}
          redemptionId={selected.id}
          status={selected.visitStatus}
          noteId={selectedNote?.id}
          isPublic={selectedNote?.is_public ?? false}
          redemptionStatus={
            selected.redemptionStatus ??
            (selected.visitStatus === 'verified' || selected.visitStatus === 'note_added'
              ? 'verified'
              : null)
          }
          verifiedAt={selected.verifiedAt || null}
        />
      ) : null}

      {selected && (ratingsByRestaurantId[selected.restaurant.id]?.totalRatings ?? 0) >= 3 ? (
        <SocialProofRatingBlock
          avgRating={ratingsByRestaurantId[selected.restaurant.id]?.avgRating ?? 0}
          totalRatings={ratingsByRestaurantId[selected.restaurant.id]?.totalRatings ?? 0}
        />
      ) : null}
      {selected && (recipeSections.byRestaurantId[selected.restaurant.id] ?? []).length > 0 ? (
        <RecipeCards
          headingId={`passport-recipes-${selected.id}`}
          heading={RECIPES_SECTION_HEADING}
          exclusionLine={recipeSections.exclusionLine}
          recipes={recipeSections.byRestaurantId[selected.restaurant.id] ?? []}
        />
      ) : null}

      {quick ? (
        <QuickMemoryCard restaurantName={quick.restaurant.name} redemptionId={quick.id} />
      ) : null}

      {cuisines.length > 0 ? (
        <section aria-labelledby="cuisines-tried" className="flex flex-col gap-3">
          <h2 id="cuisines-tried" className="font-display m-0 text-[28px] leading-none text-wb-ink">
            Cuisines tried
          </h2>
          <div className="flex flex-wrap gap-2">
            {cuisines.map((chip) => (
              <span
                key={chip.key}
                className="rounded-full px-3.5 py-2 text-[13px] font-semibold"
                style={
                  chip.pending
                    ? { border: '1.5px dashed #d8cfbf', color: '#6b5f4b' }
                    : { background: '#f6f1e8', color: chip.color }
                }
              >
                {chip.label}
              </span>
            ))}
          </div>
        </section>
      ) : null}
    </PassportChrome>
  );
}
