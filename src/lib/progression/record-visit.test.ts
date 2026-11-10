import { describe, expect, it, vi } from 'vitest';
import {
  parseVerifiedVisitProgress,
  recordVerifiedVisitProgress,
  type ProgressionLedgerClient,
} from '@/lib/progression/record-visit';

const REDEMPTION_ID = 'redemption-1';

function client(
  impl: ProgressionLedgerClient['rpc'],
): { supabase: ProgressionLedgerClient; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(impl);
  return { supabase: { rpc }, rpc };
}

const inserted = {
  events: [{ id: 'event-1' }],
  milestones: [{ id: 'milestone-1' }, { id: 'milestone-2' }],
  entries: [{ id: 'entry-1' }],
};

describe('parseVerifiedVisitProgress', () => {
  it('counts inserted rows', () => {
    expect(parseVerifiedVisitProgress(inserted)).toEqual({
      status: 'recorded',
      counts: { events: 1, milestones: 2, entries: 1 },
    });
  });

  it('treats a later milestone insert with no new event as recorded', () => {
    expect(
      parseVerifiedVisitProgress({
        events: [],
        milestones: [{ id: 'milestone-1' }],
        entries: [{ id: 'entry-1' }],
      }),
    ).toEqual({
      status: 'recorded',
      counts: { events: 0, milestones: 1, entries: 1 },
    });
  });

  it('treats empty arrays as a replay', () => {
    expect(
      parseVerifiedVisitProgress({ events: [], milestones: [], entries: [] }),
    ).toEqual({
      status: 'replay',
      counts: { events: 0, milestones: 0, entries: 0 },
    });
  });

  it('treats null jsonb as skipped', () => {
    expect(parseVerifiedVisitProgress(null)).toEqual({
      status: 'skipped',
      counts: { events: 0, milestones: 0, entries: 0 },
    });
  });

  it('accepts one JSON string encoding of the same object', () => {
    expect(parseVerifiedVisitProgress(JSON.stringify(inserted)).status).toBe('recorded');
    expect(parseVerifiedVisitProgress('null')).toEqual({
      status: 'skipped',
      counts: { events: 0, milestones: 0, entries: 0 },
    });
  });

  it('rejects malformed jsonb', () => {
    const malformed = [
      undefined,
      1,
      'not-json',
      '"still-a-string"',
      [],
      {},
      { events: [] },
      { events: [], milestones: [], entries: null },
      { events: {}, milestones: [], entries: [] },
      { events: [], milestones: 'nope', entries: [] },
    ];
    for (const value of malformed) {
      expect(parseVerifiedVisitProgress(value)).toEqual({
        status: 'error',
        counts: { events: 0, milestones: 0, entries: 0 },
      });
    }
  });
});

describe('recordVerifiedVisitProgress', () => {
  it('calls the RPC once and returns inserted counts', async () => {
    const { supabase, rpc } = client(async () => ({ data: inserted, error: null }));
    await expect(recordVerifiedVisitProgress(supabase, REDEMPTION_ID)).resolves.toEqual({
      status: 'recorded',
      counts: { events: 1, milestones: 2, entries: 1 },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('record_verified_visit_progress', {
      p_redemption_id: REDEMPTION_ID,
    });
  });

  it('returns replay for empty arrays and does not throw', async () => {
    const { supabase } = client(async () => ({
      data: { events: [], milestones: [], entries: [] },
      error: null,
    }));
    await expect(recordVerifiedVisitProgress(supabase, REDEMPTION_ID)).resolves.toEqual({
      status: 'replay',
      counts: { events: 0, milestones: 0, entries: 0 },
    });
  });

  it('returns skipped when the function returns null', async () => {
    const { supabase } = client(async () => ({ data: null, error: null }));
    await expect(recordVerifiedVisitProgress(supabase, REDEMPTION_ID)).resolves.toEqual({
      status: 'skipped',
      counts: { events: 0, milestones: 0, entries: 0 },
    });
  });

  it('returns error for malformed jsonb', async () => {
    const { supabase } = client(async () => ({ data: { events: [] }, error: null }));
    await expect(recordVerifiedVisitProgress(supabase, REDEMPTION_ID)).resolves.toEqual({
      status: 'error',
      counts: { events: 0, milestones: 0, entries: 0 },
    });
  });

  it('returns error when the RPC returns an error and ignores the payload', async () => {
    const { supabase } = client(async () => ({
      data: inserted,
      error: { message: 'Could not find the function public.record_verified_visit_progress' },
    }));
    await expect(recordVerifiedVisitProgress(supabase, REDEMPTION_ID)).resolves.toEqual({
      status: 'error',
      counts: { events: 0, milestones: 0, entries: 0 },
    });
  });

  it('returns error when the RPC throws or the call times out', async () => {
    const thrown = client(() => {
      throw new Error('statement timeout');
    });
    await expect(recordVerifiedVisitProgress(thrown.supabase, REDEMPTION_ID)).resolves.toEqual({
      status: 'error',
      counts: { events: 0, milestones: 0, entries: 0 },
    });

    const rejected = client(() => Promise.reject(new Error('timeout')));
    await expect(recordVerifiedVisitProgress(rejected.supabase, REDEMPTION_ID)).resolves.toEqual({
      status: 'error',
      counts: { events: 0, milestones: 0, entries: 0 },
    });
  });
});
