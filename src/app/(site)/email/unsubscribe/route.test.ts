import { beforeEach, describe, expect, it, vi } from 'vitest';

const upsert = vi.fn();
const maybeSingle = vi.fn();
const from = vi.fn(() => ({
  select: () => ({
    eq: () => ({ maybeSingle }),
  }),
  upsert,
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ from }),
}));

import { GET, POST } from '@/app/(site)/email/unsubscribe/route';
import { signAdventureReminderUnsubscribe } from '@/lib/email-unsubscribe';

const USER = '15000000-0000-4000-8000-000000000001';

function tokenFor(email: string): string {
  const token = signAdventureReminderUnsubscribe({ userId: USER, email });
  if (!token) throw new Error('token was not signed');
  return token;
}

function post(token: string, body = 'List-Unsubscribe=One-Click', contentType = 'application/x-www-form-urlencoded') {
  return new Request(`https://wanderbite.test/email/unsubscribe?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  });
}

describe('unsubscribe route', () => {
  beforeEach(() => {
    upsert.mockReset();
    maybeSingle.mockReset();
    from.mockClear();
    upsert.mockResolvedValue({ error: null });
    maybeSingle.mockResolvedValue({ data: { email: 'member@example.com' }, error: null });
    vi.unstubAllEnvs();
    vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET', 'current-secret');
    vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET_PREVIOUS', '');
  });

  it('does not opt out on GET', async () => {
    const token = tokenFor('member@example.com');
    const response = await GET(
      new Request(`https://wanderbite.test/email/unsubscribe?token=${encodeURIComponent(token)}`),
    );
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Unsubscribe from adventure reminders?');
    expect(html).not.toContain('You are unsubscribed');
    expect(from).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('opts out on a one-click POST with no session when the address matches', async () => {
    const token = tokenFor('Member@Example.com');
    const response = await POST(post(token));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('You are unsubscribed from adventure reminders.');
    expect(response.headers.get('location')).toBeNull();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: USER,
        topic: 'adventure_reminders',
        opted_out: true,
      }),
      { onConflict: 'user_id,topic' },
    );
  });

  it('accepts multipart one-click and leaves an old address unchanged', async () => {
    const token = tokenFor('member@example.com');
    const form = new FormData();
    form.set('List-Unsubscribe', 'One-Click');
    const multipart = new Request(
      `https://wanderbite.test/email/unsubscribe?token=${encodeURIComponent(token)}`,
      { method: 'POST', body: form },
    );
    expect((await POST(multipart)).status).toBe(200);

    upsert.mockClear();
    maybeSingle.mockResolvedValue({ data: { email: 'new@example.com' }, error: null });
    const stale = await POST(post(token));
    expect(stale.status).toBe(400);
    expect(await stale.text()).toContain('No email preference was changed.');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('accepts the previous secret and fails closed after it is removed', async () => {
    vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET', 'old-secret');
    const token = tokenFor('member@example.com');
    vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET', 'new-secret');
    vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET_PREVIOUS', 'old-secret');
    expect((await POST(post(token))).status).toBe(200);

    upsert.mockClear();
    vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET_PREVIOUS', '');
    const removed = await POST(post(token));
    expect(removed.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });
});
