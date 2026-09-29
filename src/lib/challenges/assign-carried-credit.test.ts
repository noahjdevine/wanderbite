import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assignCarriedUserMessage,
  shouldInvokeAssignRpc,
} from '@/lib/challenges/assign-carried-gate';
import { filterCarriedAssignCandidates } from '@/lib/challenges/carried-assign-pool';
import { passesRestaurantHardFilters } from '@/lib/challenges/restaurant-safety';

const ROOT = path.resolve(__dirname, '../../..');

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      walk(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

describe('carried assignment caller', () => {
  it('is called only from the assign action, and cron stays clear', () => {
    const callers: string[] = [];
    for (const rel of ['src/app', 'src/lib']) {
      for (const file of walk(path.join(ROOT, rel))) {
        if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
        if (!readFileSync(file, 'utf8').includes('assign_carried_credit')) continue;
        callers.push(path.relative(ROOT, file).split(path.sep).join('/'));
      }
    }
    expect(callers).toEqual(['src/app/actions/assign-carried-credit.ts']);

    expect(source('src/app/actions/swap-challenge.ts')).toContain("rpc('swap_linked_credit_item'");
    expect(source('src/app/actions/swap-challenge.ts')).not.toContain(
      'Swaps are not available for this account yet.',
    );
    const challenges = source('src/app/(site)/challenges/page.tsx');
    expect(challenges).toContain(".eq('issue_period', chicagoMonthStart())");
    expect(challenges).toContain(".eq('status', 'pending')");
    expect(challenges).not.toContain('assign_carried_credit');
    expect(source('vercel.json')).not.toContain('assign_carried_credit');
    expect(source('src/lib/schema-contract.ts')).not.toContain('assign_carried_credit');
  });

  it('maps linked and existing to success and does not require pending before the RPC', () => {
    const month = '2026-10-01';
    expect(shouldInvokeAssignRpc({ status: 'pending', issuePeriod: '2026-08-01' }, month)).toBe(true);
    expect(shouldInvokeAssignRpc({ status: 'linked', issuePeriod: '2026-08-01' }, month)).toBe(true);
    expect(shouldInvokeAssignRpc({ status: 'pending', issuePeriod: '2026-10-01' }, month)).toBe(false);
    expect(shouldInvokeAssignRpc({ status: 'expired', issuePeriod: '2026-08-01' }, month)).toBe(false);
    expect(assignCarriedUserMessage('linked')).toBeNull();
    expect(assignCarriedUserMessage('existing')).toBeNull();
    expect(assignCarriedUserMessage('below_floor')).toContain('$20');
    expect(assignCarriedUserMessage('capacity_full')).toBeTruthy();
    expect(assignCarriedUserMessage('duplicate_restaurant')).toBeTruthy();
    expect(assignCarriedUserMessage('carried_due')).toBeTruthy();
    expect(assignCarriedUserMessage('not_carried')).toBeTruthy();

    const action = source('src/app/actions/assign-carried-credit.ts');
    const rpcAt = action.indexOf("rpc('assign_carried_credit'");
    expect(rpcAt).toBeGreaterThan(-1);
    expect(action.indexOf('passesRestaurantHardFilters')).toBeGreaterThan(-1);
    expect(action.indexOf('passesRestaurantHardFilters')).toBeLessThan(rpcAt);
    expect(action.indexOf('shouldInvokeAssignRpc')).toBeLessThan(rpcAt);
    expect(action.indexOf('filterCarriedAssignCandidates')).toBeLessThan(rpcAt);
    expect(action).toContain("revalidatePath('/challenges')");
    expect(action).toContain('assignCarriedUserMessage');
    expect(action).not.toContain("status !== 'pending'");
    expect(action).not.toContain(".eq('status', 'pending')");
  });

  it('rejects allergy, excluded cuisine, and redemption cooldown before a restaurant can be chosen', () => {
    const now = new Date('2026-10-15T15:00:00Z');
    const base = {
      allergyFlags: ['peanut'] as string[] | null,
      dietaryFlags: [] as string[] | null,
      excludedCuisineIds: [] as string[],
      restaurantId: 'rest-1',
      redemptions: [],
      now,
    };
    expect(passesRestaurantHardFilters({ ...base, cuisineTags: ['peanut sauce'] })).toBe(false);
    expect(
      passesRestaurantHardFilters({
        ...base,
        allergyFlags: [],
        excludedCuisineIds: ['italian'],
        cuisineTags: ['italian'],
      }),
    ).toBe(false);
    expect(
      passesRestaurantHardFilters({
        ...base,
        allergyFlags: [],
        cuisineTags: ['thai'],
        redemptions: [
          {
            restaurant_id: 'rest-1',
            status: 'verified',
            verified_at: '2026-08-01T00:00:00Z',
            created_at: '2026-08-01T00:00:00Z',
          },
        ],
      }),
    ).toBe(false);
    expect(
      passesRestaurantHardFilters({
        ...base,
        allergyFlags: [],
        cuisineTags: ['thai'],
        redemptions: [
          {
            restaurant_id: 'rest-1',
            status: 'verified',
            verified_at: '2026-01-01T00:00:00Z',
            created_at: '2026-01-01T00:00:00Z',
          },
          {
            restaurant_id: 'rest-1',
            status: 'verified',
            verified_at: '2026-03-01T00:00:00Z',
            created_at: '2026-03-01T00:00:00Z',
          },
        ],
      }),
    ).toBe(false);
    expect(
      passesRestaurantHardFilters({
        ...base,
        allergyFlags: [],
        cuisineTags: ['thai'],
      }),
    ).toBe(true);

    const origin = { lat: 33.1984, lon: -96.6397 };
    const covering = {
      valid_from: '2026-01-01T00:00:00Z',
      valid_until: '2027-01-01T00:00:00Z',
      withdrawn_from_selection_at: null,
      tiers: [{ threshold_cents: 4000, discount_cents: 2000 }],
    };
    const candidates = filterCarriedAssignCandidates({
      restaurants: [
        {
          id: 'safe',
          name: 'Safe Thai',
          cuisine_tags: ['thai'],
          lat: origin.lat,
          lon: origin.lon,
          current_offer_version_id: 'v-safe',
        },
        {
          id: 'peanut',
          name: 'Peanut House',
          cuisine_tags: ['peanut'],
          lat: origin.lat,
          lon: origin.lon,
          current_offer_version_id: 'v-peanut',
        },
      ],
      versionsById: new Map([
        ['v-safe', { id: 'v-safe', restaurant_id: 'safe', ...covering }],
        ['v-peanut', { id: 'v-peanut', restaurant_id: 'peanut', ...covering }],
      ]),
      origin,
      requestedMiles: 10,
      allergyFlags: ['peanut'],
      dietaryFlags: [],
      excludedCuisineIds: [],
      redemptions: [],
      now,
      deadline: new Date('2026-11-01T00:00:00Z'),
    });
    expect(candidates.map((row) => row.id)).toEqual(['safe']);
  });
});
