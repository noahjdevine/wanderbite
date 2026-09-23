import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireUser = vi.fn();
const upsert = vi.fn();

vi.mock('@/lib/auth/require-user', () => ({
  requireUser: () => requireUser(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({ upsert }),
  }),
}));

import { updateAdventureReminderOptOut } from '@/app/actions/update-email-preferences';

const USER = '15000000-0000-4000-8000-000000000001';

describe('updateAdventureReminderOptOut', () => {
  beforeEach(() => {
    requireUser.mockReset();
    upsert.mockReset();
    requireUser.mockResolvedValue({ ok: true, userId: USER, email: 'member@example.com' });
    upsert.mockResolvedValue({ error: null });
  });

  it('writes the current account and does not trust a different rendered user', async () => {
    const saved = await updateAdventureReminderOptOut(true, USER);
    expect(saved).toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: USER,
        topic: 'adventure_reminders',
        opted_out: true,
      }),
      { onConflict: 'user_id,topic' },
    );

    upsert.mockClear();
    const switched = await updateAdventureReminderOptOut(
      true,
      '15000000-0000-4000-8000-000000000002',
    );
    expect(switched.ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('can turn reminders back on for the current account', async () => {
    const saved = await updateAdventureReminderOptOut(false, USER);
    expect(saved).toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ opted_out: false }),
      { onConflict: 'user_id,topic' },
    );
  });
});
