import { NextResponse } from 'next/server';
import { handleResendWebhook } from '@/lib/resend-webhook';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const result = await handleResendWebhook({
    request,
    supabase: getSupabaseAdmin(),
  });
  return NextResponse.json(result.body, { status: result.status });
}
