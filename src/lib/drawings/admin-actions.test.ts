import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DRAWING_ADMIN_ACTION_ERRORS,
  LIVE_CAMPAIGN_ACTIVATION_NOTE,
  drawingAdminActionMessage,
  drawingAdminActionOffers,
  drawingAdminRunByLabel,
} from '@/lib/drawings/admin-actions';

const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('drawingAdminActionOffers', () => {
  const cases: {
    status: string;
    mode: string;
    hasSelection: boolean;
    kinds: string[];
    note: string | null;
  }[] = [
    { status: 'draft', mode: 'sample', hasSelection: false, kinds: ['activate', 'close'], note: null },
    { status: 'draft', mode: 'sample', hasSelection: true, kinds: ['activate', 'close'], note: null },
    {
      status: 'draft',
      mode: 'live',
      hasSelection: false,
      kinds: ['close'],
      note: LIVE_CAMPAIGN_ACTIVATION_NOTE,
    },
    {
      status: 'draft',
      mode: 'live',
      hasSelection: true,
      kinds: ['close'],
      note: LIVE_CAMPAIGN_ACTIVATION_NOTE,
    },
    { status: 'active', mode: 'sample', hasSelection: false, kinds: ['close'], note: null },
    { status: 'active', mode: 'live', hasSelection: false, kinds: ['close'], note: null },
    { status: 'active', mode: 'sample', hasSelection: true, kinds: ['close'], note: null },
    { status: 'active', mode: 'live', hasSelection: true, kinds: ['close'], note: null },
    { status: 'closed', mode: 'sample', hasSelection: false, kinds: ['select'], note: null },
    { status: 'closed', mode: 'sample', hasSelection: true, kinds: [], note: null },
    { status: 'closed', mode: 'live', hasSelection: false, kinds: [], note: null },
    { status: 'closed', mode: 'live', hasSelection: true, kinds: [], note: null },
    { status: 'archived', mode: 'sample', hasSelection: false, kinds: [], note: null },
    { status: 'draft', mode: 'other', hasSelection: false, kinds: [], note: null },
  ];

  it('offers activate, close, or simulated selection only for the rows that allow them', () => {
    for (const row of cases) {
      const offer = drawingAdminActionOffers(row);
      expect(offer.actions.map((action) => action.kind), `${row.status}:${row.mode}:${row.hasSelection}`).toEqual(
        row.kinds,
      );
      expect(offer.note, `${row.status}:${row.mode}`).toBe(row.note);
      expect(offer.actions.some((action) => action.kind === 'activate' && row.mode === 'live')).toBe(false);
    }
  });

  it('uses a second-click confirm label and does not offer fulfillment', () => {
    const sample = drawingAdminActionOffers({ status: 'draft', mode: 'sample', hasSelection: false });
    expect(sample.actions.map((action) => action.confirmLabel)).toEqual(['Yes, activate', 'Yes, close']);
    const closed = drawingAdminActionOffers({ status: 'closed', mode: 'sample', hasSelection: false });
    expect(closed.actions[0]).toEqual({
      kind: 'select',
      label: 'Run simulated selection',
      confirmLabel: 'Yes, run simulated selection',
    });
    const labels = cases.flatMap((row) => drawingAdminActionOffers(row).actions.map((action) => action.label));
    expect(labels.join(' ')).not.toMatch(/fulfill|forfeit|ready|ship|email/i);
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
