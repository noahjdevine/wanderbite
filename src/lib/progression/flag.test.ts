import { afterEach, describe, expect, it } from 'vitest';
import {
  MEMBER_PROGRESSION_UI_FLAG,
  PROGRESSION_LEDGER_FLAG,
  memberProgressionUiEnabled,
  progressionLedgerEnabled,
} from '@/lib/progression/flag';

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

describe('member progression UI flag', () => {
  afterEach(() => {
    delete process.env.E09_MEMBER_PROGRESSION_UI_ENABLED;
    delete process.env.E09_PROGRESSION_LEDGER_ENABLED;
  });

  it('names the server flag', () => {
    expect(MEMBER_PROGRESSION_UI_FLAG).toBe('E09_MEMBER_PROGRESSION_UI_ENABLED');
  });

  it('stays off unless the value is exactly true', () => {
    expect(memberProgressionUiEnabled(undefined)).toBe(false);
    expect(memberProgressionUiEnabled('')).toBe(false);
    expect(memberProgressionUiEnabled('True')).toBe(false);
    expect(memberProgressionUiEnabled('TRUE')).toBe(false);
    expect(memberProgressionUiEnabled('1')).toBe(false);
    expect(memberProgressionUiEnabled('true')).toBe(true);
  });

  it('reads the env value only when no argument is passed', () => {
    delete process.env.E09_MEMBER_PROGRESSION_UI_ENABLED;
    expect(memberProgressionUiEnabled()).toBe(false);
    process.env.E09_MEMBER_PROGRESSION_UI_ENABLED = '';
    expect(memberProgressionUiEnabled()).toBe(false);
    process.env.E09_MEMBER_PROGRESSION_UI_ENABLED = 'True';
    expect(memberProgressionUiEnabled()).toBe(false);
    process.env.E09_MEMBER_PROGRESSION_UI_ENABLED = '1';
    expect(memberProgressionUiEnabled()).toBe(false);
    process.env.E09_MEMBER_PROGRESSION_UI_ENABLED = 'true';
    expect(memberProgressionUiEnabled()).toBe(true);
  });

  it('does not follow the ledger writer flag', () => {
    process.env.E09_PROGRESSION_LEDGER_ENABLED = 'true';
    delete process.env.E09_MEMBER_PROGRESSION_UI_ENABLED;
    expect(memberProgressionUiEnabled()).toBe(false);
    expect(progressionLedgerEnabled()).toBe(true);
  });
});
