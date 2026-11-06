import { afterEach, describe, expect, it } from 'vitest';
import { JOURNAL_REFLECTIONS_FLAG, journalReflectionsEnabled } from '@/lib/notes/flag';

describe('journal reflections flag', () => {
  afterEach(() => {
    delete process.env.E08_JOURNAL_REFLECTIONS_ENABLED;
  });

  it('names the server flag', () => {
    expect(JOURNAL_REFLECTIONS_FLAG).toBe('E08_JOURNAL_REFLECTIONS_ENABLED');
  });

  it('stays off unless the value is exactly true', () => {
    expect(journalReflectionsEnabled(undefined)).toBe(false);
    expect(journalReflectionsEnabled('')).toBe(false);
    expect(journalReflectionsEnabled('True')).toBe(false);
    expect(journalReflectionsEnabled('1')).toBe(false);
    expect(journalReflectionsEnabled('true')).toBe(true);
  });

  it('reads the env value only when no argument is passed', () => {
    delete process.env.E08_JOURNAL_REFLECTIONS_ENABLED;
    expect(journalReflectionsEnabled()).toBe(false);
    process.env.E08_JOURNAL_REFLECTIONS_ENABLED = '';
    expect(journalReflectionsEnabled()).toBe(false);
    process.env.E08_JOURNAL_REFLECTIONS_ENABLED = 'True';
    expect(journalReflectionsEnabled()).toBe(false);
    process.env.E08_JOURNAL_REFLECTIONS_ENABLED = '1';
    expect(journalReflectionsEnabled()).toBe(false);
    process.env.E08_JOURNAL_REFLECTIONS_ENABLED = 'true';
    expect(journalReflectionsEnabled()).toBe(true);
  });
});
