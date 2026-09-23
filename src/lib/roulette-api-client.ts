import type { RouletteApiResult } from '@/components/roulette/roulette-client';
import type { RouletteSpinPayload } from '@/lib/roulette-options';

type RouletteApiJson = { error?: string } & Partial<RouletteApiResult>;

function parseRouletteResponseBody(text: string): RouletteApiJson | null {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as RouletteApiJson;
  } catch {
    return null;
  }
}

async function postRouletteOnce(
  payload: RouletteSpinPayload,
  idempotencyKey: string,
): Promise<{ ok: true; data: RouletteApiResult } | { ok: false; error: string }> {
  const res = await fetch('/api/roulette', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ ...payload, idempotencyKey }),
  });

  const text = await res.text();
  const data = parseRouletteResponseBody(text);

  if (!data) {
    const hint =
      res.status === 504 || res.status === 502
        ? 'The spin took too long. Please try again.'
        : 'Server returned an empty response. Please try again.';
    return { ok: false, error: hint };
  }

  if (!res.ok) {
    return {
      ok: false,
      error: data.error ?? `Something went wrong (${res.status}). Please try again.`,
    };
  }

  if (!data.restaurantId || !data.restaurantName || !data.reason) {
    return { ok: false, error: 'We got an unexpected response. Please try again.' };
  }

  return {
    ok: true,
    data: {
      restaurantId: data.restaurantId,
      restaurantName: data.restaurantName,
      reason: data.reason,
      vibeMatch: data.vibeMatch ?? null,
      suggestedDish: data.suggestedDish ?? null,
      cuisine_tags: data.cuisine_tags ?? null,
      neighborhood: data.neighborhood ?? null,
      address: data.address ?? null,
      price_range: data.price_range ?? null,
      image_url: data.image_url ?? null,
      google_place_id: data.google_place_id ?? null,
      selectionMode:
        data.selectionMode === 'ai' || data.selectionMode === 'random_fallback'
          ? data.selectionMode
          : 'random_fallback',
    },
  };
}

/** POST /api/roulette. Client UUID is minted per spin and reused on one network retry. */
export async function postRouletteSpin(
  payload: RouletteSpinPayload,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<{ ok: true; data: RouletteApiResult } | { ok: false; error: string }> {
  try {
    return await postRouletteOnce(payload, idempotencyKey);
  } catch {
    try {
      return await postRouletteOnce(payload, idempotencyKey);
    } catch {
      return { ok: false, error: 'Network error. Check your connection and try again.' };
    }
  }
}
