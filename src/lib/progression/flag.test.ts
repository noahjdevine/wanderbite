import { afterEach, describe, expect, it } from 'vitest';
import { PROGRESSION_LEDGER_FLAG, progressionLedgerEnabled } from '@/lib/progression/flag';

describe('progression ledger flag', () => {
  afterEach(() => {
    delete process.env.E09_PROGRESSION_LEDGER_ENABLED;
  });

  it('names the server flag', () => {
    expect(PROGRESSION_LEDGER_FLAG).toBe('E09_PROGRESSION_LEDGER_ENABLED');
  });

  it('stays off unless the value is exactly true', () => {
    expect(progressionLedgerEnabled(undefined)).toBe(false);
    expect(progressionLedgerEnabled('')).toBe(false);
    expect(progressionLedgerEnabled('True')).toBe(false);
    expect(progressionLedgerEnabled('TRUE')).toBe(false);
    expect(progressionLedgerEnabled('1')).toBe(false);
    expect(progressionLedgerEnabled('true')).toBe(true);
  });

  it('reads the env value only when no argument is passed', () => {
    delete process.env.E09_PROGRESSION_LEDGER_ENABLED;
    expect(progressionLedgerEnabled()).toBe(false);
    process.env.E09_PROGRESSION_LEDGER_ENABLED = '';
    expect(progressionLedgerEnabled()).toBe(false);
    process.env.E09_PROGRESSION_LEDGER_ENABLED = 'True';
    expect(progressionLedgerEnabled()).toBe(false);
    process.env.E09_PROGRESSION_LEDGER_ENABLED = '1';
    expect(progressionLedgerEnabled()).toBe(false);
    process.env.E09_PROGRESSION_LEDGER_ENABLED = 'true';
    expect(progressionLedgerEnabled()).toBe(true);
  });
});
