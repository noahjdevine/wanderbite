import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  ACTIVITY_NOTE_MAX_OUTPUT_TOKENS,
  callActivityNoteModel,
  resolveActivityNoteModel,
} from '@/lib/activities/note-generate';
import {
  ACTIVITY_NOTE_MODEL,
  ACTIVITY_NOTE_PROMPT_VERSION,
  ACTIVITY_NOTE_WALK_DISTANCE_REASON,
  ACTIVITY_NOTE_WALK_DISTANCE_RULE,
} from '@/lib/activities/note-copy';
import type { NoteSourceActivity, NoteSourceRestaurant } from '@/lib/activities/note-eligible';
import {
  activityNoteReadAllowed,
  activityNoteWriteAllowed,
  formatActivityNoteSummary,
  runActivityNoteDrafts,
} from '@/lib/activities/note-run';

const NOW = new Date('2026-11-04T18:00:00.000Z');
const SQUARE = 'Chestnut Square Village';
const BODY =
  'You could wander through Chestnut Square Village and let the meal settle while you walk. It is a small detour that keeps the night easy.';

function restaurant(): NoteSourceRestaurant {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Hutchins BBQ',
    cuisineTags: ['bbq'],
    lat: 33.1972,
    lon: -96.6156,
  };
}

function activity(overrides: Partial<NoteSourceActivity> = {}): NoteSourceActivity {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: SQUARE,
    category: 'landmark',
    source_url: 'https://example.com/chestnut-square',
    lat: 33.198,
    lon: -96.616,
    valid_from: null,
    valid_until: null,
    last_verified_at: '2026-11-02T18:00:00.000Z',
    status: 'active',
    is_sample: false,
    kids_oriented: false,
    cost_category: 'free',
    ...overrides,
  };
}

function modelText() {
  return JSON.stringify({
    body: BODY,
    activity_ids: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
  });
}

describe('activity note drafts', () => {
  it('refuses apply without the gates and hosted URLs without HOSTED_OK', () => {
    expect(activityNoteWriteAllowed('http://127.0.0.1:54321', {}).ok).toBe(false);
    expect(activityNoteWriteAllowed('http://127.0.0.1:54321', { WANDERBITE_ACTIVITY_NOTES_APPLY: '1' }).ok).toBe(true);
    expect(
      activityNoteWriteAllowed('https://example.supabase.co', { WANDERBITE_ACTIVITY_NOTES_APPLY: '1' }).ok,
    ).toBe(false);
    expect(
      activityNoteReadAllowed('https://yiajoycgiyxjvznndjge.supabase.co', {}).ok,
    ).toBe(false);
    expect(
      activityNoteWriteAllowed('https://yiajoycgiyxjvznndjge.supabase.co', {
        WANDERBITE_ACTIVITY_NOTES_APPLY: '1',
        WANDERBITE_ACTIVITY_NOTES_HOSTED_OK: '1',
      }).ok,
    ).toBe(true);
  });

  it('writes no database rows on a dry-run and skips kids places', async () => {
    const insertDraft = vi.fn();
    const callModel = vi.fn(async (_input: { system: string; user: string }) => ({ text: modelText(), usage: null }));
    const summary = await runActivityNoteDrafts({
      restaurants: [restaurant()],
      activities: [activity(), activity({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Kids Museum', kids_oriented: true })],
      restaurantNames: ['Hutchins BBQ'],
      mode: 'dry-run',
      now: NOW,
      callModel,
      insertDraft,
    });
    expect(insertDraft).not.toHaveBeenCalled();
    expect(summary.dbWrites).toBe(0);
    expect(summary.model).toBe(ACTIVITY_NOTE_MODEL);
    expect(summary.restaurants[0]?.draft?.status).toBe('draft');
    expect(summary.restaurants[0]?.draft?.model).toBe(ACTIVITY_NOTE_MODEL);
    expect(summary.restaurants[0]?.draft?.prompt_version).toBe(ACTIVITY_NOTE_PROMPT_VERSION);
    expect(summary.restaurants[0]?.insertedId).toBeNull();
    const printed = formatActivityNoteSummary(summary, null);
    expect(printed).toContain(`model=${ACTIVITY_NOTE_MODEL}`);
    expect(printed).toContain('activity_uses max_per_activity=5 escape_room_uses=0 max_escape_room_uses=6');
    expect(printed).toContain(`uses=1 escape_room=no ${SQUARE} aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`);
    const prompt = callModel.mock.calls[0]?.[0];
    expect(prompt?.user).toContain(SQUARE);
    expect(prompt?.user).not.toContain('Kids Museum');
  });

  it('inserts one draft on apply and skips a second open draft', async () => {
    const insertDraft = vi.fn(async () => ({ id: 'note-1' }));
    const summary = await runActivityNoteDrafts({
      restaurants: [restaurant()],
      activities: [activity()],
      restaurantNames: ['Hutchins BBQ'],
      mode: 'apply',
      now: NOW,
      callModel: async () => ({ text: modelText(), usage: null }),
      insertDraft,
    });
    expect(insertDraft).toHaveBeenCalledTimes(1);
    expect(summary.dbWrites).toBe(1);
    expect(formatActivityNoteSummary(summary, null)).not.toContain('activity_uses');
    const again = await runActivityNoteDrafts({
      restaurants: [restaurant()],
      activities: [activity()],
      restaurantNames: ['Hutchins BBQ'],
      mode: 'apply',
      now: NOW,
      existing: [{ restaurantId: restaurant().id, status: 'draft', sourceHash: 'abc' }],
      callModel: async () => ({ text: modelText(), usage: null }),
      insertDraft,
    });
    expect(insertDraft).toHaveBeenCalledTimes(1);
    expect(again.dbWrites).toBe(0);
    expect(again.restaurants[0]?.skips).toContain('a draft is already open');
  });

  it('calls Haiku directly and does not touch the member budget', async () => {
    const bodies: { model?: string; max_tokens?: number; temperature?: number; thinking?: { type?: string }; tools?: unknown }[] = [];
    await callActivityNoteModel({
      system: 'system',
      user: 'user',
      apiKey: 'test-key',
      fetchImpl: async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)) as { model?: string; max_tokens?: number; temperature?: number; thinking?: { type?: string }; tools?: unknown });
        return new Response(JSON.stringify({ content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 3, output_tokens: 2 } }), {
          status: 200,
        });
      },
    });
    expect(bodies[0]?.model).toBe(ACTIVITY_NOTE_MODEL);
    expect(bodies[0]?.model).toBe('claude-haiku-5-5');
    expect(bodies[0]?.max_tokens).toBe(ACTIVITY_NOTE_MAX_OUTPUT_TOKENS);
    expect(bodies[0]?.max_tokens).toBe(2048);
    expect(bodies[0]?.temperature).toBeUndefined();
    expect(bodies[0]?.thinking).toEqual({ type: 'disabled' });
    expect(JSON.stringify(bodies[0])).not.toContain('temperature');
    expect(bodies[0]?.tools).toBeUndefined();
    const overrideBodies: { model?: string; temperature?: number; thinking?: { type?: string } }[] = [];
    await callActivityNoteModel({
      system: 'system',
      user: 'user',
      apiKey: 'test-key',
      model: 'claude-sonnet-5-5',
      fetchImpl: async (_input, init) => {
        overrideBodies.push(JSON.parse(String(init?.body)) as { model?: string; temperature?: number; thinking?: { type?: string } });
        return new Response(JSON.stringify({ content: [{ type: 'text', text: '{}' }] }), { status: 200 });
      },
    });
    expect(overrideBodies[0]?.model).toBe('claude-sonnet-5-5');
    expect(overrideBodies[0]?.temperature).toBeUndefined();
    expect(overrideBodies[0]?.thinking).toBeUndefined();
    expect(JSON.stringify(overrideBodies[0])).not.toContain('temperature');
    expect(JSON.stringify(overrideBodies[0])).not.toContain('thinking');
    const legacyBodies: { model?: string; temperature?: number }[] = [];
    await callActivityNoteModel({
      system: 'system',
      user: 'user',
      apiKey: 'test-key',
      model: 'claude-sonnet-4-5',
      fetchImpl: async (_input, init) => {
        legacyBodies.push(JSON.parse(String(init?.body)) as { model?: string; temperature?: number });
        return new Response(JSON.stringify({ content: [{ type: 'text', text: '{}' }] }), { status: 200 });
      },
    });
    expect(legacyBodies[0]?.model).toBe('claude-sonnet-4-5');
    expect(legacyBodies[0]?.temperature).toBe(0);
    expect(resolveActivityNoteModel({})).toEqual({ ok: true, model: ACTIVITY_NOTE_MODEL });
    expect(resolveActivityNoteModel({ WANDERBITE_ACTIVITY_NOTES_MODEL: '  claude-sonnet-4-5  ' })).toEqual({
      ok: true,
      model: 'claude-sonnet-4-5',
    });
    expect(resolveActivityNoteModel({ WANDERBITE_ACTIVITY_NOTES_MODEL: 'not a model' }).ok).toBe(false);
    const root = process.cwd();
    for (const file of ['note-generate.ts', 'note-run.ts', 'note-copy.ts', 'note-store.ts', 'load-notes.ts']) {
      const sourceText = readFileSync(path.join(root, 'src/lib/activities', file), 'utf8');
      expect(sourceText).not.toMatch(/ai_reserve|rpcAi|entitlement_credits/);
    }
    const script = readFileSync(path.join(root, 'scripts/e06-activity-notes.ts'), 'utf8');
    expect(script).not.toMatch(/ai_reserve|rpcAi|entitlement_credits/);
    expect(script).toContain('WANDERBITE_ACTIVITY_NOTES_HOSTED_OK');
    expect(script).toContain('WANDERBITE_ACTIVITY_NOTES_MODEL');
  });

  it('retries a filler note once and reports blocked instead of saving', async () => {
    const filler =
      'After dinner, you could wander through Chestnut Square Village and let the meal settle. It is a small detour that keeps the night easy.';
    const insertDraft = vi.fn(async () => ({ id: 'note-1' }));
    let calls = 0;
    const callModel = vi.fn(async (_input: { system: string; user: string }) => {
      calls += 1;
      const body = calls === 1 ? filler : BODY;
      return {
        text: JSON.stringify({ body, activity_ids: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'] }),
        usage: null,
      };
    });
    const summary = await runActivityNoteDrafts({
      restaurants: [restaurant()],
      activities: [activity()],
      restaurantNames: ['Hutchins BBQ'],
      mode: 'dry-run',
      now: NOW,
      callModel,
      insertDraft,
    });
    expect(callModel).toHaveBeenCalledTimes(2);
    expect(String(callModel.mock.calls[1]?.[0].user)).toContain('The previous draft was blocked');
    expect(insertDraft).not.toHaveBeenCalled();
    expect(summary.restaurants[0]?.draft?.body).toBe(BODY);
    const blocked = await runActivityNoteDrafts({
      restaurants: [restaurant()],
      activities: [activity()],
      restaurantNames: ['Hutchins BBQ'],
      mode: 'apply',
      now: NOW,
      callModel: async () => ({
        text: JSON.stringify({
          body: filler,
          activity_ids: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
        }),
        usage: null,
      }),
      insertDraft,
    });
    expect(insertDraft).not.toHaveBeenCalled();
    expect(blocked.dbWrites).toBe(0);
    expect(blocked.restaurants[0]?.draft).toBeNull();
    expect(blocked.restaurants[0]?.skips[0]).toMatch(/^blocked: /);
  });

  it('retries a walk-distance miss once, then blocks or saves the good note', async () => {
    const arenaId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const tooFar =
      "Dinner is done, and it's a short walk to The Comedy Arena. The set is the easy way to let a heavy plate settle.";
    const good =
      'You could catch a set at The Comedy Arena after the plates are cleared. It is an easy way to let a heavy meal settle.';
    const far = activity({
      id: arenaId,
      name: 'The Comedy Arena',
      category: 'comedy',
      lat: 33.21,
      lon: -96.6156,
    });
    const insertDraft = vi.fn(async () => ({ id: 'note-walk' }));
    let calls = 0;
    const callModel = vi.fn(async (_input: { system: string; user: string }) => {
      calls += 1;
      return {
        text: JSON.stringify({
          body: calls === 1 ? tooFar : good,
          activity_ids: [arenaId],
        }),
        usage: null,
      };
    });
    const saved = await runActivityNoteDrafts({
      restaurants: [restaurant()],
      activities: [far],
      restaurantNames: ['Hutchins BBQ'],
      mode: 'apply',
      now: NOW,
      callModel,
      insertDraft,
    });
    expect(callModel).toHaveBeenCalledTimes(2);
    expect(String(callModel.mock.calls[0]?.[0].user)).toContain('"walkable":false');
    expect(String(callModel.mock.calls[1]?.[0].user)).toContain(ACTIVITY_NOTE_WALK_DISTANCE_REASON);
    expect(String(callModel.mock.calls[1]?.[0].user)).toContain(ACTIVITY_NOTE_WALK_DISTANCE_RULE);
    expect(insertDraft).toHaveBeenCalledTimes(1);
    expect(saved.dbWrites).toBe(1);
    expect(saved.restaurants[0]?.draft?.body).toBe(good);
    const blocked = await runActivityNoteDrafts({
      restaurants: [restaurant()],
      activities: [far],
      restaurantNames: ['Hutchins BBQ'],
      mode: 'apply',
      now: NOW,
      callModel: async () => ({
        text: JSON.stringify({ body: tooFar, activity_ids: [arenaId] }),
        usage: null,
      }),
      insertDraft,
    });
    expect(insertDraft).toHaveBeenCalledTimes(1);
    expect(blocked.dbWrites).toBe(0);
    expect(blocked.restaurants[0]?.draft).toBeNull();
    expect(blocked.restaurants[0]?.skips).toEqual([`blocked: ${ACTIVITY_NOTE_WALK_DISTANCE_REASON}`]);
  });

  it('retries a mixed pair when the walk sentence names the far place', async () => {
    const squareId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const arenaId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const names = [squareId, arenaId];
    const farSentence =
      'It is a short walk to The Comedy Arena after the plates are cleared. Chestnut Square Village is the other stop if you want to wander.';
    const closeSentence =
      'It is a short walk to Chestnut Square Village after the plates are cleared. The Comedy Arena is the other stop if you want to sit.';
    const square = activity();
    const arena = activity({
      id: arenaId,
      name: 'The Comedy Arena',
      category: 'comedy',
      lat: 33.21,
      lon: -96.6156,
    });
    const insertDraft = vi.fn(async () => ({ id: 'note-mixed' }));
    let calls = 0;
    const callModel = vi.fn(async (_input: { system: string; user: string }) => {
      calls += 1;
      return {
        text: JSON.stringify({
          body: calls === 1 ? farSentence : closeSentence,
          activity_ids: names,
        }),
        usage: null,
      };
    });
    const saved = await runActivityNoteDrafts({
      restaurants: [restaurant()],
      activities: [square, arena],
      restaurantNames: ['Hutchins BBQ'],
      mode: 'apply',
      now: NOW,
      callModel,
      insertDraft,
    });
    expect(callModel).toHaveBeenCalledTimes(2);
    expect(String(callModel.mock.calls[0]?.[0].user)).toContain('"walkable":true');
    expect(String(callModel.mock.calls[0]?.[0].user)).toContain('"walkable":false');
    expect(String(callModel.mock.calls[1]?.[0].user)).toContain(ACTIVITY_NOTE_WALK_DISTANCE_REASON);
    expect(String(callModel.mock.calls[1]?.[0].user)).toContain(ACTIVITY_NOTE_WALK_DISTANCE_RULE);
    expect(insertDraft).toHaveBeenCalledTimes(1);
    expect(saved.dbWrites).toBe(1);
    expect(saved.restaurants[0]?.draft?.body).toBe(closeSentence);
    expect(saved.restaurants[0]?.draft?.activity_ids).toEqual(names);
    const blocked = await runActivityNoteDrafts({
      restaurants: [restaurant()],
      activities: [square, arena],
      restaurantNames: ['Hutchins BBQ'],
      mode: 'apply',
      now: NOW,
      callModel: async () => ({
        text: JSON.stringify({ body: farSentence, activity_ids: names }),
        usage: null,
      }),
      insertDraft,
    });
    expect(insertDraft).toHaveBeenCalledTimes(1);
    expect(blocked.dbWrites).toBe(0);
    expect(blocked.restaurants[0]?.draft).toBeNull();
    expect(blocked.restaurants[0]?.skips).toEqual([`blocked: ${ACTIVITY_NOTE_WALK_DISTANCE_REASON}`]);
  });

  it('does not retry a note that failed for another reason', async () => {
    const callModel = vi.fn(async () => ({ text: 'not-json', usage: null }));
    const summary = await runActivityNoteDrafts({
      restaurants: [restaurant()],
      activities: [activity()],
      restaurantNames: ['Hutchins BBQ'],
      mode: 'dry-run',
      now: NOW,
      model: 'claude-sonnet-4-5',
      callModel,
    });
    expect(callModel).toHaveBeenCalledTimes(1);
    expect(summary.model).toBe('claude-sonnet-4-5');
    expect(summary.restaurants[0]?.skips).toEqual(['model output was not a note']);
    expect(formatActivityNoteSummary(summary, null)).toContain('model=claude-sonnet-4-5');
  });

  it('reports the HTTP status when the model request fails', async () => {
    const failed = await callActivityNoteModel({
      system: 'system',
      user: 'user',
      apiKey: 'test-key',
      model: 'claude-sonnet-5-5',
      fetchImpl: async () => new Response('{"type":"error"}', { status: 400 }),
    });
    expect(failed.text).toBe('');
    expect(failed.failure).toBe('model request failed (400)');
    const summary = await runActivityNoteDrafts({
      restaurants: [restaurant()],
      activities: [activity()],
      restaurantNames: ['Hutchins BBQ'],
      mode: 'dry-run',
      now: NOW,
      callModel: async () => failed,
    });
    expect(summary.restaurants[0]?.skips).toEqual(['model request failed (400)']);
    expect(summary.restaurants[0]?.draft).toBeNull();
  });

  it('caps reuse across the run, skips a redrafted note, and prints dry-run counts', async () => {
    const arenaId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const squareId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const escapeId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const first = restaurant();
    const second: NoteSourceRestaurant = {
      ...restaurant(),
      id: '22222222-2222-4222-8222-222222222222',
      name: 'The Stix Icehouse',
    };
    const kept: NoteSourceRestaurant = {
      ...restaurant(),
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Kept Grill',
    };
    const places = [
      activity({ id: arenaId, name: 'The Comedy Arena', category: 'comedy' }),
      activity(),
      activity({ id: escapeId, name: 'McKinney Escape Room', category: 'games', lat: 33.2 }),
    ];
    const caps = { maxUsesPerActivity: 1, maxEscapeRoomUses: 6 };
    const callModel = vi.fn(async (input: { user: string }) => {
      const cited = input.user.includes(arenaId)
        ? { id: arenaId, name: 'The Comedy Arena' }
        : { id: squareId, name: SQUARE };
      return {
        text: JSON.stringify({
          body: `You could spend the rest of the night at ${cited.name} after the plates are cleared. It is an easy way to let the meal settle.`,
          activity_ids: [cited.id],
        }),
        usage: null,
      };
    });
    const summary = await runActivityNoteDrafts({
      restaurants: [first, second],
      activities: places,
      restaurantNames: [first.name, second.name],
      mode: 'dry-run',
      now: NOW,
      useCaps: caps,
      callModel,
    });
    expect(callModel.mock.calls[0]?.[0].user).toContain(arenaId);
    expect(callModel.mock.calls[1]?.[0].user).not.toContain(arenaId);
    expect(callModel.mock.calls[1]?.[0].user).toContain(squareId);
    expect(summary.activityUses).toEqual([
      { activityId: squareId, name: SQUARE, uses: 1, escapeRoom: false },
      { activityId: arenaId, name: 'The Comedy Arena', uses: 1, escapeRoom: false },
    ]);
    const ownNote = await runActivityNoteDrafts({
      restaurants: [first],
      activities: places,
      restaurantNames: [first.name],
      mode: 'dry-run',
      now: NOW,
      useCaps: caps,
      existing: [{ restaurantId: first.id, status: 'approved', sourceHash: 'old', activityIds: [arenaId] }],
      callModel: async (input) => {
        expect(input.user).toContain(arenaId);
        return {
          text: JSON.stringify({
            body: 'You could spend the rest of the night at The Comedy Arena after the plates are cleared. It is an easy way to let the meal settle.',
            activity_ids: [arenaId],
          }),
          usage: null,
        };
      },
    });
    expect(ownNote.activityUses).toEqual([
      { activityId: arenaId, name: 'The Comedy Arena', uses: 1, escapeRoom: false },
    ]);
    const blocked = await runActivityNoteDrafts({
      restaurants: [second],
      activities: places,
      restaurantNames: [second.name],
      mode: 'dry-run',
      now: NOW,
      useCaps: caps,
      existing: [
        { restaurantId: kept.id, status: 'approved', sourceHash: 'kept', activityIds: [arenaId] },
        { restaurantId: kept.id, status: 'rejected', sourceHash: 'no', activityIds: [squareId] },
        { restaurantId: kept.id, status: 'paused', sourceHash: 'paused', activityIds: [escapeId] },
      ],
      callModel: async (input) => {
        expect(input.user).not.toContain(arenaId);
        expect(input.user).toContain(squareId);
        expect(input.user).toContain(escapeId);
        return {
          text: JSON.stringify({
            body: `You could spend the rest of the night at ${SQUARE} after the plates are cleared. It is an easy way to let the meal settle.`,
            activity_ids: [squareId],
          }),
          usage: null,
        };
      },
    });
    expect(blocked.activityUses.map((row) => row.activityId).sort()).toEqual([arenaId, squareId].sort());
    const replaced = await runActivityNoteDrafts({
      restaurants: [first, second],
      activities: places,
      restaurantNames: [first.name, second.name],
      mode: 'dry-run',
      now: NOW,
      useCaps: caps,
      existing: [{ restaurantId: first.id, status: 'approved', sourceHash: 'old', activityIds: [arenaId] }],
      callModel: async (input) => {
        const cited = input.user.includes(squareId)
          ? { id: squareId, name: SQUARE }
          : { id: arenaId, name: 'The Comedy Arena' };
        return {
          text: JSON.stringify({
            body: `You could spend the rest of the night at ${cited.name} after the plates are cleared. It is an easy way to let the meal settle.`,
            activity_ids: [cited.id],
          }),
          usage: null,
        };
      },
    });
    expect(replaced.restaurants[0]?.draft?.activity_ids).toEqual([squareId]);
    expect(replaced.restaurants[1]?.draft?.activity_ids).toEqual([arenaId]);
    expect(replaced.activityUses).toEqual([
      { activityId: squareId, name: SQUARE, uses: 1, escapeRoom: false },
      { activityId: arenaId, name: 'The Comedy Arena', uses: 1, escapeRoom: false },
    ]);
    const escapeCaps = { maxUsesPerActivity: 5, maxEscapeRoomUses: 1 };
    let escapeCalls = 0;
    const escapeRun = await runActivityNoteDrafts({
      restaurants: [first, second],
      activities: places,
      restaurantNames: [first.name, second.name],
      mode: 'dry-run',
      now: NOW,
      useCaps: escapeCaps,
      callModel: async (input) => {
        escapeCalls += 1;
        const cited = escapeCalls === 1
          ? { id: escapeId, name: 'McKinney Escape Room' }
          : { id: squareId, name: SQUARE };
        if (escapeCalls === 2) expect(input.user).not.toContain(escapeId);
        return {
          text: JSON.stringify({
            body: `You could spend the rest of the night at ${cited.name} after the plates are cleared. It is an easy way to let the meal settle.`,
            activity_ids: [cited.id],
          }),
          usage: null,
        };
      },
    });
    expect(escapeRun.escapeRoomUses).toBe(1);
    expect(escapeRun.activityUses.find((row) => row.activityId === escapeId)?.escapeRoom).toBe(true);
    const fromEnv = await runActivityNoteDrafts({
      restaurants: [first],
      activities: [activity()],
      restaurantNames: [first.name],
      mode: 'dry-run',
      now: NOW,
      env: { WANDERBITE_ACTIVITY_NOTES_MAX_USES_PER_ACTIVITY: '3', WANDERBITE_ACTIVITY_NOTES_MAX_ESCAPE_ROOM_USES: '4' },
      callModel: async () => ({ text: modelText(), usage: null }),
    });
    expect(fromEnv.useCaps).toEqual({ maxUsesPerActivity: 3, maxEscapeRoomUses: 4 });
  });
});
