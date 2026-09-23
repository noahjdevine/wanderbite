import {
  legacyPhotoCredit,
  type PhotoCredit,
} from '@/lib/google-photo-credit';
import { isGooglePlacesOutboundDisabled } from '@/lib/restaurant-image';

export type PlaceSearchResult = {
  placeId: string | null;
  hasPhoto: boolean;
};

const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PLACE_PHOTO_FETCH_TIMEOUT_MS = 4_000;

export type LegacyPlacePhotoResult =
  | {
      ok: true;
      bytes: Uint8Array;
      contentType: string;
      credit: PhotoCredit[] | null;
    }
  | {
      ok: false;
      reason:
        | 'disabled'
        | 'no_photo'
        | 'unsafe_credit'
        | 'oversize'
        | 'timeout'
        | 'failed';
    };

/** True if at least one significant word from the restaurant name appears in the place name (case-insensitive). */
function placeNameMatchesRestaurant(
  restaurantName: string,
  returnedPlaceName: string | null | undefined
): boolean {
  if (!returnedPlaceName?.trim()) return false;
  const placeLower = returnedPlaceName.toLowerCase();
  const words = restaurantName
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter((w) => w.length >= 2);
  if (words.length === 0) return false;
  return words.some((w) => placeLower.includes(w));
}

function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === 'TimeoutError' || err.name === 'AbortError';
}

function imageContentType(header: string | null): string | null {
  const base = header?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (base === 'image/jpeg' || base === 'image/png' || base === 'image/webp') {
    return base;
  }
  return null;
}

/** Reads a response body up to maxBytes. Cancels the stream once the cap is passed. */
export async function readBoundedBytes(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array | 'oversize' | 'empty'> {
  if (!body) return 'empty';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return 'oversize';
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) return 'empty';
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Find a Google Place for a restaurant in McKinney, TX.
 * Never throws. Does not return a photo URL or the Places body.
 */
export async function findRestaurantPlace(
  name: string,
  _address: string
): Promise<PlaceSearchResult> {
  if (isGooglePlacesOutboundDisabled()) {
    return { placeId: null, hasPhoto: false };
  }
  const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!key) {
    return { placeId: null, hasPhoto: false };
  }

  const trimmedName = name.trim();
  if (!trimmedName) {
    return { placeId: null, hasPhoto: false };
  }

  const input = `${trimmedName} restaurant McKinney TX`;

  try {
    const params = new URLSearchParams({
      input,
      inputtype: 'textquery',
      fields: 'place_id,name,photos',
      locationbias: 'circle:50000@33.1984,-96.6397',
      key,
    });
    const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?${params.toString()}`;
    const res = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(PLACE_PHOTO_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { placeId: null, hasPhoto: false };
    }
    const data = (await res.json()) as {
      status?: string;
      candidates?: {
        place_id?: string;
        name?: string;
        photos?: { photo_reference?: string }[];
      }[];
    };

    if (data.status !== 'OK' || !data.candidates?.length) {
      return { placeId: null, hasPhoto: false };
    }

    const first = data.candidates[0];
    if (!placeNameMatchesRestaurant(trimmedName, first?.name)) {
      return { placeId: null, hasPhoto: false };
    }

    const placeId = first?.place_id ?? null;
    const hasPhoto = Boolean(first?.photos?.[0]?.photo_reference);
    return { placeId, hasPhoto };
  } catch {
    return { placeId: null, hasPhoto: false };
  }
}

/**
 * One Legacy Details + Photo fetch. Attribution and bytes come from the same
 * photo_reference. The credentialed URL and the JSON body are not returned.
 */
export async function fetchLegacyPlacePhoto(
  placeId: string,
): Promise<LegacyPlacePhotoResult> {
  if (isGooglePlacesOutboundDisabled()) return { ok: false, reason: 'disabled' };
  const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
  const pid = placeId.trim();
  if (!key || !pid) return { ok: false, reason: 'failed' };

  try {
    const detailsParams = new URLSearchParams({
      place_id: pid,
      fields: 'photos',
      key,
    });
    const detailsRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?${detailsParams.toString()}`,
      {
        cache: 'no-store',
        signal: AbortSignal.timeout(PLACE_PHOTO_FETCH_TIMEOUT_MS),
      },
    );
    if (!detailsRes.ok) return { ok: false, reason: 'failed' };

    const details = (await detailsRes.json()) as {
      status?: string;
      result?: {
        photos?: {
          photo_reference?: string;
          html_attributions?: string[];
        }[];
      };
    };
    if (details.status !== 'OK') return { ok: false, reason: 'no_photo' };

    const photo = details.result?.photos?.[0];
    const ref = photo?.photo_reference;
    if (!ref) return { ok: false, reason: 'no_photo' };

    const credit = legacyPhotoCredit(photo?.html_attributions);
    if (credit === 'unsafe') return { ok: false, reason: 'unsafe_credit' };

    const photoParams = new URLSearchParams({
      maxwidth: '800',
      photo_reference: ref,
      key,
    });
    const photoRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/photo?${photoParams.toString()}`,
      {
        cache: 'no-store',
        redirect: 'follow',
        signal: AbortSignal.timeout(PLACE_PHOTO_FETCH_TIMEOUT_MS),
      },
    );
    if (!photoRes.ok) return { ok: false, reason: 'failed' };

    const contentType = imageContentType(photoRes.headers.get('content-type'));
    if (!contentType) {
      await photoRes.body?.cancel();
      return { ok: false, reason: 'failed' };
    }

    const bytes = await readBoundedBytes(photoRes.body, PHOTO_MAX_BYTES);
    if (bytes === 'oversize') return { ok: false, reason: 'oversize' };
    if (bytes === 'empty') return { ok: false, reason: 'failed' };
    return { ok: true, bytes, contentType, credit };
  } catch (err) {
    if (isTimeoutError(err)) return { ok: false, reason: 'timeout' };
    return { ok: false, reason: 'failed' };
  }
}
