import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ActivityFactDraft, ActivityFactSnapshot, ActivitySnapshot } from '@/lib/content-pipeline/activity-plan';
import { activityClaimForbidden, linkedActivities } from '@/lib/content-pipeline/activity-plan';
import type { ExceptionDraft } from '@/lib/content-pipeline/exceptions';
import { contentHash } from '@/lib/content-pipeline/hash';
import { loadActivitySourceRegistry } from '@/lib/content-pipeline/registry';
import {
  parseContentRefreshArgs,
  refreshContentSource,
  type AttemptWrite,
  type ContentSourceRecord,
  type SourcePatch,
} from '@/lib/content-pipeline/refresh';

const SOURCE_ID = '11111111-1111-4111-8111-111111111111';
const ACTIVITY_ID = '22222222-2222-4222-8222-222222222222';
const VENUE_URL = 'https://example.com/sample-square-walk';
const QUIET = '<html><body><p>A fountain sits on the sample square near the restaurant.</p></body></html>';
const PRICED = '<html><body><p>Admission is $18. Open from 9 a.m. to 5 p.m. Allergen note: nut-free.</p></body></html>';

function source(overrides: Partial<ContentSourceRecord> = {}): ContentSourceRecord {
  return {
    id: SOURCE_ID,
    kind: 'venue_page',
    url: VENUE_URL,
    status: 'active',
    lastAttemptedAt: null,
    lastVerifiedAt: null,
    lastContentHash: null,
    ...overrides,
  };
}

function activity(overrides: Partial<ActivitySnapshot> = {}): ActivitySnapshot {
  return {
    id: ACTIVITY_ID,
    name: 'Sample Square Walk',
    sourceUrl: VENUE_URL,
    contentSourceId: SOURCE_ID,
    status: 'active',
    hoursNote: 'Afternoons on the sample listing',
    bookingRequired: false,
    version: 1,
    ...overrides,
  };
}

function priceFact(): ActivityFactSnapshot {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    subjectId: ACTIVITY_ID,
    field: 'price',
    status: 'current',
    text: null,
    price: '$12',
    hoursNote: null,
  };
}

function fetchThatThrows(): typeof fetch {
  return async () => {
    throw new Error('network was called');
  };
}

type Memory = {
  attempts: AttemptWrite[];
  patches: SourcePatch[];
  exceptions: ExceptionDraft[];
  facts: ActivityFactDraft[];
  activity: ActivitySnapshot;
};

function effects(state: Memory) {
  return {
    recordAttempt: async (row: AttemptWrite) => {
      state.attempts.push(row);
    },
    updateSource: async (_id: string, patch: SourcePatch) => {
      state.patches.push(patch);
    },
    applyDescriptionFact: async () => {
      throw new Error('recipe fact was applied');
    },
    applyActivityFact: async (row: ActivityFactDraft) => {
      state.facts.push(row);
    },
    openException: async (row: ExceptionDraft) => {
      state.exceptions.push(row);
    },
  };
}

describe('venue and event refresh', () => {
  it('registers venue_page and event_page without treating them as menus', () => {
    const loaded = loadActivitySourceRegistry(
      readFileSync(path.join(process.cwd(), 'scripts/fixtures/e06-activity-sources.json'), 'utf8'),
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.sources.map((row) => row.kind)).toEqual(['venue_page', 'event_page']);
    expect(loaded.sources.every((row) => row.url.startsWith('https://example.com/'))).toBe(true);
    expect(parseContentRefreshArgs(['--expire'])).toMatchObject({ command: 'expire', apply: false });
    expect(parseContentRefreshArgs(['--refresh'])).toMatchObject({ command: 'refresh', apply: false });
  });

  it('dry-runs a venue page and an event page without a model call or a write', async () => {
    const calls: string[] = [];
    for (const kind of ['venue_page', 'event_page'] as const) {
      const state: Memory = { attempts: [], patches: [], exceptions: [], facts: [], activity: activity() };
      const result = await refreshContentSource({
        source: source({ kind, lastContentHash: 'not-the-hash' }),
        facts: [],
        recipes: [],
        activities: [state.activity],
        activityFacts: [],
        apply: false,
        html: QUIET,
        fetchImpl: fetchThatThrows(),
        callModel: async () => {
          calls.push(kind);
          return { text: '{}', usage: null };
        },
        effects: effects(state),
      });
      expect(result.modelCalls).toBe(0);
      expect(result.refused).toBeNull();
      expect(result.attempts[0]?.contentHash).toBe(contentHash(QUIET));
      expect(state.attempts).toEqual([]);
      expect(state.facts).toEqual([]);
      expect(state.patches).toEqual([]);
      expect(state.activity).toMatchObject({ name: 'Sample Square Walk', bookingRequired: false, status: 'active' });
    }
    expect(calls).toEqual([]);
  });

  it('records unchanged for an identical venue page and does not call the model', async () => {
    const state: Memory = { attempts: [], patches: [], exceptions: [], facts: [], activity: activity() };
    let called = false;
    const result = await refreshContentSource({
      source: source({ lastContentHash: contentHash(QUIET) }),
      facts: [],
      recipes: [],
      activities: [state.activity],
      apply: true,
      html: QUIET,
      fetchImpl: fetchThatThrows(),
      callModel: async () => {
        called = true;
        return { text: '{}', usage: null };
      },
      effects: effects(state),
    });
    expect(called).toBe(false);
    expect(result.verified).toBe(true);
    expect(result.attempts.map((row) => row.outcome)).toEqual(['unchanged']);
    expect(state.attempts.map((row) => row.outcome)).toEqual(['unchanged']);
    expect(state.patches[0]?.lastVerifiedAt).toEqual(expect.any(String));
    expect(state.facts).toEqual([]);
    expect(state.activity.version).toBe(1);
  });

  it('opens a price and hours conflict and does not rewrite the activity', async () => {
    const state: Memory = { attempts: [], patches: [], exceptions: [], facts: [], activity: activity() };
    let called = false;
    const result = await refreshContentSource({
      source: source(),
      facts: [],
      recipes: [],
      activities: [state.activity],
      activityFacts: [priceFact()],
      apply: true,
      html: PRICED,
      fetchImpl: fetchThatThrows(),
      callModel: async () => {
        called = true;
        return { text: '{"summary":"A discount partnership offer"}', usage: { input: 1, output: 1 } };
      },
      effects: effects(state),
    });
    expect(called).toBe(false);
    expect(result.modelCalls).toBe(0);
    expect(state.facts).toEqual([]);
    expect(state.exceptions.some((row) => row.reason === 'conflict' && row.field === 'price' && row.subjectType === 'activity')).toBe(true);
    expect(state.exceptions.some((row) => row.field === 'hours_note')).toBe(true);
    expect(state.exceptions.some((row) => row.reason === 'sensitive' && row.field === 'description')).toBe(true);
    expect(state.activity).toMatchObject({
      name: 'Sample Square Walk',
      status: 'active',
      bookingRequired: false,
      hoursNote: 'Afternoons on the sample listing',
      version: 1,
    });
  });

  it('drafts a summary only for an existing activity and refuses a partnership claim', async () => {
    const state: Memory = { attempts: [], patches: [], exceptions: [], facts: [], activity: activity({ hoursNote: null }) };
    const allowed = await refreshContentSource({
      source: source(),
      facts: [],
      recipes: [],
      activities: [state.activity],
      apply: true,
      html: QUIET,
      fetchImpl: fetchThatThrows(),
      callModel: async () => ({ text: '{"summary":"A fountain sits on the sample square."}', usage: { input: 4, output: 4 } }),
      reserveModel: async () => ({
        ok: true,
        settle: async () => undefined,
        release: async () => undefined,
      }),
      effects: effects(state),
    });
    expect(allowed.modelCalls).toBe(1);
    expect(state.facts).toEqual([
      expect.objectContaining({ activityId: ACTIVITY_ID, field: 'summary', text: 'A fountain sits on the sample square.' }),
    ]);
    expect(state.activity.bookingRequired).toBe(false);

    const blocked: Memory = { attempts: [], patches: [], exceptions: [], facts: [], activity: activity({ hoursNote: null }) };
    await refreshContentSource({
      source: source(),
      facts: [],
      recipes: [],
      activities: [blocked.activity],
      apply: true,
      html: QUIET,
      fetchImpl: fetchThatThrows(),
      callModel: async () => ({ text: '{"summary":"Book a discount credit offer."}', usage: null }),
      reserveModel: async () => ({
        ok: true,
        settle: async () => undefined,
        release: async () => undefined,
      }),
      effects: effects(blocked),
    });
    expect(blocked.facts).toEqual([]);
    expect(blocked.exceptions.some((row) => row.reason === 'sensitive' && row.subjectType === 'activity')).toBe(true);
    expect(activityClaimForbidden('a partnership')).toBe(true);
  });

  it('does not invent an activity when the page has no linked row', async () => {
    const state: Memory = { attempts: [], patches: [], exceptions: [], facts: [], activity: activity() };
    const result = await refreshContentSource({
      source: source(),
      facts: [],
      recipes: [],
      activities: [],
      apply: true,
      html: PRICED,
      fetchImpl: fetchThatThrows(),
      callModel: async () => {
        throw new Error('model was called');
      },
      effects: effects(state),
    });
    expect(result.modelCalls).toBe(0);
    expect(state.facts).toEqual([]);
    expect(state.exceptions.length).toBeGreaterThan(0);
    expect(state.exceptions.every((row) => row.subjectId == null)).toBe(true);
    expect(linkedActivities(SOURCE_ID, VENUE_URL, [])).toEqual([]);
  });
});
