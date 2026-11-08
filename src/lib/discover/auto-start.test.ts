import { beforeEach, describe, expect, it } from 'vitest';
import {
  claimDiscoverRun,
  forgetDiscoverAutoStartMemory,
  resetDiscoverAutoStartClaims,
} from '@/lib/discover/auto-start';

const TOKEN = '11111111-1111-4111-8111-111111111111';
const NEXT = '22222222-2222-4222-8222-222222222222';

describe('claimDiscoverRun', () => {
  beforeEach(() => {
    resetDiscoverAutoStartClaims();
  });

  it('claims a homepage submit once, including after a reload', () => {
    expect(claimDiscoverRun(TOKEN)).toBe(true);
    expect(claimDiscoverRun(TOKEN)).toBe(false);
    forgetDiscoverAutoStartMemory();
    expect(claimDiscoverRun(TOKEN)).toBe(false);
    expect(claimDiscoverRun(NEXT)).toBe(true);
  });
});
