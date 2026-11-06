import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeneratedChallengeItem } from '@/app/actions/generate-challenge';
import type { BiteNoteRow } from '@/app/actions/bite-notes';
import { RestaurantCard } from '@/components/dashboard/restaurant-card';
import { JournalContent } from '@/components/journal/journal-content';
import { VisitNoteRead } from '@/components/notes/visit-note';
import { PassportClient, type PassportVisit } from '@/components/passport/passport-client';
import { deriveVisitStatus, type VisitStatus } from '@/lib/visits/visit-status';

const USER = '11111111-1111-4111-8111-111111111111';
const NOTED = '22222222-2222-4222-8222-222222222222';
const OPEN = '33333333-3333-4333-8333-333333333333';
const ISSUED = '44444444-4444-4444-8444-444444444444';
const PUBLIC_NOTE = '55555555-5555-4555-8555-555555555555';
const PRIVATE_NOTE = '66666666-6666-4666-8666-666666666666';
const NOW = new Date('2026-07-15T18:00:00.000Z');

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  redirect: (url: string) => {
    throw new Error(url);
  },
}));

vi.mock('@/app/actions/bite-notes', () => ({
  getBiteNotes: vi.fn(),
  saveBiteNote: vi.fn(),
  toggleNoteVisibility: vi.fn(),
}));

vi.mock('@/app/actions/get-redemption-code', () => ({
  getRedemptionCode: vi.fn(),
}));

vi.mock('@/lib/auth/require-user', () => ({
  requireUser: vi.fn(async () => ({ ok: true, userId: USER, email: null })),
}));

vi.mock('@/lib/recipes/journal-links', () => ({
  loadJournalSavedRecipeLinks: vi.fn(async () => ({})),
}));

vi.mock('@/components/restaurants/restaurant-reviews', () => ({
  RestaurantReviews: () => null,
}));

vi.mock('@/components/restaurants/restaurant-photo', () => ({
  RestaurantPhoto: () => null,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('react-map-gl/maplibre', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Marker: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  NavigationControl: () => null,
  Popup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = { redemptions: [], challenge_items: [] };

function matches(row: Row, filters: { op: 'eq' | 'in'; column: string; value: unknown }[]) {
  return filters.every((filter) => {
    if (filter.op === 'eq') return row[filter.column] === filter.value;
    return (filter.value as unknown[]).includes(row[filter.column]);
  });
}

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      const filters: { op: 'eq' | 'in'; column: string; value: unknown }[] = [];
      const rows = () => (db[table] ?? []).filter((row) => matches(row, filters));
      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push({ op: 'eq', column, value });
          return builder;
        },
        in(column: string, value: unknown[]) {
          filters.push({ op: 'in', column, value });
          return builder;
        },
        then(
          onFulfilled?: (value: { data: Row[]; error: null }) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          return Promise.resolve({ data: rows(), error: null }).then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
  }),
}));

import { getBiteNotes } from '@/app/actions/bite-notes';

function statusFor(input: {
  itemStatus?: string;
  deadline?: string | null;
  redemption?: { status: string; verifiedAt: string | null; expiresAt: string | null } | null;
  note?: boolean;
}): VisitStatus {
  return deriveVisitStatus({
    item: {
      status: input.itemStatus ?? 'assigned',
      redemptionDeadline: input.deadline === undefined ? '2026-12-01T00:00:00.000Z' : input.deadline,
    },
    redemption: input.redemption ?? null,
    note: input.note ? { note: 'memory' } : null,
    now: NOW,
  });
}

function cardItem(visitStatus: VisitStatus, redemptionId: string | null): GeneratedChallengeItem {
  return {
    challengeItem: {
      id: 'item-1',
      cycle_id: 'cycle-1',
      restaurant_id: 'rest-1',
      slot_number: 1,
      status: 'assigned',
      offer_version_id: null,
      redemption_deadline: '2026-12-01T00:00:00.000Z',
      credit_id: null,
    },
    restaurant: {
      id: 'rest-1',
      name: 'North Grill',
      cuisine_tags: [],
      address: null,
      lat: null,
      lon: null,
      status: 'active',
      market_id: 'market-1',
      org_id: 'org-1',
    },
    offer: { available: true, discount_amount_cents: 1000, min_spend_cents: 4000 },
    redemptionId,
    visitStatus,
  };
}

function visit(status: VisitStatus, id = OPEN): PassportVisit {
  return {
    id,
    verifiedAt: '2026-07-15T18:00:00.000Z',
    visitStatus: status,
    restaurant: {
      id: 'rest-1',
      name: 'North Grill',
      address: null,
      lat: null,
      lon: null,
      cuisine_tags: [],
      neighborhood: null,
      image_url: null,
      google_place_id: null,
    },
  };
}

describe('memory entry points', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  async function render(node: ReactElement) {
    await act(async () => {
      root.render(node);
    });
    return container;
  }

  function action(view: HTMLElement) {
    return view.querySelector('[data-memory-action]')?.textContent ?? null;
  }

  it('follows deriveVisitStatus on Challenges', async () => {
    const cases: { status: VisitStatus; label: string | null }[] = [
      {
        status: statusFor({}),
        label: null,
      },
      {
        status: statusFor({
          itemStatus: 'redeemed',
          redemption: { status: 'issued', verifiedAt: null, expiresAt: '2026-07-15T18:20:00.000Z' },
        }),
        label: null,
      },
      {
        status: statusFor({
          itemStatus: 'redeemed',
          redemption: { status: 'issued', verifiedAt: null, expiresAt: '2026-07-15T17:00:00.000Z' },
        }),
        label: null,
      },
      {
        status: statusFor({ itemStatus: 'expired', deadline: '2026-07-01T00:00:00.000Z' }),
        label: null,
      },
      {
        status: statusFor({ itemStatus: 'swapped_out' }),
        label: null,
      },
      {
        status: statusFor({
          itemStatus: 'redeemed',
          redemption: { status: 'verified', verifiedAt: '2026-07-15T18:00:00.000Z', expiresAt: null },
        }),
        label: 'Add memory',
      },
      {
        status: statusFor({
          itemStatus: 'redeemed',
          redemption: { status: 'verified', verifiedAt: '2026-07-15T18:00:00.000Z', expiresAt: null },
          note: true,
        }),
        label: 'Edit memory',
      },
    ];

    expect(cases.map((item) => item.status)).toEqual([
      'ready',
      'code_issued',
      'code_expired',
      'expired',
      'swapped',
      'verified',
      'note_added',
    ]);

    for (const item of cases) {
      const view = await render(
        <RestaurantCard
          item={cardItem(item.status, OPEN)}
          cycleCreatedAt="2026-11-01T18:00:00.000Z"
          canSwap={false}
          isSwapping={false}
          isRedeeming={false}
          onSwap={() => undefined}
          onRedeem={() => undefined}
          memoryReturnTo="/challenges"
          biteNote={
            item.status === 'note_added'
              ? {
                  id: PRIVATE_NOTE,
                  redemption_id: OPEN,
                  note: 'Saved night',
                  rating: 5,
                  is_public: true,
                }
              : undefined
          }
        />,
      );
      expect(action(view)).toBe(item.label);
      if (item.label) {
        const href = view.querySelector('[data-memory-action]')?.getAttribute('href') ?? '';
        const target = new URL(href, 'https://wanderbite.invalid').searchParams.get('return');
        expect(href).toContain(`/journal/notes/${OPEN}`);
        expect(target).toBe('/challenges');
      }
      if (item.status === 'note_added') {
        expect(view.querySelector('[data-note-visibility="public"]')?.textContent).toBe('Public');
        expect(view.textContent).toContain('Saved night');
      }
    }
  });

  it('opens Add memory and Edit memory for the passport visit', async () => {
    const verified = await render(
      <PassportClient
        userDisplayName="Noah"
        visits={[visit('verified', OPEN)]}
        ratingsByRestaurantId={{}}
        biteNotesByRestaurantId={{}}
        currentStreak={0}
        longestStreak={0}
        totalMonthsActive={0}
        uniqueRestaurants={1}
        neighborhoods={1}
        earnedBadges={[]}
        showFirstBiteLocked={false}
      />,
    );
    expect(action(verified)).toBe('Add memory');
    expect(verified.textContent).toContain('1 restaurant');
    expect(verified.textContent).toContain('1 neighborhood');
    expect(verified.textContent).not.toContain('No tags');
    expect(verified.textContent).not.toContain('1 restaurants');
    expect(verified.textContent).not.toContain('Add note');
    const addHref = verified.querySelector('[data-memory-action]')?.getAttribute('href') ?? '';
    expect(new URL(addHref, 'https://wanderbite.invalid').searchParams.get('return')).toBe(
      '/journey?view=passport',
    );

    const noted = await render(
      <PassportClient
        userDisplayName="Noah"
        visits={[visit('note_added', NOTED)]}
        ratingsByRestaurantId={{}}
        biteNotesByRestaurantId={{
          'rest-1': [
            {
              id: PRIVATE_NOTE,
              redemption_id: NOTED,
              restaurant_id: 'rest-1',
              rating: 4,
              note: 'Passport memory',
              updated_at: '2026-07-15T18:00:00.000Z',
              is_public: false,
            },
          ],
        }}
        currentStreak={0}
        longestStreak={0}
        totalMonthsActive={0}
        uniqueRestaurants={1}
        neighborhoods={1}
        earnedBadges={[]}
        showFirstBiteLocked={false}
      />,
    );
    expect(action(noted)).toBe('Edit memory');
    expect(noted.querySelector('[data-note-visibility="private"]')?.textContent).toBe('Private');
    expect(noted.querySelector(`#visit-${NOTED}`)).not.toBeNull();
  });

  it('shows Add memory, Edit memory, and the journal privacy copy', async () => {
    db.redemptions = [
      {
        id: NOTED,
        user_id: USER,
        status: 'verified',
        verified_at: '2026-07-15T18:00:00.000Z',
        expires_at: null,
        challenge_item_id: null,
        restaurants: { name: 'Noted Grill' },
      },
      {
        id: OPEN,
        user_id: USER,
        status: 'verified',
        verified_at: '2026-07-14T18:00:00.000Z',
        expires_at: null,
        challenge_item_id: null,
        restaurants: { name: 'Open Grill' },
      },
      {
        id: ISSUED,
        user_id: USER,
        status: 'issued',
        verified_at: null,
        expires_at: '2099-01-01T00:00:00.000Z',
        challenge_item_id: null,
        restaurants: { name: 'Issued Grill' },
      },
    ];
    const notes: BiteNoteRow[] = [
      {
        id: PUBLIC_NOTE,
        redemption_id: NOTED,
        restaurant_id: 'rest-noted',
        note: 'Shared tacos',
        rating: 5,
        is_public: true,
        created_at: '2026-07-15T18:00:00.000Z',
        updated_at: '2026-07-15T18:00:00.000Z',
        restaurant: { name: 'Noted Grill', address: null },
      },
      {
        id: PRIVATE_NOTE,
        redemption_id: ISSUED,
        restaurant_id: 'rest-issued',
        note: 'Not yet',
        rating: 3,
        is_public: false,
        created_at: '2026-07-15T18:00:00.000Z',
        updated_at: '2026-07-15T18:00:00.000Z',
        restaurant: { name: 'Issued Grill', address: null },
      },
    ];
    vi.mocked(getBiteNotes).mockResolvedValue({ ok: true, data: notes });

    const ui = await JournalContent();
    const view = await render(ui);
    expect(view.querySelector('h1')?.textContent).toBe('Journal');
    expect(view.textContent).toContain('Your dining memories. You choose which ones to share.');
    expect(view.textContent).not.toContain('Timeline');
    expect(view.textContent).not.toContain('Share My Passport');
    expect(view.textContent?.toLowerCase()).not.toContain('only you can see');
    expect(view.textContent).not.toContain('Passport');

    const links = [...view.querySelectorAll('[data-memory-action]')].map((el) => ({
      label: el.textContent,
      id: el.getAttribute('href')?.match(/notes\/([^?]+)/)?.[1],
    }));
    expect(links).toEqual([
      { label: 'Add memory', id: OPEN },
      { label: 'Edit memory', id: NOTED },
    ]);
    expect(view.querySelector('[data-note-visibility="public"]')?.textContent).toBe('Public');
    expect(view.querySelector('[data-note-visibility="private"]')?.textContent).toBe('Private');
    expect(view.querySelector(`#visit-${OPEN}`)).not.toBeNull();
    expect(view.querySelector(`#visit-${NOTED}`)).not.toBeNull();
  });

  it('follows the same rule on a Journey history row', async () => {
    const verified = await render(
      <VisitNoteRead redemptionId={OPEN} status="verified" returnTo="/journey" note={null} />,
    );
    expect(action(verified)).toBe('Add memory');
    expect(new URL(verified.querySelector('[data-memory-action]')?.getAttribute('href') ?? '', 'https://wanderbite.invalid').searchParams.get('return')).toBe('/journey');

    const noted = await render(
      <VisitNoteRead
        redemptionId={NOTED}
        status="note_added"
        returnTo="/journey"
        note={{ id: PRIVATE_NOTE, note: 'Journey memory', is_public: false }}
      />,
    );
    expect(action(noted)).toBe('Edit memory');
    expect(noted.querySelector('[data-note-visibility="private"]')?.textContent).toBe('Private');

    for (const status of ['ready', 'code_issued', 'code_expired', 'expired', 'swapped'] as const) {
      const hidden = await render(
        <VisitNoteRead redemptionId={OPEN} status={status} returnTo="/journey" note={null} />,
      );
      expect(action(hidden)).toBeNull();
    }
  });
});
