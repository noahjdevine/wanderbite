import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WANDERER_BADGE_DESCRIPTION } from '@/lib/progress/badge-copy';
import {
  assembleBadges,
  badgeIdsEarnedByVerifiedVisits,
} from '@/lib/progress/rules';

const ROOT = path.resolve(__dirname, '../../..');
const HAT_TRICK = 'Verified three restaurant visits.';

describe('wanderer copy', () => {
  it('still awards wanderer and hat trick at three verified visits', () => {
    expect(badgeIdsEarnedByVerifiedVisits(2)).not.toContain('wanderer');
    expect(badgeIdsEarnedByVerifiedVisits(2)).not.toContain('hat_trick');
    expect(badgeIdsEarnedByVerifiedVisits(3)).toEqual(
      expect.arrayContaining(['hat_trick', 'wanderer']),
    );
    const sameRestaurantVisits = ['2026-01-02T18:00:00.000Z', '2026-02-02T18:00:00.000Z', '2026-03-02T18:00:00.000Z'];
    const badges = assembleBadges({
      catalog: [
        { id: 'hat_trick', name: 'Hat Trick', description: HAT_TRICK, icon: '✨' },
        {
          id: 'wanderer',
          name: 'The Wanderer',
          description: WANDERER_BADGE_DESCRIPTION,
          icon: '🧭',
        },
      ],
      awardedAtById: new Map(),
      verifiedVisits: sameRestaurantVisits.length,
      verifiedAtAsc: sameRestaurantVisits,
    });
    expect(badges.find((badge) => badge.id === 'wanderer')).toMatchObject({
      description: 'Explored with three verified visits.',
      progress: { current: 3, target: 3 },
      earnedAt: sameRestaurantVisits[2],
    });
    expect(badges.find((badge) => badge.id === 'hat_trick')).toMatchObject({
      description: HAT_TRICK,
      progress: { current: 3, target: 3 },
    });
    const short = assembleBadges({
      catalog: [
        {
          id: 'wanderer',
          name: 'The Wanderer',
          description: WANDERER_BADGE_DESCRIPTION,
          icon: '🧭',
        },
      ],
      awardedAtById: new Map(),
      verifiedVisits: 2,
      verifiedAtAsc: sameRestaurantVisits.slice(0, 2),
    });
    expect(short[0]).toMatchObject({
      earnedAt: null,
      progress: { current: 2, target: 3 },
      description: WANDERER_BADGE_DESCRIPTION,
    });
  });

  it('stores the new sentence in a new migration and leaves hat trick', () => {
    const sql = readFileSync(
      path.join(ROOT, 'supabase/migrations/20261114153626_e09_wanderer_badge_copy.sql'),
      'utf8',
    );
    expect(sql).toContain(WANDERER_BADGE_DESCRIPTION);
    expect(sql).toContain("where id = 'wanderer'");
    expect(sql).not.toMatch(/update\s+public\.badges[\s\S]*hat_trick/i);
    expect(WANDERER_BADGE_DESCRIPTION).not.toBe(HAT_TRICK);
    const preview = readFileSync(
      path.join(ROOT, 'src/app/(site)/dev/screens/progress-preview.tsx'),
      'utf8',
    );
    expect(preview).toContain('WANDERER_BADGE_DESCRIPTION');
    expect(preview).not.toContain('Three neighborhoods');
    expect(preview).toContain("description: 'Three verified visits'");
  });
});
