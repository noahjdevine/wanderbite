import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';

/** Google photo bytes are not copied into storage. A leftover scheduler must not call Places. */
export async function GET(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  return NextResponse.json({ skipped: 'google_photo_rehost_disabled' });
}
