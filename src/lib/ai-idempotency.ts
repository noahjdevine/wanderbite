import { parseUuid } from '@/lib/uuid';

export function parseIdempotencyUuid(raw: string | undefined | null): string | null {
  return parseUuid(raw);
}

export function rouletteIdempotencyKey(subject: string, clientUuid: string): string {
  return `roulette:${subject}:${clientUuid}`;
}
