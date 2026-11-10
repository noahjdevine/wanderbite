import { ProgressView } from '@/components/journey/progress-view';
import { buildProgressModel, noPairCta, type ProgressAdventure } from '@/lib/progress/progress-board';
import type { MemberProgress } from '@/lib/progress/get-member-progress';
import { RESTAURANT_IMAGE_PLACEHOLDER } from '@/lib/restaurant-image';

/** Nov 3, 2026, 6:00 PM America/Chicago. Fixed so the gallery does not read the clock. */
const SAMPLE_NOW = new Date('2026-11-04T00:00:00.000Z');

const adventures: ProgressAdventure[] = [
  {
    id: 'red-zen',
    redemptionId: '11111111-1111-4111-8111-111111111111',
    restaurantName: 'Zen Sushi & Grill',
    neighborhood: 'Stonebridge',
    imageUrl: RESTAURANT_IMAGE_PLACEHOLDER,
    visitStatus: 'code_issued',
    occurredAt: '2026-11-03T18:00:00.000Z',
    verifiedAt: null,
    expiresAt: '2026-11-03T18:15:00.000Z',
    deadline: '2026-12-08T18:00:00.000Z',
    slotNumber: 2,
  },
  {
    id: 'red-yard',
    redemptionId: '22222222-2222-4222-8222-222222222222',
    restaurantName: 'The Yard',
    neighborhood: 'Downtown',
    imageUrl: RESTAURANT_IMAGE_PLACEHOLDER,
    visitStatus: 'note_added',
    occurredAt: '2026-04-26T18:00:00.000Z',
    verifiedAt: '2026-04-26T18:00:00.000Z',
    expiresAt: '2026-04-26T18:15:00.000Z',
    deadline: null,
    slotNumber: 1,
  },
  {
    id: 'red-cadillac',
    redemptionId: '33333333-3333-4333-8333-333333333333',
    restaurantName: 'Cadillac Pizza Pub',
    neighborhood: 'Downtown',
    imageUrl: RESTAURANT_IMAGE_PLACEHOLDER,
    visitStatus: 'verified',
    occurredAt: '2026-02-02T18:00:00.000Z',
    verifiedAt: '2026-02-02T18:00:00.000Z',
    expiresAt: '2026-02-02T18:15:00.000Z',
    deadline: null,
    slotNumber: 2,
  },
];

const progress: Exclude<MemberProgress, { error: 'progress_unavailable' }> = {
  verifiedVisits: 2,
  pendingVisits: 1,
  uniqueRestaurants: 2,
  neighborhoods: 1,
  currentMonthlyStreak: 0,
  longestStreak: 1,
  totalMonthsActive: 2,
  xp: 200,
  level: 0,
  nextLevel: { level: 1, name: 'The Explorer', xp: 300 },
  badges: [
    {
      id: 'first_bite',
      name: 'First Bite',
      earnedAt: '2026-02-02T18:00:00.000Z',
      progress: { current: 1, target: 1 },
      description: 'First verified visit',
      icon: '🍴',
    },
    {
      id: 'hat_trick',
      name: 'Hat Trick',
      earnedAt: null,
      progress: { current: 2, target: 3 },
      description: 'Three verified visits',
      icon: '🍽️',
    },
    {
      id: 'high_five',
      name: 'High Five',
      earnedAt: null,
      progress: { current: 2, target: 5 },
      description: 'Five verified visits',
      icon: '✋',
    },
    {
      id: 'wanderer',
      name: 'Wanderer',
      earnedAt: null,
      progress: { current: 1, target: 3 },
      description: 'Three neighborhoods',
      icon: '🚲',
    },
  ],
  savings: { amount: 20, isEstimate: true, corrected: false },
};

export function ProgressPreview() {
  const model = buildProgressModel({
    progress,
    headerLabel: 'Noah',
    now: SAMPLE_NOW,
    activity: {
      ok: true,
      hasPair: true,
      adventures,
      noPair: noPairCta({
        launchEligible: true,
        creditsWorkflow: false,
        pendingCreditsCount: 0,
        generateBlocked: false,
      }),
    },
  });

  return (
    <div>
      <p className="bg-wb-night m-0 px-5 py-2 text-center text-xs text-white/70">
        Sample progress data for the dev gallery. Not a member account.
      </p>
      <ProgressView model={model} />
    </div>
  );
}
