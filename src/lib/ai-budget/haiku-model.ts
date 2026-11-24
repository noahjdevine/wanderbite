/**
 * Fixed Claude Haiku 5.5 id. Not a dated snapshot and not a moving alias.
 * Not a price. Provider rates live only in ai_price_rates.
 */
export const ANTHROPIC_HAIKU_SNAPSHOT = 'claude-haiku-5-5';

/**
 * Claude 5.x ids reject temperature, top_p, and top_k.
 * 4.5 ids such as claude-haiku-4-5-20251001 and claude-sonnet-4-5 do not match.
 */
export function isClaude5Model(modelId: string): boolean {
  return /^claude-(?:haiku|sonnet|opus|fable)-5(?:-|$)/.test(modelId.trim());
}

type AnthropicMessageArgs = {
  model: string;
  max_tokens: number;
  system: string;
  messages: readonly unknown[];
  tools?: readonly unknown[];
  /**
   * Sent only for non-5.x ids. Claude 5.x returns HTTP 400 if temperature is present.
   */
  temperature?: number;
};

/**
 * Messages API body for one model call.
 * Claude 5.x omits temperature. Adaptive thinking is on by default and spends
 * max_tokens before any text, so 5.x calls turn thinking off and keep max_tokens
 * for the text or JSON block.
 */
export function anthropicMessageBody(args: AnthropicMessageArgs): {
  model: string;
  max_tokens: number;
  system: string;
  messages: readonly unknown[];
  tools?: readonly unknown[];
  thinking?: { type: 'disabled' };
  temperature?: number;
} {
  const model = args.model.trim();
  const body: {
    model: string;
    max_tokens: number;
    system: string;
    messages: readonly unknown[];
    tools?: readonly unknown[];
    thinking?: { type: 'disabled' };
    temperature?: number;
  } = {
    model,
    max_tokens: args.max_tokens,
    system: args.system,
    messages: args.messages,
  };
  if (args.tools !== undefined) body.tools = args.tools;
  if (isClaude5Model(model)) {
    body.thinking = { type: 'disabled' };
    return body;
  }
  if (args.temperature !== undefined) body.temperature = args.temperature;
  return body;
}
