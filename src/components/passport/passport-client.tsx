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
  stampKind,
  stampRotationDegrees,
} from '@/lib/passport/passport-board';
import { RECIPES_SECTION_HEADING, type RecipeSections } from '@/lib/recipes/display';
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
};

const CITY = LAUNCH_MARKET.displayName.split(',')[0] ?? 'McKinney';

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

  const empty = stamps.length === 0 && pending.length === 0;

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
      <section
        aria-labelledby="stamp-page"
        className="flex flex-col gap-4 rounded-[26px] border border-[#ece2d0] px-3 py-5 shadow-[0_14px_34px_rgba(42,20,66,0.08)] sm:px-4"
        style={{
          background:
            'repeating-linear-gradient(0deg, #fffdf8 0px, #fffdf8 27px, #f3ece0 27px, #f3ece0 28px)',
        }}
      >
        <div className="flex items-baseline justify-between gap-3 px-1">
          <h2 id="stamp-page" className="font-display m-0 text-[30px] leading-none text-wb-ink">
            {CITY} · Page 1
          </h2>
          {pageYear ? (
            <span className="text-[11px] font-bold tracking-[1.6px] text-[#6b5f4b]">{pageYear}</span>
          ) : null}
        </div>
        {empty ? (
          <p className="m-0 px-1 text-sm text-wb-muted" data-passport-empty="">
            Your passport is empty. A visit shows up here after it is verified.
          </p>
        ) : null}
        <div className="grid grid-cols-2 justify-items-center gap-x-2 gap-y-6 sm:grid-cols-4">
          {stamps.map((visit, index) => {
            const ink = cuisineInk(visit.restaurant.cuisine_tags);
            const rotation = stampRotationDegrees(visit.id);
            const short = faceDate(visit);
            const neighborhood = visit.restaurant.neighborhood?.trim() ?? '';
            return (
              <div key={visit.id} className="flex flex-col items-center gap-1">
                <Stamp
                  name={visit.restaurant.name}
                  date={short || '—'}
                  accessibleDate={spokenDate(visit)}
                  neighborhood={neighborhood}
                  inkColor={ink.color}
                  shape={index === 0 ? 'rect' : 'round'}
                  rotation={rotation}
                  newest={index === 0}
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
          {pending.map((visit) => (
            <PendingStamp key={visit.id} name={visit.restaurant.name} />
          ))}
          <EmptyStampSlot href="/challenges" challengeName="Challenges" />
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
