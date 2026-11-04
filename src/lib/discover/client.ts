import type { RecipeQaAnswerView } from '@/components/recipes/recipe-qa-answer';
import type { DiscoverEvent } from '@/lib/discover/events';
import {
  DISCOVER_NETWORK_ERROR,
  DISCOVER_STREAM_BROKE,
  DISCOVER_UNEXPECTED_RESPONSE,
  messageForDiscoverStatus,
} from '@/lib/discover/screen';
import { parseDiscoverSseStream } from '@/lib/discover/sse-client';
import type { RouletteSpinPayload } from '@/lib/roulette-options';

export type DiscoverAskPayload = RouletteSpinPayload & {
  excludeRestaurantIds?: readonly string[];
};

export type DiscoverHttpResult =
  | { kind: 'events'; events: DiscoverEvent[] }
  | { kind: 'recipe'; qa: RecipeQaAnswerView }
  | { kind: 'error'; status: number; message: string };

function parseJsonObject(text: string): Record<string, unknown> | null {
  if (!text.trim()) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function recipeFromJson(value: unknown): RecipeQaAnswerView | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const qa = value as Record<string, unknown>;
  if (typeof qa.answer !== 'string' || !qa.answer.trim()) return null;
  const recipes = Array.isArray(qa.recipes) ? qa.recipes : [];
  const visitLines = Array.isArray(qa.visitLines)
    ? qa.visitLines.filter((line): line is string => typeof line === 'string')
    : [];
  return {
    answer: qa.answer,
    notice: typeof qa.notice === 'string' ? qa.notice : null,
    recipes: recipes as RecipeQaAnswerView['recipes'],
    generatedLabel: typeof qa.generatedLabel === 'string' ? qa.generatedLabel : null,
    generatedText: typeof qa.generatedText === 'string' ? qa.generatedText : null,
    visitLines,
  };
}

export async function readDiscoverHttp(response: Response): Promise<DiscoverHttpResult> {
  const type = response.headers.get('content-type') ?? '';
  if (response.ok && type.includes('text/event-stream')) {
    const parsed = parseDiscoverSseStream(await response.text());
    if (parsed.error || parsed.events.length === 0) {
      return { kind: 'error', status: response.status, message: parsed.error ?? DISCOVER_STREAM_BROKE };
    }
    return { kind: 'events', events: parsed.events };
  }

  const json = parseJsonObject(await response.text());
  if (!response.ok) {
    const serverError = json && typeof json.error === 'string' ? json.error : null;
    return {
      kind: 'error',
      status: response.status,
      message: messageForDiscoverStatus(response.status, serverError),
    };
  }

  const qa = json ? recipeFromJson(json.recipeQa) : null;
  if (qa) return { kind: 'recipe', qa };
  return { kind: 'error', status: response.status, message: DISCOVER_UNEXPECTED_RESPONSE };
}

async function postOnce(
  body: DiscoverAskPayload,
  idempotencyKey: string,
  signal: AbortSignal,
): Promise<DiscoverHttpResult> {
  const response = await fetch('/api/discover', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ ...body, idempotencyKey }),
    signal,
  });
  return readDiscoverHttp(response);
}

/** POST /api/discover. One network retry reuses the same idempotency key. */
export async function postDiscoverAsk(
  body: DiscoverAskPayload,
  idempotencyKey: string,
  signal: AbortSignal,
): Promise<DiscoverHttpResult> {
  try {
    return await postOnce(body, idempotencyKey, signal);
  } catch (err) {
    if (signal.aborted) throw err;
    try {
      return await postOnce(body, idempotencyKey, signal);
    } catch (retryErr) {
      if (signal.aborted) throw retryErr;
      return { kind: 'error', status: 0, message: DISCOVER_NETWORK_ERROR };
    }
  }
}
