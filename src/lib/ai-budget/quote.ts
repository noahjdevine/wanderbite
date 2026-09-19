import 'server-only';
import {
  ROULETTE_MAX_OUTPUT_TOKENS,
  ROULETTE_QUOTE_FRAMING_TOKENS,
  ROULETTE_QUOTE_MARGIN_TOKENS,
} from '@/lib/ai-budget/models';

/**
 * Conservative input-unit upper bound after prompts are assembled.
 * 1 unit per 2 UTF-8 bytes plus framing and documented margin — not chars/4.
 */
export function conservativeInputUnits(systemPrompt: string, userPrompt: string): number {
  const bytes =
    Buffer.byteLength(systemPrompt, 'utf8') + Buffer.byteLength(userPrompt, 'utf8');
  return Math.ceil(bytes / 2) + ROULETTE_QUOTE_FRAMING_TOKENS + ROULETTE_QUOTE_MARGIN_TOKENS;
}

export function rouletteQuoteUsageUnits(
  systemPrompt: string,
  userPrompt: string,
): Record<string, number> {
  return {
    input: conservativeInputUnits(systemPrompt, userPrompt),
    output: ROULETTE_MAX_OUTPUT_TOKENS,
  };
}
