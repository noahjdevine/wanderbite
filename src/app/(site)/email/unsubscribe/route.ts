import { NextResponse } from 'next/server';
import { normalizeMailbox } from '@/lib/email-address';
import { verifyAdventureReminderUnsubscribe } from '@/lib/email-unsubscribe';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

function page(title: string, body: string, status: number): NextResponse {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
</head>
<body style="margin:0;background:#faf7f4;color:#1a1a1a;font-family:ui-sans-serif,system-ui,sans-serif;">
  <main style="max-width:32rem;margin:4rem auto;padding:2rem;background:#fff;border:1px solid #eee6df;border-radius:12px;">
    ${body}
  </main>
</body>
</html>`;
  return new NextResponse(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function genericFailure(): NextResponse {
  return page(
    'Unsubscribe link',
    '<h1 style="font-size:1.5rem;margin:0 0 0.75rem;">This unsubscribe link is not valid.</h1><p style="margin:0;color:#5c534c;">No email preference was changed.</p>',
    400,
  );
}

async function oneClickBody(request: Request): Promise<boolean> {
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('multipart/form-data')) {
    const form = await request.formData();
    return form.get('List-Unsubscribe') === 'One-Click';
  }
  if (type.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(await request.text());
    return params.get('List-Unsubscribe') === 'One-Click';
  }
  return false;
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token');
  const claims = verifyAdventureReminderUnsubscribe(token);
  if (!claims || !token) return genericFailure();

  const action = `/email/unsubscribe?token=${encodeURIComponent(token)}`;
  return page(
    'Unsubscribe from adventure reminders',
    `<h1 style="font-size:1.5rem;margin:0 0 0.75rem;">Unsubscribe from adventure reminders?</h1>
     <p style="margin:0 0 1.25rem;color:#5c534c;">This does not turn off subscription receipts or account security messages.</p>
     <form method="post" action="${escapeHtml(action)}">
       <input type="hidden" name="List-Unsubscribe" value="One-Click" />
       <button type="submit" style="background:#E85D26;color:#fff;border:0;border-radius:8px;padding:0.8rem 1.2rem;font-weight:600;">Unsubscribe</button>
     </form>`,
    200,
  );
}

export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get('token');
  const claims = verifyAdventureReminderUnsubscribe(token);
  if (!claims) return genericFailure();

  let oneClick = false;
  try {
    oneClick = await oneClickBody(request);
  } catch {
    return genericFailure();
  }
  if (!oneClick) return genericFailure();

  const admin = getSupabaseAdmin();
  const { data: profile, error: profileError } = await admin
    .from('user_profiles')
    .select('email')
    .eq('id', claims.userId)
    .maybeSingle();
  if (profileError) {
    return page(
      'Unsubscribe',
      '<h1 style="font-size:1.5rem;margin:0 0 0.75rem;">Try again.</h1><p style="margin:0;color:#5c534c;">No email preference was changed.</p>',
      500,
    );
  }

  const current = normalizeMailbox(profile?.email);
  if (!current || current !== claims.email) return genericFailure();

  const { error } = await admin.from('email_topic_preferences').upsert(
    {
      user_id: claims.userId,
      topic: claims.topic,
      opted_out: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,topic' },
  );
  if (error) {
    return page(
      'Unsubscribe',
      '<h1 style="font-size:1.5rem;margin:0 0 0.75rem;">Try again.</h1><p style="margin:0;color:#5c534c;">No email preference was changed.</p>',
      500,
    );
  }

  return page(
    'Unsubscribed',
    '<h1 style="font-size:1.5rem;margin:0 0 0.75rem;">You are unsubscribed from adventure reminders.</h1><p style="margin:0;color:#5c534c;">Subscription receipts and account security messages are unchanged.</p>',
    200,
  );
}
