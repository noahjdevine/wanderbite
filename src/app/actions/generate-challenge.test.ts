import { beforeEach, describe, expect, it, vi } from 'vitest';

const { blocked, forUser, requireUser, readWorkflow } = vi.hoisted(() => ({
  blocked: vi.fn(),
  forUser: vi.fn(),
  requireUser: vi.fn(),
  readWorkflow: vi.fn(),
}));

vi.mock('@/lib/challenges/load-monthly-reveal', () => ({
  memberGenerateBlocked: () => blocked(),
  revealInsteadError: () => 'Open Challenges and choose Reveal my challenges for this month.',
}));

vi.mock('@/lib/challenges/generate', () => ({
  generateMonthlyChallengeForUser: (...args: unknown[]) => forUser(...args),
  getCurrentChallengeForUser: vi.fn(),
}));

vi.mock('@/lib/challenges/workflow', () => ({
  readWorkflowVersion: (...args: unknown[]) => readWorkflow(...args),
}));

vi.mock('@/lib/auth/require-user', () => ({
  requireUser: () => requireUser(),
}));

import { generateMonthlyChallenge } from '@/app/actions/generate-challenge';

describe('generateMonthlyChallenge member gate', () => {
  beforeEach(() => {
    blocked.mockReset();
    forUser.mockReset();
    requireUser.mockReset();
    readWorkflow.mockReset();
    requireUser.mockResolvedValue({ ok: true, userId: 'user-1' });
    readWorkflow.mockResolvedValue('legacy');
    forUser.mockResolvedValue({ ok: true, data: { cycle: {}, items: [] } });
  });

  it('still generates when monthly reveal is off', async () => {
    blocked.mockResolvedValue(false);
    const result = await generateMonthlyChallenge();
    expect(result.ok).toBe(true);
    expect(forUser).toHaveBeenCalledWith('user-1');
  });

  it('does not create a cycle when the reveal schema is available', async () => {
    blocked.mockResolvedValue(true);
    const result = await generateMonthlyChallenge();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('monthly_reveal');
    expect(forUser).not.toHaveBeenCalled();
    expect(readWorkflow).not.toHaveBeenCalled();
  });
});
