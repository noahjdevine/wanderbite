import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DRAWINGS_ADMIN_ACTIONS_FLAG,
  DRAWINGS_ADMIN_FLAG,
  DRAWINGS_CAMPAIGN_EDITOR_FLAG,
  DRAWINGS_FULFILLMENT_ACTIONS_FLAG,
  drawingsAdminActionsEnabled,
  drawingsAdminEnabled,
  drawingsCampaignEditorEnabled,
  drawingsFulfillmentActionsEnabled,
} from '@/lib/drawings/flag';

describe('drawingsAdminEnabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is true only when the value is exactly true', () => {
    expect(DRAWINGS_ADMIN_FLAG).toBe('E09_DRAWINGS_ADMIN_ENABLED');
    expect(drawingsAdminEnabled(undefined)).toBe(false);
    expect(drawingsAdminEnabled('')).toBe(false);
    expect(drawingsAdminEnabled('TRUE')).toBe(false);
    expect(drawingsAdminEnabled('True')).toBe(false);
    expect(drawingsAdminEnabled('1')).toBe(false);
    expect(drawingsAdminEnabled(' true')).toBe(false);
    expect(drawingsAdminEnabled('true ')).toBe(false);
    expect(drawingsAdminEnabled('false')).toBe(false);
    expect(drawingsAdminEnabled('true')).toBe(true);
  });

  it('reads E09_DRAWINGS_ADMIN_ENABLED when no argument is passed', () => {
    vi.stubEnv('E09_DRAWINGS_ADMIN_ENABLED', '');
    expect(drawingsAdminEnabled()).toBe(false);
    vi.stubEnv('E09_DRAWINGS_ADMIN_ENABLED', 'TRUE');
    expect(drawingsAdminEnabled()).toBe(false);
    vi.stubEnv('E09_DRAWINGS_ADMIN_ENABLED', 'true');
    expect(drawingsAdminEnabled()).toBe(true);
  });
});

describe('drawingsAdminActionsEnabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is true only when both flags are exactly true', () => {
    expect(DRAWINGS_ADMIN_ACTIONS_FLAG).toBe('E09_DRAWINGS_ADMIN_ACTIONS_ENABLED');
    const off = [undefined, '', 'TRUE', 'True', '1', ' true', 'true ', 'false'] as const;
    for (const actionsValue of off) {
      expect(drawingsAdminActionsEnabled(actionsValue, 'true')).toBe(false);
    }
    for (const adminValue of off) {
      expect(drawingsAdminActionsEnabled('true', adminValue)).toBe(false);
    }
    expect(drawingsAdminActionsEnabled('true', 'true')).toBe(true);
  });

  it('reads both env vars when no argument is passed', () => {
    vi.stubEnv('E09_DRAWINGS_ADMIN_ACTIONS_ENABLED', 'true');
    vi.stubEnv('E09_DRAWINGS_ADMIN_ENABLED', '');
    expect(drawingsAdminActionsEnabled()).toBe(false);
    vi.stubEnv('E09_DRAWINGS_ADMIN_ENABLED', 'true');
    vi.stubEnv('E09_DRAWINGS_ADMIN_ACTIONS_ENABLED', 'TRUE');
    expect(drawingsAdminActionsEnabled()).toBe(false);
    vi.stubEnv('E09_DRAWINGS_ADMIN_ACTIONS_ENABLED', 'true');
    expect(drawingsAdminActionsEnabled()).toBe(true);
  });
});

describe('drawingsFulfillmentActionsEnabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is true only when all three flags are exactly true', () => {
    expect(DRAWINGS_FULFILLMENT_ACTIONS_FLAG).toBe('E09_DRAWINGS_FULFILLMENT_ACTIONS_ENABLED');
    const off = [undefined, '', 'TRUE', 'True', '1', ' true', 'true ', 'false'] as const;
    for (const fulfillmentValue of off) {
      expect(drawingsFulfillmentActionsEnabled(fulfillmentValue, 'true', 'true')).toBe(false);
    }
    for (const actionsValue of off) {
      expect(drawingsFulfillmentActionsEnabled('true', actionsValue, 'true')).toBe(false);
    }
    for (const adminValue of off) {
      expect(drawingsFulfillmentActionsEnabled('true', 'true', adminValue)).toBe(false);
    }
    expect(drawingsFulfillmentActionsEnabled('true', 'true', 'true')).toBe(true);
  });

  it('reads all three env vars when no argument is passed', () => {
    vi.stubEnv('E09_DRAWINGS_FULFILLMENT_ACTIONS_ENABLED', 'true');
    vi.stubEnv('E09_DRAWINGS_ADMIN_ACTIONS_ENABLED', 'true');
    vi.stubEnv('E09_DRAWINGS_ADMIN_ENABLED', '');
    expect(drawingsFulfillmentActionsEnabled()).toBe(false);
    vi.stubEnv('E09_DRAWINGS_ADMIN_ENABLED', 'true');
    vi.stubEnv('E09_DRAWINGS_ADMIN_ACTIONS_ENABLED', 'TRUE');
    expect(drawingsFulfillmentActionsEnabled()).toBe(false);
    vi.stubEnv('E09_DRAWINGS_ADMIN_ACTIONS_ENABLED', 'true');
    vi.stubEnv('E09_DRAWINGS_FULFILLMENT_ACTIONS_ENABLED', 'TRUE');
    expect(drawingsFulfillmentActionsEnabled()).toBe(false);
    vi.stubEnv('E09_DRAWINGS_FULFILLMENT_ACTIONS_ENABLED', 'true');
    expect(drawingsFulfillmentActionsEnabled()).toBe(true);
  });
});

describe('drawingsCampaignEditorEnabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is true only when all three flags are exactly true', () => {
    expect(DRAWINGS_CAMPAIGN_EDITOR_FLAG).toBe('E09_DRAWINGS_CAMPAIGN_EDITOR_ENABLED');
    const off = [undefined, '', 'TRUE', 'True', '1', ' true', 'true ', 'false'] as const;
    for (const editorValue of off) {
      expect(drawingsCampaignEditorEnabled(editorValue, 'true', 'true')).toBe(false);
    }
    for (const actionsValue of off) {
      expect(drawingsCampaignEditorEnabled('true', actionsValue, 'true')).toBe(false);
    }
    for (const adminValue of off) {
      expect(drawingsCampaignEditorEnabled('true', 'true', adminValue)).toBe(false);
    }
    expect(drawingsCampaignEditorEnabled('true', 'true', 'true')).toBe(true);
  });

  it('reads all three env vars when no argument is passed', () => {
    vi.stubEnv('E09_DRAWINGS_CAMPAIGN_EDITOR_ENABLED', 'true');
    vi.stubEnv('E09_DRAWINGS_ADMIN_ACTIONS_ENABLED', 'true');
    vi.stubEnv('E09_DRAWINGS_ADMIN_ENABLED', '');
    expect(drawingsCampaignEditorEnabled()).toBe(false);
    vi.stubEnv('E09_DRAWINGS_ADMIN_ENABLED', 'true');
    vi.stubEnv('E09_DRAWINGS_ADMIN_ACTIONS_ENABLED', 'TRUE');
    expect(drawingsCampaignEditorEnabled()).toBe(false);
    vi.stubEnv('E09_DRAWINGS_ADMIN_ACTIONS_ENABLED', 'true');
    vi.stubEnv('E09_DRAWINGS_CAMPAIGN_EDITOR_ENABLED', 'TRUE');
    expect(drawingsCampaignEditorEnabled()).toBe(false);
    vi.stubEnv('E09_DRAWINGS_CAMPAIGN_EDITOR_ENABLED', 'true');
    expect(drawingsCampaignEditorEnabled()).toBe(true);
  });
});
