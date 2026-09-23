import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Webhook } from 'standardwebhooks';
import { handleResendWebhook } from '@/lib/resend-webhook';

const SECRET = `whsec_${Buffer.from('g15-webhook-secret-32-bytes-long').toString('base64')}`;

function event(type: string, extra: Record<string, unknown> = {}, to: string[] = ['member@example.com']) {
  return {
    type,
    created_at: '2026-09-23T00:00:00.000Z',
    data: {
      created_at: '2026-09-23T00:00:00.000Z',
      email_id: 'em_1',
      message_id: 'm1',
      from: 'Wanderbite <noreply@wanderbite.com>',
      to,
      subject: 'Hello',
      ...extra,
    },
  };
}

function signed(raw: string, secret = SECRET, id = 'msg_test') {
  const wh = new Webhook(secret);
  const timestamp = new Date();
  const signature = wh.sign(id, timestamp, raw);
  return new Request('https://wanderbite.test/api/webhooks/resend', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'svix-id': id,
      'svix-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
      'svix-signature': signature,
    },
    body: raw,
  });
}

function admin() {
  const calls: unknown[] = [];
  let error: { message: string } | null = null;
  let data: string | null = 'applied';
  const supabase = {
    rpc: vi.fn(async (_fn: string, args: unknown) => {
      calls.push(args);
      return { data, error };
    }),
  };
  return {
    supabase: supabase as never,
    calls,
    fail: () => {
      error = { message: 'insert failed' };
      data = null;
    },
    duplicate: () => {
      data = 'duplicate';
    },
  };
}

describe('handleResendWebhook', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('RESEND_WEBHOOK_SECRET', SECRET);
    vi.stubEnv('RESEND_API_KEY', 're_test');
  });

  it('writes nothing when the secret or signature is missing', async () => {
    const db = admin();
    const missing = await handleResendWebhook({
      request: signed('{}', SECRET),
      supabase: db.supabase,
      secret: ' ',
    });
    expect(missing.status).toBe(400);
    expect(db.calls).toHaveLength(0);

    const otherSecret = `whsec_${Buffer.from('another-webhook-secret-value!!').toString('base64')}`;
    const bad = await handleResendWebhook({
      request: signed(JSON.stringify(event('email.complained')), otherSecret),
      supabase: db.supabase,
    });
    expect(bad.status).toBe(400);
    expect(db.calls).toHaveLength(0);
  });

  it('verifies the raw body and rejects a re-serialized JSON body', async () => {
    const raw = `{
      "type": "email.complained",
      "created_at": "2026-09-23T00:00:00.000Z",
      "data": {
        "created_at": "2026-09-23T00:00:00.000Z",
        "email_id": "em_1",
        "message_id": "m1",
        "from": "Wanderbite <noreply@wanderbite.com>",
        "to": ["member@example.com"],
        "subject": "Hello"
      }
    }`;
    const db = admin();
    const ok = await handleResendWebhook({ request: signed(raw), supabase: db.supabase });
    expect(ok.status).toBe(200);
    expect(db.calls).toHaveLength(1);

    const reserialized = JSON.stringify(JSON.parse(raw));
    expect(reserialized).not.toBe(raw);
    const request = signed(raw);
    const headers = request.headers;
    const forged = new Request(request.url, {
      method: 'POST',
      headers,
      body: reserialized,
    });
    const rejected = await handleResendWebhook({ request: forged, supabase: db.supabase });
    expect(rejected.status).toBe(400);
    expect(db.calls).toHaveLength(1);
  });

  it('suppresses permanent bounces, complaints, and email.suppressed once per address', async () => {
    const cases = [
      event('email.bounced', { bounce: { message: '550', subType: 'General', type: 'Permanent' } }),
      event('email.complained'),
      event('email.suppressed', { suppressed: { message: 'on the list', type: 'bounce' } }),
    ];
    for (const [index, body] of cases.entries()) {
      const db = admin();
      const result = await handleResendWebhook({
        request: signed(JSON.stringify(body), SECRET, `msg_${index}`),
        supabase: db.supabase,
      });
      expect(result.status).toBe(200);
      expect(db.calls[0]).toMatchObject({
        p_address: 'member@example.com',
        p_email_id: 'em_1',
        p_delivery_id: `msg_${index}`,
      });
      expect(JSON.stringify(db.calls[0])).not.toContain('550');
      expect(JSON.stringify(db.calls[0])).not.toContain('Hello');
    }
  });

  it('does not suppress a non-permanent bounce or an invalid recipient', async () => {
    const db = admin();
    const soft = await handleResendWebhook({
      request: signed(JSON.stringify(event('email.bounced', {
        bounce: { message: '452', subType: 'MailboxFull', type: 'Transient' },
      }))),
      supabase: db.supabase,
    });
    expect(soft.status).toBe(200);
    expect(db.calls).toHaveLength(0);

    const invalid = await handleResendWebhook({
      request: signed(JSON.stringify(event('email.complained', {}, ['not-an-email', 'other@example.com']))),
      supabase: db.supabase,
    });
    expect(invalid.status).toBe(400);
    expect(db.calls).toHaveLength(0);
  });

  it('returns 2xx for a duplicate delivery and 5xx when the insert fails', async () => {
    const body = JSON.stringify(event('email.complained'));
    const duplicate = admin();
    duplicate.duplicate();
    const again = await handleResendWebhook({
      request: signed(body, SECRET, 'msg_same'),
      supabase: duplicate.supabase,
    });
    expect(again.status).toBe(200);

    const failed = admin();
    failed.fail();
    const result = await handleResendWebhook({
      request: signed(body, SECRET, 'msg_fail'),
      supabase: failed.supabase,
    });
    expect(result.status).toBe(500);
    expect(failed.calls).toHaveLength(1);
  });
});
