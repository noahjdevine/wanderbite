import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACTIVE_CLOSE_CONFIRM_NOTE,
  CLOSED_WITHOUT_ACTIVATION_NOTE,
  DRAFT_CLOSE_CONFIRM_NOTE,
  DRAWING_ADMIN_ACTION_ERRORS,
  LIVE_CAMPAIGN_ACTIVATION_NOTE,
  drawingAdminActionMessage,
  drawingAdminActionOffers,
  drawingAdminRunByLabel,
} from '@/lib/drawings/admin-actions';

const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('drawingAdminActionOffers', () => {
  const statuses = ['draft', 'active', 'closed', 'archived'] as const;
  const modes = ['sample', 'live', 'other'] as const;
  const flags = [false, true] as const;

  function expected(state: {
    status: string;
    mode: string;
    hasSelection: boolean;
    activatedAtSet: boolean;
    closedAtSet: boolean;
  }): { kinds: string[]; note: string | null } {
    if (state.status === 'draft' && state.mode === 'sample') {
      return { kinds: ['activate', 'close'], note: null };
    }
    if (state.status === 'draft' && state.mode === 'live') {
      return { kinds: ['close'], note: LIVE_CAMPAIGN_ACTIVATION_NOTE };
    }
    if (state.status === 'active') return { kinds: ['close'], note: null };
    if (state.status === 'closed' && state.mode === 'sample' && !state.hasSelection) {
      if (state.activatedAtSet && state.closedAtSet) return { kinds: ['select'], note: null };
      return { kinds: [], note: CLOSED_WITHOUT_ACTIVATION_NOTE };
    }
    return { kinds: [], note: null };
  }

  const rows = statuses.flatMap((status) =>
    modes.flatMap((mode) =>
      flags.flatMap((hasSelection) =>
        flags.flatMap((activatedAtSet) =>
          flags.map((closedAtSet) => ({ status, mode, hasSelection, activatedAtSet, closedAtSet })),
        ),
      ),
    ),
  );

  it('offers an action for every status, mode, selection, and timestamp combination', () => {
    expect(rows).toHaveLength(96);
    for (const row of rows) {
      const offer = drawingAdminActionOffers(row);
      const want = expected(row);
      const label = `${row.status}:${row.mode}:sel=${row.hasSelection}:activated=${row.activatedAtSet}:closed=${row.closedAtSet}`;
      expect(offer.actions.map((action) => action.kind), label).toEqual(want.kinds);
      expect(offer.note, label).toBe(want.note);
      expect(offer.actions.some((action) => action.kind === 'activate' && row.mode === 'live'), label).toBe(false);
      for (const action of offer.actions) {
        if (action.kind === 'activate') {
          expect(action.confirmLabel, label).toBe('Yes, activate');
          expect(action.confirmNote, label).toBeUndefined();
        } else if (action.kind === 'close' && row.status === 'draft') {
          expect(action.label, label).toBe('Close');
          expect(action.confirmLabel, label).toBe('Yes, close without activating');
          expect(action.confirmNote, label).toBe(DRAFT_CLOSE_CONFIRM_NOTE);
        } else if (action.kind === 'close') {
          expect(action.label, label).toBe('Close');
          expect(action.confirmLabel, label).toBe('Yes, close');
          expect(action.confirmNote, label).toBe(ACTIVE_CLOSE_CONFIRM_NOTE);
        } else {
          expect(action, label).toEqual({
            kind: 'select',
            label: 'Run simulated selection',
            confirmLabel: 'Yes, run simulated selection',
          });
          expect(action.confirmNote, label).toBeUndefined();
        }
      }
      const text = [
        offer.note ?? '',
        ...offer.actions.flatMap((action) => [action.label, action.confirmLabel, action.confirmNote ?? '']),
      ].join(' ');
      expect(text, label).not.toMatch(/fulfill|forfeit|ready|ship|email/i);
    }
  });

  it('hides simulated selection unless the closed sample campaign was activated and then closed', () => {
    const offered = drawingAdminActionOffers({
      status: 'closed',
      mode: 'sample',
      hasSelection: false,
      activatedAtSet: true,
      closedAtSet: true,
    });
    expect(offered.actions.map((action) => action.kind)).toEqual(['select']);
    expect(offered.note).toBeNull();

    for (const activatedAtSet of flags) {
      for (const closedAtSet of flags) {
        if (activatedAtSet && closedAtSet) continue;
        const offer = drawingAdminActionOffers({
          status: 'closed',
          mode: 'sample',
          hasSelection: false,
          activatedAtSet,
          closedAtSet,
        });
        expect(offer.actions, `${activatedAtSet}:${closedAtSet}`).toEqual([]);
        expect(offer.note, `${activatedAtSet}:${closedAtSet}`).toBe(CLOSED_WITHOUT_ACTIVATION_NOTE);
      }
    }

    const selected = drawingAdminActionOffers({
      status: 'closed',
      mode: 'sample',
      hasSelection: true,
      activatedAtSet: false,
      closedAtSet: false,
    });
    expect(selected).toEqual({ actions: [], note: null });
    const live = drawingAdminActionOffers({
      status: 'closed',
      mode: 'live',
      hasSelection: false,
      activatedAtSet: false,
      closedAtSet: true,
    });
    expect(live).toEqual({ actions: [], note: null });
  });
});

describe('drawingAdminRunByLabel', () => {
  it('is admin: plus the first 8 characters, and never the email or the full id', () => {
    expect(drawingAdminRunByLabel(ADMIN_ID)).toBe('admin:aaaaaaaa');
    expect(drawingAdminRunByLabel(ADMIN_ID.toUpperCase())).toBe('admin:aaaaaaaa');
    const label = drawingAdminRunByLabel(ADMIN_ID);
    expect(label).not.toContain('@');
    expect(label).not.toContain(ADMIN_ID);
    expect(label?.slice('admin:'.length)).toHaveLength(8);
  });

  it('rejects a blank, short, or non-hex prefix before any store call', () => {
    expect(drawingAdminRunByLabel('')).toBeNull();
    expect(drawingAdminRunByLabel('abc')).toBeNull();
    expect(drawingAdminRunByLabel('aaaaaaaa')).toBeNull();
    expect(drawingAdminRunByLabel('not-a-uuid-value')).toBeNull();
    expect(drawingAdminRunByLabel('admin@example.com')).toBeNull();
  });
});

describe('drawingAdminActionMessage', () => {
  it('maps every action code to a plain message and does not echo the code', () => {
    for (const code of DRAWING_ADMIN_ACTION_ERRORS) {
      const message = drawingAdminActionMessage(code);
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toBe(code);
      expect(message).not.toMatch(/@/);
      expect(message).not.toContain(ADMIN_ID);
    }
    expect(drawingAdminActionMessage('live_activation_blocked')).toBe(LIVE_CAMPAIGN_ACTIVATION_NOTE);
    expect(drawingAdminActionMessage('already_selected')).toBe('This campaign already has a simulated selection.');
    expect(drawingAdminActionMessage('campaign_window_ended')).toMatch(/window has ended/);
    expect(drawingAdminActionMessage('campaign_invalid')).toBe(
      "This campaign's setup doesn't pass its checks, so its status can't change.",
    );
  });
});

describe('admin action dates under TZ=UTC and TZ=America/Chicago', () => {
  it('shows 2027-01-01T05:30:00Z as Dec 31, 2026 and rejects activation at ends_at', () => {
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const probe = 'src/lib/drawings/admin-actions.tz-probe.ts';
    const run = (tz: string) => {
      const result = spawnSync(tsx, [probe], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, TZ: tz },
      });
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout) as { closedOn: string; atEnd: string; before: string };
    };
    const utc = run('UTC');
    const chicago = run('America/Chicago');
    expect(chicago).toEqual(utc);
    expect(utc.closedOn).toBe('Dec 31, 2026');
    expect(utc.atEnd).toBe('campaign_window_ended');
    expect(utc.before).toBe('ok');
  }, 20000);
});
