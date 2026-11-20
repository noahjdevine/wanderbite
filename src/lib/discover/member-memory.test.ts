import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { memoryStepLine } from '@/lib/discover/events';
import {
  isNewToMember,
  memberVisitMemory,
  preferUnvisitedRestaurants,
  storedRedemptionCountsAsVisit,
} from '@/lib/discover/member-memory';

const ROOT = path.resolve(__dirname, '../../..');

const pool = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Bravo' },
  { id: 'c', name: 'Charlie' },
];

describe('verified visit definition', () => {
  it('counts only a stored verified redemption', () => {
    expect(storedRedemptionCountsAsVisit('verified')).toBe(true);
    expect(storedRedemptionCountsAsVisit('issued')).toBe(false);
    expect(storedRedemptionCountsAsVisit('expired')).toBe(false);
    expect(storedRedemptionCountsAsVisit('note_added')).toBe(false);
    expect(storedRedemptionCountsAsVisit(null)).toBe(false);
    expect(storedRedemptionCountsAsVisit('')).toBe(false);
  });
});

describe('member visit memory', () => {
  it('labels a restaurant the member has not visited', () => {
    expect(isNewToMember('a', new Set())).toBe(true);
    expect(isNewToMember('a', new Set(['b']))).toBe(true);
    expect(memberVisitMemory({ id: 'a', name: '  Alpha  ' }, new Set(['b']))).toEqual({
      isNewToMember: true,
      line: "You haven't been to Alpha yet.",
    });
    expect(memoryStepLine('Alpha', true)).toBe("You haven't been to Alpha yet.");
  });

  it('labels a previous verified visit without a date, rating, or note', () => {
    expect(isNewToMember('a', new Set(['a']))).toBe(false);
    const memory = memberVisitMemory({ id: 'a', name: 'Alpha' }, new Set(['a', 'a']));
    expect(memory).toEqual({
      isNewToMember: false,
      line: "You've been here before.",
    });
    expect(memory?.line).not.toMatch(/\d|rating|note/i);
  });

  it('omits memory when the visit set is unknown', () => {
    expect(memberVisitMemory({ id: 'a', name: 'Alpha' }, null)).toBeNull();
    expect(memberVisitMemory({ id: 'a', name: 'Alpha' }, undefined)).toBeNull();
  });

  it('treats an empty visit set as new to the member', () => {
    expect(memberVisitMemory({ id: 'a', name: '' }, new Set())).toEqual({
      isNewToMember: true,
      line: "You haven't been here yet.",
    });
  });
});

describe('prefer unvisited restaurants', () => {
  it('keeps unvisited partners in pool order', () => {
    expect(preferUnvisitedRestaurants(pool, new Set(['b'])).map((row) => row.id)).toEqual([
      'a',
      'c',
    ]);
    expect(preferUnvisitedRestaurants(pool, new Set()).map((row) => row.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('returns the same pool when every remaining partner is visited', () => {
    const visited = preferUnvisitedRestaurants(pool, new Set(['a', 'b', 'c']));
    expect(visited).toBe(pool);
  });

  it('returns an empty pool unchanged', () => {
    const empty: typeof pool = [];
    expect(preferUnvisitedRestaurants(empty, new Set(['a']))).toBe(empty);
  });

  it('does not bring back an id that is not in the pool', () => {
    const narrowed = [pool[0]!, pool[2]!];
    expect(preferUnvisitedRestaurants(narrowed, new Set(['a'])).map((row) => row.id)).toEqual([
      'c',
    ]);
    const allVisited = preferUnvisitedRestaurants(
      narrowed,
      new Set(['a', 'c', 'excluded-earlier']),
    );
    expect(allVisited).toBe(narrowed);
    expect(allVisited.map((row) => row.id)).not.toContain('excluded-earlier');
  });
});

describe('discover turn visit wiring', () => {
  it('reads visits beside facts and biases only the fallback pick', () => {
    const turn = readFileSync(path.join(ROOT, 'src/lib/discover/turn.ts'), 'utf8');
    const visits = readFileSync(path.join(ROOT, 'src/lib/discover/member-visits.ts'), 'utf8');
    const exclusion = turn.indexOf('applyRestaurantExclusion(restaurants, excludeRestaurantIds)');
    const parallel = turn.indexOf('loadMemberVisitedRestaurantIds(admin, userId, restaurantIds)');
    const prompt = turn.indexOf('systemPrompt = `You choose one restaurant id');
    const modelPick = turn.indexOf(
      'const cardRestaurant = codePickRestaurant ?? chosen ?? pickRandom(fallbackPool())',
    );
    expect(exclusion).toBeGreaterThan(0);
    expect(parallel).toBeGreaterThan(exclusion);
    expect(prompt).toBeGreaterThan(parallel);
    expect(modelPick).toBeGreaterThan(prompt);
    expect(turn).toContain('shuffleArray(restaurants)');
    expect(turn).toContain('loadMemberVisitedRestaurantIds(admin, userId, restaurantIds)');
    expect(turn).not.toContain('preferUnvisitedRestaurants(promptRows');
    expect(visits).toContain(".select(VISIT_COLUMNS)");
    expect(visits).toContain("const VISIT_COLUMNS = 'restaurant_id, status'");
    expect(visits).toContain(".eq('user_id', userId)");
    expect(visits).toContain(".eq('status', 'verified')");
    expect(visits).toContain(".in('restaurant_id', ids)");
    expect(visits).not.toMatch(/\.select\([^)]*verified_at/);
    expect(visits).not.toContain('bite_notes');
    expect(visits).not.toContain("from('restaurant_ratings')");
  });
});
