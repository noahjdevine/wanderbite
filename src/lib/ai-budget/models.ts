import 'server-only';

export { ANTHROPIC_HAIKU_SNAPSHOT, anthropicMessageBody, isClaude5Model } from './haiku-model';
export const ANTHROPIC_PROVIDER = 'anthropic';
export const ROULETTE_MAX_OUTPUT_TOKENS = 300;
/** One Discover sentence. The budget quote must use this same cap when it is sent. */
export const DISCOVER_LINE_MAX_OUTPUT_TOKENS = 80;
export const ROULETTE_QUOTE_FRAMING_TOKENS = 512;
export const ROULETTE_QUOTE_MARGIN_TOKENS = 4096;
