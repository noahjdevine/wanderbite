import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { verifyCronAuth } from '@/lib/cron-auth';
import { beginCronRun, completeCronRun } from '@/lib/cron-runs';
import { fetchPlacePhotoBytes } from '@/lib/google-places';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_PER_RUN = 50;
const STORAGE_BUCKET = 'restaurant-photos';

/** Only backfill missing images; preserve admin manual image_url overrides and cached Supabase URLs. */
function needsPhotoBackfill(imageUrl: string | null | undefined): boolean {
  return !imageUrl?.trim();
}

type Outcome = {
  restaurantId: string;
  name: string;
  status: 'refreshed' | 'skipped' | 'failed';
  reason?: string;
  imageUrl?: string;
};

function photoExtension(contentType: string): string {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  return 'jpg';
}

export async function GET(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const runId = await beginCronRun('refresh-restaurant-photos');

  try {
    const admin = getSupabaseAdmin();

    const { data: rows, error } = await admin
      .from('restaurants')
      .select('id, name, google_place_id, image_url')
      .eq('status', 'active')
      .not('google_place_id', 'is', null)
      .order('updated_at', { ascending: true, nullsFirst: true })
      .limit(MAX_PER_RUN * 2);

    if (error) {
      await completeCronRun(runId, { status: 'failed', error: error.message });
      Sentry.captureException(new Error(error.message), {
        tags: { cron: 'refresh-restaurant-photos' },
      });
      await Sentry.flush(2000);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const candidates = (
      (rows ?? []) as {
        id: string;
        name: string;
        google_place_id: string;
        image_url: string | null;
      }[]
    )
      .filter((r) => needsPhotoBackfill(r.image_url))
      .slice(0, MAX_PER_RUN);

    const outcomes: Outcome[] = [];
    let refreshed = 0;
    let skipped = 0;
    let failed = 0;

    for (const restaurant of candidates) {
      try {
        const photo = await fetchPlacePhotoBytes(restaurant.google_place_id);
        if (!photo) {
          skipped++;
          outcomes.push({
            restaurantId: restaurant.id,
            name: restaurant.name,
            status: 'skipped',
            reason: 'no photo returned from google',
          });
          continue;
        }

        const ext = photoExtension(photo.contentType);
        const path = `${restaurant.id}/${Date.now()}.${ext}`;
        const buffer = new Uint8Array(photo.body);

        const { error: uploadError } = await admin.storage
          .from(STORAGE_BUCKET)
          .upload(path, buffer, {
            contentType: photo.contentType,
            cacheControl: 'public, max-age=604800',
            upsert: false,
          });

        if (uploadError) {
          failed++;
          outcomes.push({
            restaurantId: restaurant.id,
            name: restaurant.name,
            status: 'failed',
            reason: `upload: ${uploadError.message}`,
          });
          Sentry.captureMessage('Photo refresh upload failed', {
            level: 'warning',
            tags: { cron: 'refresh-restaurant-photos', restaurantId: restaurant.id },
            extra: { error: uploadError.message },
          });
          continue;
        }

        const { data: pub } = admin.storage.from(STORAGE_BUCKET).getPublicUrl(path);
        const publicUrl = pub.publicUrl;

        const { error: updateError } = await admin
          .from('restaurants')
          .update({ image_url: publicUrl })
          .eq('id', restaurant.id);

        if (updateError) {
          failed++;
          outcomes.push({
            restaurantId: restaurant.id,
            name: restaurant.name,
            status: 'failed',
            reason: `db update: ${updateError.message}`,
          });
          Sentry.captureMessage('Photo refresh db update failed', {
            level: 'warning',
            tags: { cron: 'refresh-restaurant-photos', restaurantId: restaurant.id },
            extra: { error: updateError.message },
          });
          continue;
        }

        refreshed++;
        outcomes.push({
          restaurantId: restaurant.id,
          name: restaurant.name,
          status: 'refreshed',
          imageUrl: publicUrl,
        });
      } catch (err) {
        failed++;
        const reason = err instanceof Error ? err.message : 'Unknown error';
        outcomes.push({
          restaurantId: restaurant.id,
          name: restaurant.name,
          status: 'failed',
          reason,
        });
        Sentry.captureException(err, {
          tags: { cron: 'refresh-restaurant-photos', restaurantId: restaurant.id },
        });
      }
    }

    const summary = {
      processed: candidates.length,
      refreshed,
      skipped,
      failed,
      maxPerRun: MAX_PER_RUN,
      outcomes,
    };

    await completeCronRun(runId, { status: 'success', result: summary });

    return NextResponse.json({
      processed: candidates.length,
      refreshed,
      skipped,
      failed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[cron] refresh-restaurant-photos:', err);
    Sentry.captureException(err, { tags: { cron: 'refresh-restaurant-photos' } });
    await completeCronRun(runId, { status: 'failed', error: message });
    await Sentry.flush(2000);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
