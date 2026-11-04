import type {
  Constraint,
  DiscoverEvent,
  DiscoverFood,
  PartnerLite,
} from '@/lib/discover/events';

const FOOD: readonly DiscoverFood[] = [
  'sushi',
  'pizza',
  'taco',
  'dumpling',
  'burger',
  'bbq',
  'generic',
];

const CONSTRAINT_KEYS = new Set([
  'cuisine',
  'vibe',
  'occasion',
  'budget',
  'dietary',
  'time',
  'area',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPartner(value: unknown): value is PartnerLite {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return false;
  if (value.cuisine != null && typeof value.cuisine !== 'string') return false;
  if (value.neighborhood != null && typeof value.neighborhood !== 'string') return false;
  if (value.photoUrl != null && typeof value.photoUrl !== 'string') return false;
  if (value.photoCredit != null && typeof value.photoCredit !== 'string') return false;
  return true;
}

function isConstraint(value: unknown): value is Constraint {
  if (!isRecord(value)) return false;
  return (
    typeof value.key === 'string' &&
    CONSTRAINT_KEYS.has(value.key) &&
    typeof value.label === 'string' &&
    typeof value.required === 'boolean'
  );
}

function isFood(value: unknown): value is DiscoverFood {
  return typeof value === 'string' && FOOD.includes(value as DiscoverFood);
}

/** Accepts one JSON value from a `data:` line. Rejects anything that is not a DiscoverEvent. */
export function isDiscoverEvent(value: unknown): value is DiscoverEvent {
  if (!isRecord(value)) return false;
  if (value.type === 'error') return typeof value.message === 'string';
  if (value.type === 'fallback') {
    return (
      (value.reason === 'no_match' ||
        value.reason === 'provider_error' ||
        value.reason === 'timeout') &&
      typeof value.message === 'string' &&
      isPartner(value.alternative)
    );
  }
  if (value.type === 'pick') {
    if (!isPartner(value.partner) || typeof value.reason !== 'string') return false;
    if (!Array.isArray(value.matched) || !value.matched.every((item) => typeof item === 'string')) {
      return false;
    }
    if (!Array.isArray(value.unmet) || !value.unmet.every((item) => typeof item === 'string')) {
      return false;
    }
    if (!Array.isArray(value.unknown)) return false;
    const unknownOk = value.unknown.every(
      (item) =>
        isRecord(item) && typeof item.label === 'string' && typeof item.note === 'string',
    );
    return unknownOk && typeof value.isNewToMember === 'boolean' && isFood(value.food);
  }
  if (value.type !== 'step') return false;
  if (value.id === 'parse') {
    return (
      typeof value.label === 'string' &&
      Array.isArray(value.constraints) &&
      value.constraints.every(isConstraint)
    );
  }
  if (value.id === 'filter') {
    return (
      typeof value.label === 'string' &&
      typeof value.detail === 'string' &&
      Array.isArray(value.sample) &&
      value.sample.every(isPartner) &&
      typeof value.total === 'number'
    );
  }
  if (value.id === 'memory') {
    return typeof value.label === 'string' && typeof value.line === 'string';
  }
  if (value.id === 'rank') {
    return typeof value.label === 'string' && isPartner(value.winner) && typeof value.winnerTag === 'string';
  }
  return false;
}

export type DiscoverSseFeed = {
  rest: string;
  events: DiscoverEvent[];
  error: string | null;
};

function blockEvent(block: string): { event: DiscoverEvent | null; error: string | null } {
  const trimmed = block.trim();
  if (!trimmed) return { event: null, error: null };
  const line = trimmed.split('\n').find((item) => item.startsWith('data: '));
  if (!line) return { event: null, error: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.slice('data: '.length));
  } catch {
    return { event: null, error: 'The suggestion stream stopped. You can ask again.' };
  }
  if (!isDiscoverEvent(parsed)) {
    return { event: null, error: 'The suggestion stream stopped. You can ask again.' };
  }
  return { event: parsed, error: null };
}

/**
 * Pulls complete SSE records out of a buffer. An incomplete trailing record
 * stays in `rest` until a blank line arrives.
 */
export function feedDiscoverSse(buffer: string, chunk: string): DiscoverSseFeed {
  const combined = buffer + chunk;
  const parts = combined.split('\n\n');
  const rest = parts.pop() ?? '';
  const events: DiscoverEvent[] = [];
  for (const part of parts) {
    const parsed = blockEvent(part);
    if (parsed.error) return { rest: '', events, error: parsed.error };
    if (parsed.event) events.push(parsed.event);
  }
  return { rest, events, error: null };
}

/** Flushes a final record that arrived without a trailing blank line. */
export function finishDiscoverSse(buffer: string): DiscoverSseFeed {
  if (!buffer.trim()) return { rest: '', events: [], error: null };
  return feedDiscoverSse('', buffer.endsWith('\n\n') ? buffer : `${buffer}\n\n`);
}

export function parseDiscoverSseStream(body: string): DiscoverSseFeed {
  const fed = feedDiscoverSse('', body);
  if (fed.error) return fed;
  if (!fed.rest.trim()) return fed;
  const tail = finishDiscoverSse(fed.rest);
  if (tail.error) return { rest: '', events: fed.events, error: tail.error };
  return { rest: '', events: [...fed.events, ...tail.events], error: null };
}
