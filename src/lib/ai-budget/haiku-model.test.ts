import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANTHROPIC_HAIKU_SNAPSHOT, anthropicMessageBody, isClaude5Model } from '@/lib/ai-budget/haiku-model';
import { ROULETTE_MAX_OUTPUT_TOKENS } from '@/lib/ai-budget/models';
import { rouletteQuoteUsageUnits } from '@/lib/ai-budget/quote';

const ROOT = path.resolve(__dirname, '../../..');

describe('Claude 5.x message body', () => {
  it('omits temperature for Haiku 5.5 and Sonnet 5.5', () => {
    expect(ANTHROPIC_HAIKU_SNAPSHOT).toBe('claude-haiku-5-5');
    expect(isClaude5Model('claude-haiku-5-5')).toBe(true);
    expect(isClaude5Model('claude-sonnet-5-5')).toBe(true);
    expect(isClaude5Model('claude-haiku-4-5-20251001')).toBe(false);
    expect(isClaude5Model('claude-sonnet-4-5')).toBe(false);
    for (const model of ['claude-haiku-5-5', 'claude-sonnet-5-5']) {
      const body = anthropicMessageBody({
        model,
        max_tokens: 2048,
        temperature: 0,
        system: 'system',
        messages: [{ role: 'user', content: 'user' }],
      });
      expect(body.model).toBe(model);
      expect(body.max_tokens).toBe(2048);
      expect(body).not.toHaveProperty('temperature');
      expect(JSON.stringify(body)).not.toContain('temperature');
      expect(body.thinking).toEqual({ type: 'disabled' });
    }
  });

  it('keeps temperature for a non-5.x override', () => {
    const body = anthropicMessageBody({
      model: 'claude-sonnet-4-5',
      max_tokens: 2048,
      temperature: 0,
      system: 'system',
      messages: [{ role: 'user', content: 'user' }],
    });
    expect(body.temperature).toBe(0);
    expect(body).not.toHaveProperty('thinking');
  });

  it('quotes the same output cap the 5.x calls send', () => {
    const quote = rouletteQuoteUsageUnits('system', 'user', ROULETTE_MAX_OUTPUT_TOKENS);
    expect(quote.output).toBe(ROULETTE_MAX_OUTPUT_TOKENS);
    const files = [
      'src/lib/discover/turn.ts',
      'src/lib/challenges/ai-rank.ts',
      'src/lib/recipes/qa-turn.ts',
      'src/lib/recipes/menu-generate.ts',
      'src/lib/briefings/research.ts',
    ];
    for (const file of files) {
      const source = readFileSync(path.join(ROOT, file), 'utf8');
      expect(source).toContain('anthropicMessageBody');
      expect(source).not.toMatch(/temperature\s*:/);
    }
    const rank = readFileSync(path.join(ROOT, 'src/lib/challenges/ai-rank.ts'), 'utf8');
    expect(rank).toMatch(/rouletteQuoteUsageUnits\([\s\S]*ROULETTE_MAX_OUTPUT_TOKENS/);
    const discover = readFileSync(path.join(ROOT, 'src/lib/discover/turn.ts'), 'utf8');
    expect(discover).toMatch(/rouletteQuoteUsageUnits\(systemPrompt, userPrompt, maxOutputTokens\)/);
    expect(discover).toMatch(/max_tokens: maxOutputTokens/);
  });
});
