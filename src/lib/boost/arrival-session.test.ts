import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  openBoostArrival,
  supersedeBoostArrival,
  type ArrivalContext,
} from '@/lib/boost/arrival-session';
import type {
  ArrivalItemRecord,
  ArrivalQuoteRecord,
  ArrivalSessionRecord,
  ArrivalStore,
  ArrivalVersionRecord,
  OpenArrivalSessionInput,
  OpenArrivalSessionResult,
  SupersedeArrivalQuoteInput,
  SupersedeArrivalQuoteResult,
} from '@/lib/boost/arrival-store';
const ROOT = path.resolve(__dirname, '../../..');
const RESTAURANT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const VERSION = '33333333-3333-4333-8333-333333333333';
const ITEM = '44444444-4444-4444-8444-444444444444';
const HASH = 'ab'.repeat(32);
const FRIDAY = new Date('2026-09-19T03:30:00.000Z');
const AFTER_WINDOW = new Date('2026-09-19T07:10:00.000Z');

const weeklyBoost = {
  id: 'boost-5',
  kind: 'weekly',
  start_isodow: 5,
  start_minute: 22 * 60,
  end_minute: 2 * 60,
  bonus_cents: 500,
};

function versionRow(overrides: Partial<ArrivalVersionRecord> = {}): ArrivalVersionRecord {
  return {
    id: VERSION,
    restaurantId: RESTAURANT,
    timezone: 'America/Chicago',
    validFrom: '2026-09-01T05:00:00.000Z',
    validUntil: '2026-12-01T06:00:00.000Z',
    tiers: [
      { threshold_cents: 4000, discount_cents: 1000 },
      { threshold_cents: 8000, discount_cents: 2000 },
    ],
    boosts: [
      weeklyBoost,
      { ...weeklyBoost, id: 'boost-large', bonus_cents: 800 },
    ],
    withdrawnFromSelectionAt: null,
    boostSessionMinutes: null,
    ...overrides,
  };
}

function itemRow(overrides: Partial<ArrivalItemRecord> = {}): ArrivalItemRecord {
  return {
    id: ITEM,
    restaurantId: RESTAURANT,
    status: 'assigned',
    offerVersionId: VERSION,
    redemptionDeadline: '2026-09-20T00:00:00.000Z',
    ...overrides,
  };
}

class MemoryStore implements ArrivalStore {
  items = new Map<string, ArrivalItemRecord>();
  versions = new Map<string, ArrivalVersionRecord>();
  sessions: ArrivalSessionRecord[] = [];
  quotes: ArrivalQuoteRecord[] = [];
  opens = 0;
  private seq = 0;

  async findItem(id: string) {
    return this.items.get(id) ?? null;
  }
  async findVersion(id: string, restaurantId: string) {
    const row = this.versions.get(id);
    if (!row || row.restaurantId !== restaurantId) return null;
    return row;
  }
  async findSessionByKey(restaurantId: string, idempotencyKey: string) {
    return (
      this.sessions.find(
        (session) => session.restaurantId === restaurantId && session.idempotencyKey === idempotencyKey,
      ) ?? null
    );
  }
  async findSession(id: string, restaurantId: string) {
    return this.sessions.find((session) => session.id === id && session.restaurantId === restaurantId) ?? null;
  }
  async findActiveQuote(sessionId: string) {
    return this.quotes.find((quote) => quote.sessionId === sessionId && quote.supersededAt == null) ?? null;
  }
  async openSession(input: OpenArrivalSessionInput): Promise<OpenArrivalSessionResult> {
    this.opens += 1;
    const existing = await this.findSessionByKey(input.restaurantId, input.idempotencyKey);
    if (existing) return { status: 'existing', sessionId: existing.id };
    if (this.sessions.some((session) => session.challengeItemId === input.challengeItemId && session.status === 'open')) {
      return { status: 'session_open' };
    }
    const item = this.items.get(input.challengeItemId);
    if (!item || item.restaurantId !== input.restaurantId) return { status: 'restaurant_mismatch' };
    if (item.offerVersionId !== input.offerVersionId) return { status: 'version_mismatch' };
    if (input.baseDiscountCents + input.boostDiscountCents !== input.totalDiscountCents) {
      return { status: 'invalid_quote' };
    }
    const id = `00000000-0000-4000-8000-${String(++this.seq).padStart(12, '0')}`;
    this.sessions.push({
      id,
      restaurantId: input.restaurantId,
      challengeItemId: input.challengeItemId,
      offerVersionId: input.offerVersionId,
      redemptionId: input.redemptionId,
      lockedBoostId: input.lockedBoostId,
      arrivalAt: input.arrivalAt,
      expiresAt: input.expiresAt,
      idempotencyKey: input.idempotencyKey,
      status: 'open',
    });
    this.quotes.push({
      id: `quote-${this.seq}`,
      sessionId: id,
      quoteVersion: 1,
      offerVersionId: input.offerVersionId,
      tierId: input.tierId,
      baseDiscountCents: input.baseDiscountCents,
      boostId: input.boostId,
      boostDiscountCents: input.boostDiscountCents,
      totalDiscountCents: input.totalDiscountCents,
      eligibleSubtotalCents: input.eligibleSubtotalCents,
      belowMinimum: input.belowMinimum,
      reasons: input.reasons,
      expiresAt: input.expiresAt,
      supersededAt: null,
    });
    return { status: 'created', sessionId: id };
  }
  async supersedeQuote(input: SupersedeArrivalQuoteInput): Promise<SupersedeArrivalQuoteResult> {
    const session = this.sessions.find(
      (row) => row.id === input.sessionId && row.restaurantId === input.restaurantId,
    );
    if (!session) return { status: 'not_found' };
    if (session.status !== 'open') return { status: 'session_closed' };
    if (new Date(input.expiresAt).getTime() !== new Date(session.expiresAt).getTime()) {
      return { status: 'expiry_mismatch' };
    }
    const active = this.quotes.find((quote) => quote.sessionId === session.id && quote.supersededAt == null);
    if (!active) return { status: 'no_active_quote' };
    if (input.quoteVersion !== active.quoteVersion + 1) return { status: 'conflict' };
    active.supersededAt = input.supersededAt;
    this.quotes.push({
      id: `quote-${++this.seq}`,
      sessionId: session.id,
      quoteVersion: input.quoteVersion,
      offerVersionId: session.offerVersionId,
      tierId: input.tierId,
      baseDiscountCents: input.baseDiscountCents,
      boostId: input.boostId,
      boostDiscountCents: input.boostDiscountCents,
      totalDiscountCents: input.totalDiscountCents,
      eligibleSubtotalCents: input.eligibleSubtotalCents,
      belowMinimum: input.belowMinimum,
      reasons: input.reasons,
      expiresAt: session.expiresAt,
      supersededAt: null,
    });
    return { status: 'created' };
  }
}

function context(store: ArrivalStore, now: Date, restaurantId = RESTAURANT): ArrivalContext {
  return { restaurantId, tokenHash: HASH, now, store };
}

function seed(store: MemoryStore, item = itemRow(), version = versionRow()) {
  store.items.set(item.id, item);
  store.versions.set(version.id, version);
}

async function openAt(
  store: MemoryStore,
  now: Date,
  subtotal = 8200,
  key = 'arrival-1',
) {
  return openBoostArrival(
    { challengeItemId: ITEM, idempotencyKey: key, eligibleSubtotalCents: subtotal },
    context(store, now),
  );
}

describe('boost arrival sessions', () => {
  it('stores one open session, locks the arrival Boost, and defaults a null duration to 240 minutes', async () => {
    const store = new MemoryStore();
    seed(store);
    const opened = await openAt(store, FRIDAY);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.session.lockedBoostId).toBe('boost-large');
    expect(opened.session.arrivalAt).toBe(FRIDAY.toISOString());
    expect(opened.session.expiresAt).toBe('2026-09-19T07:30:00.000Z');
    expect(opened.session.redemptionId).toBeNull();
    expect(opened.quote.quoteVersion).toBe(1);
    expect(opened.quote.boostId).toBe('boost-large');
    expect(opened.quote.baseDiscountCents + opened.quote.boostDiscountCents).toBe(
      opened.quote.totalDiscountCents,
    );
    expect(store.sessions).toHaveLength(1);
    expect(store.opens).toBe(1);
  });

  it('returns the same session on retry and does not move expires_at', async () => {
    const store = new MemoryStore();
    seed(store);
    const first = await openAt(store, FRIDAY, 8200, 'same-key');
    const second = await openAt(store, new Date('2026-09-19T05:00:00.000Z'), 4000, 'same-key');
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.session.id).toBe(first.session.id);
    expect(second.session.expiresAt).toBe(first.session.expiresAt);
    expect(second.session.arrivalAt).toBe(first.session.arrivalAt);
    expect(second.quote.eligibleSubtotalCents).toBe(8200);
    expect(second.quote.totalDiscountCents).toBe(first.quote.totalDiscountCents);
    expect(store.sessions).toHaveLength(1);
    expect(store.opens).toBe(1);
  });

  it('refuses a second open session for the same challenge item', async () => {
    const store = new MemoryStore();
    seed(store);
    expect((await openAt(store, FRIDAY, 8200, 'one')).ok).toBe(true);
    const second = await openAt(store, FRIDAY, 8200, 'two');
    expect(second).toEqual({ ok: false, code: 'session_open' });
    expect(store.sessions).toHaveLength(1);
  });

  it('keeps the locked Boost when the bill is confirmed after the window', async () => {
    const store = new MemoryStore();
    seed(store);
    const opened = await openAt(store, FRIDAY);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const corrected = await supersedeBoostArrival(
      { sessionId: opened.session.id, eligibleSubtotalCents: 7999 },
      context(store, AFTER_WINDOW),
    );
    expect(corrected.ok).toBe(true);
    if (!corrected.ok) return;
    expect(corrected.previous.supersededAt).toBe(AFTER_WINDOW.toISOString());
    expect(corrected.quote.quoteVersion).toBe(2);
    expect(corrected.quote.boostId).toBe('boost-large');
    expect(corrected.quote.boostDiscountCents).toBe(800);
    expect(corrected.session.expiresAt).toBe(opened.session.expiresAt);
    expect(corrected.session.arrivalAt).toBe(opened.session.arrivalAt);
    expect(corrected.session.lockedBoostId).toBe('boost-large');
    expect(store.quotes.filter((quote) => quote.supersededAt == null)).toHaveLength(1);
  });

  it('reduces the Boost first and still locks it when the cap removes the bonus', async () => {
    const store = new MemoryStore();
    seed(
      store,
      itemRow(),
      versionRow({
        tiers: [{ threshold_cents: 1000, discount_cents: 2000 }],
        boosts: [weeklyBoost],
      }),
    );
    const opened = await openAt(store, FRIDAY, 1500);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.quote.baseDiscountCents).toBe(1500);
    expect(opened.quote.boostDiscountCents).toBe(0);
    expect(opened.quote.totalDiscountCents).toBe(1500);
    expect(opened.session.lockedBoostId).toBe('boost-5');
    const corrected = await supersedeBoostArrival(
      { sessionId: opened.session.id, eligibleSubtotalCents: 9000 },
      context(store, AFTER_WINDOW),
    );
    expect(corrected.ok).toBe(true);
    if (!corrected.ok) return;
    expect(corrected.quote.boostId).toBe('boost-5');
    expect(corrected.quote.boostDiscountCents).toBe(500);
    expect(corrected.quote.baseDiscountCents + corrected.quote.boostDiscountCents).toBe(
      corrected.quote.totalDiscountCents,
    );
    expect(corrected.session.expiresAt).toBe(opened.session.expiresAt);
  });

  it('uses a stored duration when boost_session_minutes is set, and clamps to the earlier bound', async () => {
    const store = new MemoryStore();
    seed(store, itemRow({ redemptionDeadline: null }), versionRow({ boostSessionMinutes: 30 }));
    const stored = await openAt(store, FRIDAY);
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    expect(stored.session.expiresAt).toBe('2026-09-19T04:00:00.000Z');

    const deadlineStore = new MemoryStore();
    seed(
      deadlineStore,
      itemRow({ redemptionDeadline: '2026-09-19T04:15:00.000Z' }),
      versionRow({ boostSessionMinutes: null }),
    );
    const byDeadline = await openAt(deadlineStore, FRIDAY);
    expect(byDeadline.ok).toBe(true);
    if (!byDeadline.ok) return;
    expect(byDeadline.session.expiresAt).toBe('2026-09-19T04:15:00.000Z');
  });

  it('refuses withdrawn, unbound, outside validity, another restaurant, and a non-assigned item with no row', async () => {
    const cases: { item: ArrivalItemRecord; version: ArrivalVersionRecord; now: Date; code: string }[] = [
      {
        item: itemRow(),
        version: versionRow({ withdrawnFromSelectionAt: '2026-09-02T00:00:00.000Z' }),
        now: FRIDAY,
        code: 'withdrawn',
      },
      {
        item: itemRow({ offerVersionId: null }),
        version: versionRow(),
        now: FRIDAY,
        code: 'unbound',
      },
      {
        item: itemRow(),
        version: versionRow(),
        now: new Date('2026-12-01T06:00:00.000Z'),
        code: 'outside_validity',
      },
      {
        item: itemRow({ status: 'redeemed' }),
        version: versionRow(),
        now: FRIDAY,
        code: 'not_assigned',
      },
    ];
    for (const row of cases) {
      const store = new MemoryStore();
      seed(store, row.item, row.version);
      const result = await openAt(store, row.now);
      expect(result, row.code).toEqual({ ok: false, code: row.code });
      expect(store.sessions, row.code).toHaveLength(0);
    }

    const other = new MemoryStore();
    seed(other);
    const mismatch = await openBoostArrival(
      { challengeItemId: ITEM, idempotencyKey: 'other', eligibleSubtotalCents: 8200 },
      context(other, FRIDAY, OTHER),
    );
    expect(mismatch).toEqual({ ok: false, code: 'restaurant_mismatch' });
    expect(other.sessions).toHaveLength(0);
  });

  it('does not require a live redemption code, and a bad link creates nothing', async () => {
    const store = new MemoryStore();
    seed(store);
    const opened = await openBoostArrival(
      { challengeItemId: ITEM, idempotencyKey: 'no-code', eligibleSubtotalCents: 8200, redemptionId: null },
      context(store, FRIDAY),
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.session.redemptionId).toBeNull();

    const bad = new MemoryStore();
    seed(bad);
    const refused = await openBoostArrival(
      { challengeItemId: ITEM, idempotencyKey: 'bad-link', eligibleSubtotalCents: 8200, redemptionId: 'nope' },
      context(bad, FRIDAY),
    );
    expect(refused).toEqual({ ok: false, code: 'invalid_terms' });
    expect(bad.sessions).toHaveLength(0);
  });

  it('stores a below-minimum quote instead of refusing it', async () => {
    const store = new MemoryStore();
    seed(store);
    const opened = await openAt(store, FRIDAY, 1000);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.quote.belowMinimum).toBe(true);
    expect(opened.quote.totalDiscountCents).toBe(0);
    expect(opened.session.lockedBoostId).toBeNull();
  });

  it('locks both fall-back clock faces and the Friday overnight window', async () => {
    const fallbackBoost = {
      id: 'fallback',
      kind: 'weekly',
      start_isodow: 7,
      start_minute: 60,
      end_minute: 120,
      bonus_cents: 300,
    };
    for (const instant of ['2026-11-01T06:30:00.000Z', '2026-11-01T07:30:00.000Z']) {
      const store = new MemoryStore();
      seed(store, itemRow({ redemptionDeadline: null }), versionRow({ boosts: [fallbackBoost] }));
      const opened = await openAt(store, new Date(instant));
      expect(opened.ok, instant).toBe(true);
      if (!opened.ok) return;
      expect(opened.session.lockedBoostId, instant).toBe('fallback');
    }
    const after = new MemoryStore();
    seed(after, itemRow({ redemptionDeadline: null }), versionRow({ boosts: [fallbackBoost] }));
    const missed = await openAt(after, new Date('2026-11-01T08:30:00.000Z'));
    expect(missed.ok).toBe(true);
    if (!missed.ok) return;
    expect(missed.session.lockedBoostId).toBeNull();

    const overnight = new MemoryStore();
    seed(overnight, itemRow({ redemptionDeadline: null }), versionRow({ boosts: [weeklyBoost] }));
    const friday = await openAt(overnight, FRIDAY);
    expect(friday.ok).toBe(true);
    if (!friday.ok) return;
    expect(friday.session.lockedBoostId).toBe('boost-5');
    const edge = new MemoryStore();
    seed(edge, itemRow({ redemptionDeadline: null }), versionRow({ boosts: [weeklyBoost] }));
    const closed = await openAt(edge, new Date('2026-09-19T07:00:00.000Z'));
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.session.lockedBoostId).toBeNull();
  });

  it('refuses a correction after withdraw and leaves the stored expiry in place', async () => {
    const store = new MemoryStore();
    seed(store);
    const opened = await openAt(store, FRIDAY);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    store.versions.set(VERSION, versionRow({ withdrawnFromSelectionAt: '2026-09-19T06:00:00.000Z' }));
    const refused = await supersedeBoostArrival(
      { sessionId: opened.session.id, eligibleSubtotalCents: 9000 },
      context(store, AFTER_WINDOW),
    );
    expect(refused).toEqual({ ok: false, code: 'withdrawn' });
    expect(store.quotes).toHaveLength(1);
    expect(store.quotes[0]?.supersededAt).toBeNull();
    expect(store.sessions[0]?.expiresAt).toBe(opened.session.expiresAt);
  });

  it('returns the stored session when a raced insert already owns the key', async () => {
    const seeded: ArrivalSessionRecord = {
      id: 'session-raced',
      restaurantId: RESTAURANT,
      challengeItemId: ITEM,
      offerVersionId: VERSION,
      redemptionId: null,
      lockedBoostId: 'boost-5',
      arrivalAt: FRIDAY.toISOString(),
      expiresAt: '2026-09-19T07:30:00.000Z',
      idempotencyKey: 'race',
      status: 'open',
    };
    const quote: ArrivalQuoteRecord = {
      id: 'quote-raced',
      sessionId: seeded.id,
      quoteVersion: 1,
      offerVersionId: VERSION,
      tierId: 'threshold:8000',
      baseDiscountCents: 2000,
      boostId: 'boost-5',
      boostDiscountCents: 500,
      totalDiscountCents: 2500,
      eligibleSubtotalCents: 8200,
      belowMinimum: false,
      reasons: ['quoted', 'boost_applied'],
      expiresAt: seeded.expiresAt,
      supersededAt: null,
    };
    const store: ArrivalStore = {
      findItem: async () => itemRow(),
      findVersion: async () => versionRow(),
      findSessionByKey: async () => null,
      findSession: async (id) => (id === seeded.id ? seeded : null),
      findActiveQuote: async () => quote,
      openSession: async () => ({ status: 'existing', sessionId: seeded.id }),
      supersedeQuote: async () => ({ status: 'unavailable' }),
    };
    const opened = await openBoostArrival(
      { challengeItemId: ITEM, idempotencyKey: 'race', eligibleSubtotalCents: 9000 },
      context(store, new Date('2026-09-19T05:00:00.000Z')),
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.session.expiresAt).toBe(seeded.expiresAt);
    expect(opened.session.arrivalAt).toBe(FRIDAY.toISOString());
    expect(opened.quote.eligibleSubtotalCents).toBe(8200);
  });

  it('does not let a page or component query the new tables', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name) || name.endsWith('.test.ts')) continue;
        if (full.endsWith(`${path.sep}partner-boost-arrival.ts`)) continue;
        const text = readFileSync(full, 'utf8');
        if (
          text.includes('boost_arrival_sessions') ||
          text.includes('boost_quotes') ||
          text.includes('createBoostArrivalSession') ||
          text.includes('supersedeBoostArrivalQuote') ||
          text.includes('arrival-session') ||
          text.includes('open_boost_arrival_session')
        ) {
          hits.push(path.relative(ROOT, full));
        }
      }
    };
    walk(path.join(ROOT, 'src/app'));
    walk(path.join(ROOT, 'src/components'));
    expect(hits).toEqual([]);

    const sessionSource = readFileSync(path.join(ROOT, 'src/lib/boost/arrival-session.ts'), 'utf8');
    const actionSource = readFileSync(path.join(ROOT, 'src/app/actions/partner-boost-arrival.ts'), 'utf8');
    expect(sessionSource).not.toMatch(/bill-proposal|verify_redemption|assertAdmin/);
    expect(actionSource).not.toMatch(/bill-proposal|verify_redemption|assertAdmin/);
    expect(actionSource).toMatch(/E07_ARRIVAL_SESSIONS_ENABLED|arrivalSessionsEnabled/);
  });
});
