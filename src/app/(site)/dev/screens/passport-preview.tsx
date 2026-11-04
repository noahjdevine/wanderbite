import { PassportClient, type PassportVisit } from '@/components/passport/passport-client';
import { PassportMapScreen } from '@/components/passport/passport-map-screen';
import { PassportChrome } from '@/components/passport/passport-chrome';
import { chicagoVisitDate } from '@/lib/passport/passport-board';
import type { VisitStatus } from '@/lib/visits/visit-status';

/** Nov 3, 2026, 6:00 PM America/Chicago. Fixed so the gallery does not read the clock. */
const SAMPLE_NOW = '2026-11-04T00:00:00.000Z';

const YARD = '22222222-2222-4222-8222-222222222222';
const CADILLAC = '33333333-3333-4333-8333-333333333333';
const ZEN = '44444444-4444-4444-8444-444444444444';
const EXPIRED = '55555555-5555-4555-8555-555555555555';

function sampleVisit(input: {
  id: string;
  name: string;
  neighborhood: string;
  cuisine: string[];
  status: VisitStatus;
  verifiedAt: string;
  redemptionStatus: string;
  lat?: number | null;
  lon?: number | null;
}): PassportVisit {
  const dated = chicagoVisitDate(input.verifiedAt);
  return {
    id: input.id,
    verifiedAt: input.verifiedAt,
    visitStatus: input.status,
    redemptionStatus: input.redemptionStatus,
    verifiedOnShort: dated?.short ?? null,
    verifiedOnLong: dated?.long ?? null,
    chicagoMonth: dated?.month ?? null,
    restaurant: {
      id: `rest-${input.id}`,
      name: input.name,
      address: null,
      lat: input.lat ?? null,
      lon: input.lon ?? null,
      cuisine_tags: input.cuisine,
      neighborhood: input.neighborhood,
      image_url: null,
      google_place_id: null,
    },
  };
}

export function PassportPreview() {
  const pageYear = chicagoVisitDate(SAMPLE_NOW)?.year;
  const visits = [
    sampleVisit({
      id: YARD,
      name: 'The Yard',
      neighborhood: 'Downtown',
      cuisine: ['American'],
      status: 'note_added',
      verifiedAt: '2026-04-26T18:00:00.000Z',
      redemptionStatus: 'verified',
    }),
    sampleVisit({
      id: CADILLAC,
      name: 'Cadillac Pizza Pub',
      neighborhood: 'Downtown',
      cuisine: ['Pizza'],
      status: 'verified',
      verifiedAt: '2026-11-01T04:30:00.000Z',
      redemptionStatus: 'verified',
    }),
    sampleVisit({
      id: ZEN,
      name: 'Zen Sushi',
      neighborhood: 'Stonebridge',
      cuisine: ['Sushi'],
      status: 'code_issued',
      verifiedAt: '',
      redemptionStatus: 'issued',
    }),
    sampleVisit({
      id: EXPIRED,
      name: 'Expired Code Grill',
      neighborhood: 'Downtown',
      cuisine: ['American'],
      status: 'code_expired',
      verifiedAt: '',
      redemptionStatus: 'expired',
    }),
  ];

  return (
    <PassportClient
      userDisplayName="Noah"
      visits={visits}
      ratingsByRestaurantId={{}}
      biteNotesByRestaurantId={{
        [`rest-${YARD}`]: [
          {
            id: '66666666-6666-4666-8666-666666666666',
            redemption_id: YARD,
            restaurant_id: `rest-${YARD}`,
            rating: 5,
            note: 'Amazing outdoor atmosphere and great service!',
            updated_at: '2026-04-26T20:00:00.000Z',
            is_public: false,
          },
        ],
      }}
      currentStreak={2}
      longestStreak={2}
      totalMonthsActive={2}
      uniqueRestaurants={2}
      neighborhoods={1}
      verifiedVisits={2}
      pendingVisits={1}
      earnedBadges={[{ id: 'first_bite', name: 'First Bite', earnedOn: 'Earned on Feb 2, 2026' }]}
      showFirstBiteLocked={false}
      pageYear={pageYear}
    />
  );
}

const MISSING = '66666666-6666-4666-8666-666666666666';

export function MapPreview() {
  const pageYear = chicagoVisitDate(SAMPLE_NOW)?.year;
  const visits = [
    sampleVisit({
      id: YARD,
      name: 'The Yard',
      neighborhood: 'Downtown',
      cuisine: ['American'],
      status: 'note_added',
      verifiedAt: '2026-04-26T18:00:00.000Z',
      redemptionStatus: 'verified',
      lat: 33.1972,
      lon: -96.6154,
    }),
    sampleVisit({
      id: CADILLAC,
      name: 'Cadillac Pizza Pub',
      neighborhood: 'Stonebridge',
      cuisine: ['Pizza'],
      status: 'verified',
      verifiedAt: '2026-11-01T04:30:00.000Z',
      redemptionStatus: 'verified',
      lat: 33.1584,
      lon: -96.6988,
    }),
    sampleVisit({
      id: ZEN,
      name: 'Zen Sushi',
      neighborhood: 'Craig Ranch',
      cuisine: ['Sushi'],
      status: 'code_issued',
      verifiedAt: '',
      redemptionStatus: 'issued',
      lat: 33.21,
      lon: -96.73,
    }),
    sampleVisit({
      id: MISSING,
      name: 'Hidden Grill',
      neighborhood: 'Downtown',
      cuisine: ['Mediterranean'],
      status: 'verified',
      verifiedAt: '2026-08-15T18:00:00.000Z',
      redemptionStatus: 'verified',
    }),
  ];

  return (
    <PassportMapScreen
      userDisplayName="Noah"
      segment="map"
      visits={visits}
      ratingsByRestaurantId={{}}
      biteNotesByRestaurantId={{}}
      currentStreak={2}
      longestStreak={2}
      totalMonthsActive={2}
      uniqueRestaurants={3}
      neighborhoods={2}
      exploredNeighborhoods={2}
      partnerNeighborhoods={4}
      verifiedVisits={3}
      pendingVisits={1}
      earnedBadges={[{ id: 'first_bite', name: 'First Bite', earnedOn: 'Earned on Apr 26, 2026' }]}
      showFirstBiteLocked={false}
      pageYear={pageYear}
    />
  );
}

export function TimelinePreview() {
  return (
    <PassportChrome
      displayName="Noah"
      segment="timeline"
      progressUnavailable={false}
      verifiedVisits={2}
      uniqueRestaurants={2}
      neighborhoods={1}
      currentStreak={2}
      longestStreak={2}
      pendingVisits={1}
      earnedBadges={[{ id: 'first_bite', name: 'First Bite', earnedOn: 'Earned on Feb 2, 2026' }]}
      showFirstBiteLocked={false}
      retryHref="/journey?view=journal"
    >
      <header className="space-y-2">
        <h2 className="font-display m-0 text-[30px] text-wb-ink">Timeline</h2>
        <p className="m-0 text-sm text-wb-muted">Your dining memories. You choose which ones to share.</p>
      </header>
      <ul className="m-0 flex list-none flex-col gap-4 p-0">
        <li>
          <article className="rounded-[26px] bg-white p-4 shadow-[0_14px_34px_rgba(42,20,66,0.08)]">
            <h3 className="font-display m-0 text-[28px] leading-none text-wb-ink">The Yard</h3>
            <p className="m-0 mt-1 text-[13px] text-wb-muted">April 26, 2026 · Downtown</p>
            <p className="mt-3">
              <span data-visit-status="note_added" className="inline-flex rounded-full bg-[#dcfce7] px-2.5 py-1 text-xs font-bold text-[#14532d]">
                Note added
              </span>
            </p>
            <p className="font-display mt-3 text-[22px] text-wb-plum italic">“Amazing outdoor atmosphere and great service!”</p>
          </article>
        </li>
        <li>
          <article className="rounded-[26px] bg-white p-4 shadow-[0_14px_34px_rgba(42,20,66,0.08)]">
            <h3 className="font-display m-0 text-[28px] leading-none text-wb-ink">Cadillac Pizza Pub</h3>
            <p className="m-0 mt-1 text-[13px] text-wb-muted">October 31, 2026 · Downtown</p>
            <p className="mt-3">
              <span data-visit-status="verified" className="inline-flex rounded-full bg-[#dcfce7] px-2.5 py-1 text-xs font-bold text-[#14532d]">
                Verified
              </span>
            </p>
          </article>
        </li>
      </ul>
    </PassportChrome>
  );
}
