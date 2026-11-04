'use client';

import { useCallback, useMemo, useState } from 'react';
import Map, { Marker, NavigationControl, Popup } from 'react-map-gl/maplibre';
import type { StyleSpecification } from 'maplibre-gl';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { PROGRESS_UNAVAILABLE_MESSAGE } from '@/lib/progress/rules';
import { shareOrCopy } from '@/lib/share';
import { BookMarked, Flame, Share2, Star, StarHalf } from 'lucide-react';
import type { BiteNoteRow } from '@/app/actions/bite-notes';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  roundAvgRatingToHalf,
  SocialProofRatingBlock,
} from '@/components/restaurant-social-proof';
import { RestaurantReviews } from '@/components/restaurants/restaurant-reviews';
import { RestaurantPhoto } from '@/components/restaurants/restaurant-photo';
import { LAUNCH_MARKET } from '@/lib/launch-market';
import { FocusVisitFromHash } from '@/components/notes/focus-visit';
import { MemoryEntryLink } from '@/components/notes/memory-entry';
import { NotePrivacyControl } from '@/components/notes/note-privacy';
import { RecipeCards } from '@/components/recipes/recipe-cards';
import { RECIPES_SECTION_HEADING, type RecipeSections } from '@/lib/recipes/display';
import { visitElementId } from '@/lib/notes/note-rules';
import { visitStatusLabel, type VisitStatus } from '@/lib/visits/visit-status';

import 'maplibre-gl/dist/maplibre-gl.css';

const BRAND_PIN = '#E85D26';

const LAUNCH: { longitude: number; latitude: number; zoom: number } = {
  longitude: LAUNCH_MARKET.centroid.lon,
  latitude: LAUNCH_MARKET.centroid.lat,
  zoom: 11,
};

const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  },
  layers: [
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};

export type PassportVisit = {
  id: string;
  verifiedAt: string;
  visitStatus: VisitStatus;
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

type MapMarker = {
  restaurantId: string;
  longitude: number;
  latitude: number;
  visit: PassportVisit;
};

export type PassportRestaurantRatings = Record<
  string,
  { avgRating: number; totalRatings: number }
>;

/** One row per bite note; grouped under `restaurant_id` for passport lookups. */
export type PassportBiteNoteEntry = Pick<
  BiteNoteRow,
  'id' | 'rating' | 'note' | 'restaurant_id' | 'redemption_id' | 'updated_at' | 'is_public'
>;

export type PassportBiteNotesByRestaurant = Record<
  string,
  PassportBiteNoteEntry[]
>;

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
  earnedBadges: { id: string; name: string; earnedOn: string | null }[];
  showFirstBiteLocked: boolean;
  recipeSections?: RecipeSections;
};

const PASSPORT_RETURN = '/journey?view=passport';

function biteNoteForVisit(
  visit: PassportVisit,
  byRestaurant: PassportBiteNotesByRestaurant
): PassportBiteNoteEntry | null {
  const list = byRestaurant[visit.restaurant.id];
  if (!list?.length) return null;
  return list.find((n) => n.redemption_id === visit.id) ?? null;
}

function truncateNote(text: string | null, maxLen: number): string | null {
  if (text == null || !text.trim()) return null;
  const t = text.trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

function UserStarRatingRow({ rating }: { rating: number }) {
  const n = Math.min(5, Math.max(1, Math.round(rating)));
  return (
    <div className="flex items-center gap-0.5" aria-label={`You rated ${n} out of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={
            i < n
              ? 'size-3.5 fill-amber-400 text-amber-400'
              : 'size-3.5 fill-transparent text-muted-foreground/35'
          }
          aria-hidden
        />
      ))}
    </div>
  );
}

function PassportVisitRestaurantPhoto({
  restaurant,
}: {
  restaurant: PassportVisit['restaurant'];
}) {
  return (
    <RestaurantPhoto
      restaurantId={restaurant.id}
      imageUrl={restaurant.image_url}
      googlePlaceId={restaurant.google_place_id}
    />
  );
}

function CommunityStarsCompact({ avgRating }: { avgRating: number }) {
  const rounded = roundAvgRatingToHalf(avgRating);
  const fullStars = Math.floor(rounded);
  const hasHalf = rounded - fullStars >= 0.5;
  const emptyStars = 5 - fullStars - (hasHalf ? 1 : 0);
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {Array.from({ length: fullStars }, (_, i) => (
        <Star key={`cf-${i}`} className="size-3.5 fill-amber-400 text-amber-400" />
      ))}
      {hasHalf ? (
        <StarHalf className="size-3.5 fill-amber-400 text-amber-400" />
      ) : null}
      {Array.from({ length: emptyStars }, (_, i) => (
        <Star
          key={`ce-${i}`}
          className="size-3.5 fill-transparent text-muted-foreground/35"
        />
      ))}
    </span>
  );
}

function hasCoords(v: PassportVisit): boolean {
  const { lat, lon } = v.restaurant;
  return (
    lat != null &&
    lon != null &&
    !Number.isNaN(Number(lat)) &&
    !Number.isNaN(Number(lon))
  );
}

function boundsFromPoints(
  points: { longitude: number; latitude: number }[]
): [[number, number], [number, number]] | null {
  if (points.length === 0) return null;
  let minLng = points[0].longitude;
  let maxLng = points[0].longitude;
  let minLat = points[0].latitude;
  let maxLat = points[0].latitude;
  for (const p of points) {
    minLng = Math.min(minLng, p.longitude);
    maxLng = Math.max(maxLng, p.longitude);
    minLat = Math.min(minLat, p.latitude);
    maxLat = Math.max(maxLat, p.latitude);
  }
  if (minLng === maxLng && minLat === maxLat) {
    const pad = 0.025;
    return [
      [minLng - pad, minLat - pad],
      [maxLng + pad, maxLat + pad],
    ];
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

function PinMarker({ selected }: { selected: boolean }) {
  return (
    <div
      className="size-5 cursor-pointer rounded-full border-[3px] border-white shadow-md ring-2 ring-black/10"
      style={{
        backgroundColor: BRAND_PIN,
        boxShadow: selected ? '0 0 0 4px rgba(232, 93, 38, 0.45)' : undefined,
      }}
      aria-hidden
    />
  );
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
  earnedBadges,
  showFirstBiteLocked,
  recipeSections = { exclusionLine: null, byRestaurantId: {} },
}: PassportClientProps) {
  const [popupVisitId, setPopupVisitId] = useState<string | null>(null);

  const streakPhrase = useMemo(
    () =>
      currentStreak === 1 ? '1 month streak' : `${currentStreak} months streak`,
    [currentStreak]
  );

  const mapMarkers: MapMarker[] = useMemo(() => {
    const seen = new Set<string>();
    const out: MapMarker[] = [];
    for (const v of visits) {
      if (!hasCoords(v)) continue;
      if (seen.has(v.restaurant.id)) continue;
      seen.add(v.restaurant.id);
      out.push({
        restaurantId: v.restaurant.id,
        longitude: Number(v.restaurant.lon),
        latitude: Number(v.restaurant.lat),
        visit: v,
      });
    }
    return out;
  }, [visits]);

  const bounds = useMemo(
    () => boundsFromPoints(mapMarkers.map((m) => ({ longitude: m.longitude, latitude: m.latitude }))),
    [mapMarkers]
  );

  const initialViewState = useMemo(() => {
    if (bounds) {
      return {
        bounds,
        fitBoundsOptions: { padding: 48, maxZoom: 15 },
      };
    }
    return {
      longitude: LAUNCH.longitude,
      latitude: LAUNCH.latitude,
      zoom: LAUNCH.zoom,
    };
  }, [bounds]);

  const handleShare = useCallback(async () => {
    const outcome = await shareOrCopy({
      title: 'My Wanderbite Food Passport',
      text: progressUnavailable
        ? 'My Wanderbite Food Passport'
        : neighborhoods == null
          ? `I've explored ${uniqueRestaurants} restaurants with Wanderbite 🍽️🔥 ${currentStreak} month streak and counting.`
          : `I've explored ${uniqueRestaurants} restaurants across ${neighborhoods} neighborhoods with Wanderbite 🍽️🔥 ${currentStreak} month streak and counting.`,
      url: 'https://wanderbite.com',
    });
    if (outcome === 'copied') {
      toast.success('Link copied to clipboard!');
    } else if (outcome === 'error') {
      toast.error('Could not share. Try copying the link manually.');
    }
  }, [currentStreak, neighborhoods, progressUnavailable, uniqueRestaurants]);

  const popupVisit = popupVisitId
    ? mapMarkers.find((m) => m.visit.id === popupVisitId)?.visit
    : null;

  const popupBiteNote = popupVisit
    ? biteNoteForVisit(popupVisit, biteNotesByRestaurantId)
    : null;
  const popupCommunity = popupVisit
    ? ratingsByRestaurantId[popupVisit.restaurant.id]
    : null;
  const popupShowCommunity =
    popupCommunity != null && popupCommunity.totalRatings >= 3;

  const badgeSummary =
    earnedBadges.length > 0
      ? earnedBadges
          .map((badge) => (badge.earnedOn ? `${badge.name} · ${badge.earnedOn}` : badge.name))
          .join(', ')
      : showFirstBiteLocked
        ? 'First Bite locked'
        : 'No badge yet';

  const badgeRow = progressUnavailable ? (
    <p className="mt-2 text-sm text-muted-foreground">{PROGRESS_UNAVAILABLE_MESSAGE}</p>
  ) : (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Flame
        className={`size-5 shrink-0 ${earnedBadges.length > 0 ? 'text-[#E85D26]' : 'text-muted-foreground'}`}
        aria-hidden
      />
      {earnedBadges.length > 0 ? (
        earnedBadges.map((badge) => (
          <Badge
            key={badge.id}
            variant="secondary"
            className="border-[#E85D26]/30 bg-[#E85D26]/10 text-sm font-medium text-[#E85D26]"
          >
            {badge.name}
            {badge.earnedOn ? ` · ${badge.earnedOn}` : ''}
          </Badge>
        ))
      ) : (
        <span className="text-sm text-muted-foreground">
          {showFirstBiteLocked
            ? 'First Bite locked'
            : 'No badge yet — verify a visit this month to grow your streak'}
        </span>
      )}
    </div>
  );

  const statBar = progressUnavailable ? (
    <p className="text-sm text-muted-foreground">{PROGRESS_UNAVAILABLE_MESSAGE}</p>
  ) : (
    <div className="space-y-1.5">
      <div className="rounded-lg border bg-muted/30 px-4 py-3 text-center text-sm font-medium leading-relaxed text-foreground md:text-left">
        <span className="text-[#E85D26]">{uniqueRestaurants}</span> restaurants
        visited ·{' '}
        <span className="text-[#E85D26]">{neighborhoods == null ? '—' : neighborhoods}</span>{' '}
        neighborhoods ·{' '}
        <span className="text-[#E85D26]">{streakPhrase}</span>
        {' · '}
        <span className="text-[#E85D26]">{badgeSummary}</span>
      </div>
      {longestStreak >= 1 ? (
        <p className="text-center text-xs text-muted-foreground md:text-left">
          Longest streak: {longestStreak}{' '}
          {longestStreak === 1 ? 'month' : 'months'}
        </p>
      ) : null}
    </div>
  );

  if (visits.length === 0) {
    return (
      <div className="space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[#E85D26]">
              <BookMarked className="size-8 shrink-0" aria-hidden />
              <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
                {userDisplayName}&apos;s Passport
              </h1>
            </div>
            {badgeRow}
            <p className="text-muted-foreground">
              Your map of Wanderbite dining adventures.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="shrink-0 gap-2 self-start border-[#E85D26]/40 text-[#E85D26] hover:bg-[#E85D26]/10"
            onClick={handleShare}
          >
            <Share2 className="size-4" aria-hidden />
            Share My Passport
          </Button>
        </header>
        {statBar}
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-muted-foreground">
            Your passport is empty — complete your first challenge to start your food
            story
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <FocusVisitFromHash />
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[#E85D26]">
            <BookMarked className="size-8 shrink-0" aria-hidden />
            <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
              {userDisplayName}&apos;s Passport
            </h1>
          </div>
          {badgeRow}
          <p className="text-muted-foreground">
            Every place you&apos;ve tasted through Wanderbite challenges.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="shrink-0 gap-2 self-start border-[#E85D26]/40 text-[#E85D26] hover:bg-[#E85D26]/10 sm:self-auto"
          onClick={handleShare}
        >
          <Share2 className="size-4" aria-hidden />
          Share My Passport
        </Button>
      </header>

      {statBar}

      <Card className="overflow-hidden p-0">
        <div className="h-[min(420px,55vh)] w-full md:h-[480px]">
          <Map
            initialViewState={initialViewState}
            mapStyle={OSM_STYLE}
            style={{ width: '100%', height: '100%' }}
            reuseMaps
            onClick={() => setPopupVisitId(null)}
          >
            <NavigationControl position="top-right" showCompass={false} />
            {mapMarkers.map((m) => (
              <Marker
                key={m.restaurantId}
                longitude={m.longitude}
                latitude={m.latitude}
                anchor="center"
                onClick={(e) => {
                  e.originalEvent.stopPropagation();
                  setPopupVisitId(m.visit.id);
                }}
              >
                <PinMarker selected={popupVisitId === m.visit.id} />
              </Marker>
            ))}
            {popupVisit && hasCoords(popupVisit) && (
              <Popup
                longitude={Number(popupVisit.restaurant.lon)}
                latitude={Number(popupVisit.restaurant.lat)}
                anchor="top"
                onClose={() => setPopupVisitId(null)}
                closeButton
                closeOnClick={false}
                maxWidth="280px"
              >
                <div className="space-y-2 p-1 text-sm">
                  <p className="font-semibold text-foreground">
                    {popupVisit.restaurant.name}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {(popupVisit.restaurant.cuisine_tags ?? []).map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  {popupVisit.restaurant.neighborhood && (
                    <p className="text-muted-foreground">
                      {popupVisit.restaurant.neighborhood}
                    </p>
                  )}
                  {popupBiteNote ? (
                    <div className="space-y-1 border-t border-border pt-2">
                      <UserStarRatingRow rating={popupBiteNote.rating} />
                      {truncateNote(popupBiteNote.note, 80) ? (
                        <p className="text-xs leading-snug text-muted-foreground">
                          {truncateNote(popupBiteNote.note, 80)}
                        </p>
                      ) : null}
                      <NotePrivacyControl
                        noteId={popupBiteNote.id}
                        isPublic={popupBiteNote.is_public}
                      />
                    </div>
                  ) : null}
                  <MemoryEntryLink
                    status={popupVisit.visitStatus}
                    redemptionId={popupVisit.id}
                    returnTo={PASSPORT_RETURN}
                  />
                  {popupShowCommunity && popupCommunity ? (
                    <div className="space-y-1 border-t border-border pt-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Community
                      </p>
                      <SocialProofRatingBlock
                        avgRating={popupCommunity.avgRating}
                        totalRatings={popupCommunity.totalRatings}
                      />
                    </div>
                  ) : null}
                  <p className="text-xs font-medium text-foreground" data-visit-status={popupVisit.visitStatus}>
                    {visitStatusLabel(popupVisit.visitStatus)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Visited{' '}
                    {format(new Date(popupVisit.verifiedAt), 'MMM d, yyyy')}
                  </p>
                </div>
              </Popup>
            )}
          </Map>
        </div>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Your visits</h2>
        <div className="grid max-h-[520px] grid-cols-1 gap-4 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
          {visits.map((v) => (
            <Card
              key={v.id}
              id={visitElementId(v.id) ?? undefined}
              tabIndex={visitElementId(v.id) ? -1 : undefined}
              className="scroll-mt-24 overflow-hidden outline-none"
            >
              <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted">
                <PassportVisitRestaurantPhoto restaurant={v.restaurant} />
              </div>
              <CardHeader className="pb-2">
                <CardTitle className="text-base leading-snug">
                  {v.restaurant.name}
                </CardTitle>
                {v.restaurant.neighborhood && (
                  <CardDescription>{v.restaurant.neighborhood}</CardDescription>
                )}
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                <div className="flex flex-wrap gap-1">
                  {(v.restaurant.cuisine_tags ?? []).length ? (
                    (v.restaurant.cuisine_tags ?? []).map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">No tags</span>
                  )}
                </div>
                {(() => {
                  const mine = biteNoteForVisit(v, biteNotesByRestaurantId);
                  const community = ratingsByRestaurantId[v.restaurant.id];
                  const showCommunity =
                    community != null && community.totalRatings >= 3;
                  const preview = mine ? truncateNote(mine.note, 80) : null;

                  if (!mine && showCommunity && community) {
                    return (
                      <div className="space-y-2">
                        <SocialProofRatingBlock
                          avgRating={community.avgRating}
                          totalRatings={community.totalRatings}
                        />
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-2">
                      {mine || showCommunity ? (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                          {mine ? (
                            <span className="inline-flex flex-wrap items-center gap-1.5">
                              <span className="text-muted-foreground">You rated:</span>
                              <UserStarRatingRow rating={mine.rating} />
                            </span>
                          ) : null}
                          {mine && showCommunity ? (
                            <span className="text-muted-foreground" aria-hidden>
                              ·
                            </span>
                          ) : null}
                          {mine && showCommunity && community ? (
                            <span className="inline-flex flex-wrap items-center gap-1.5">
                              <span className="text-muted-foreground">Community:</span>
                              <CommunityStarsCompact avgRating={community.avgRating} />
                              <span className="text-muted-foreground">
                                {community.totalRatings} Wanderbiters visited
                              </span>
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      {preview ? (
                        <p className="text-xs leading-snug text-muted-foreground">
                          {preview}
                        </p>
                      ) : null}
                      {mine ? (
                        <NotePrivacyControl noteId={mine.id} isPublic={mine.is_public} />
                      ) : null}
                    </div>
                  );
                })()}
                <RestaurantReviews restaurantId={v.restaurant.id} className="pt-1" />
                <MemoryEntryLink
                  status={v.visitStatus}
                  redemptionId={v.id}
                  returnTo={PASSPORT_RETURN}
                />
                <p className="text-sm font-medium text-foreground" data-visit-status={v.visitStatus}>
                  {visitStatusLabel(v.visitStatus)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(v.verifiedAt), 'MMM d, yyyy')}
                </p>
                <RecipeCards
                  headingId={`passport-recipes-${v.id}`}
                  heading={RECIPES_SECTION_HEADING}
                  exclusionLine={recipeSections.exclusionLine}
                  recipes={recipeSections.byRestaurantId[v.restaurant.id] ?? []}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
