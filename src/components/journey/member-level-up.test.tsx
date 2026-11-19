import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemberProgressionSummary } from '@/lib/progression/read-model';

const loadMemberProgression = vi.fn();
const createClient = vi.fn();

vi.mock('canvas-confetti', () => ({
  default: vi.fn(),
}));

vi.mock('@/lib/progression/member-progression', () => ({
  loadMemberProgression: (...args: unknown[]) => loadMemberProgression(...args),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClient(),
}));

import { MemberLevelUpCelebration } from '@/components/journey/member-level-up';

const summary: MemberProgressionSummary = {
  xp: 300,
  visits: 1,
  level: 1,
  name: 'The Explorer',
  nextLevel: null,
  progressPercent: 0,
  milestones: [
    {
      id: 'm1',
      level: 1,
      name: 'The Explorer',
      reachedAt: '2026-11-14T18:00:00.000Z',
      quarterKey: '2026-Q4',
      hasEntry: false,
    },
  ],
  entriesByQuarter: [],
  consistent: true,
  ignored: { events: 0, milestones: 0, entries: 0 },
};

describe('member level-up host', () => {
  beforeEach(() => {
    loadMemberProgression.mockReset();
    createClient.mockReset();
    createClient.mockResolvedValue({ auth: {} });
    loadMemberProgression.mockResolvedValue({ ok: true, summary });
    localStorage.clear();
    delete process.env.E09_MEMBER_PROGRESSION_UI_ENABLED;
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    delete process.env.E09_MEMBER_PROGRESSION_UI_ENABLED;
  });

  it('reads nothing and shows nothing when the member progression flag is off', async () => {
    for (const value of [undefined, '', 'True', '1'] as const) {
      loadMemberProgression.mockClear();
      createClient.mockClear();
      if (value === undefined) delete process.env.E09_MEMBER_PROGRESSION_UI_ENABLED;
      else process.env.E09_MEMBER_PROGRESSION_UI_ENABLED = value;
      const view = render(await MemberLevelUpCelebration());
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(loadMemberProgression).not.toHaveBeenCalled();
      expect(createClient).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it('shows an unseen level when the flag is on and stays closed after it was seen', async () => {
    process.env.E09_MEMBER_PROGRESSION_UI_ENABLED = 'true';
    render(await MemberLevelUpCelebration());
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(loadMemberProgression).toHaveBeenCalledTimes(1);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('The Explorer');
    cleanup();

    localStorage.setItem('wb:levelup-seen:m1', '1');
    render(await MemberLevelUpCelebration());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('adds nothing when the ledger cannot be read', async () => {
    process.env.E09_MEMBER_PROGRESSION_UI_ENABLED = 'true';
    loadMemberProgression.mockResolvedValue({ ok: false, error: 'signed_out' });
    render(await MemberLevelUpCelebration());
    expect(screen.queryByRole('dialog')).toBeNull();

    loadMemberProgression.mockRejectedValue(new Error('down'));
    render(await MemberLevelUpCelebration());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is placed on Challenges, the show-code screen, and the dashboard ticket', () => {
    const root = process.cwd();
    for (const file of [
      'src/app/(site)/challenges/page.tsx',
      'src/app/(site)/challenges/show/[redemptionId]/page.tsx',
      'src/app/(site)/dashboard/page.tsx',
    ]) {
      expect(readFileSync(path.join(root, file), 'utf8')).toContain('<MemberLevelUpCelebration />');
    }
    expect(readFileSync(path.join(root, 'src/components/journey/progression-panel.tsx'), 'utf8')).toContain(
      '<LevelUpCelebration enabled milestones={summary.milestones} />',
    );
  });
});
