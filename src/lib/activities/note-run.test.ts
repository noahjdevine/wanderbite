import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  ACTIVITY_NOTE_MAX_OUTPUT_TOKENS,
  callActivityNoteModel,
  resolveActivityNoteModel,
} from '@/lib/activities/note-generate';
import { ACTIVITY_NOTE_MODEL, ACTIVITY_NOTE_PROMPT_VERSION } from '@/lib/activities/note-copy';
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
    expect(formatActivityNoteSummary(summary, null)).toContain(`model=${ACTIVITY_NOTE_MODEL}`);
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
    expect(overrideBodies[0]?.thinking).toEqual({ type: 'disabled' });
    expect(JSON.stringify(overrideBodies[0])).not.toContain('temperature');
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
});
