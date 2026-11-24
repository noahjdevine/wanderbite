import { ACTIVITY_NOTE_MODEL } from '@/lib/activities/note-copy';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const MAX_OUTPUT_TOKENS = 512;

function anthropicText(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { content?: { type?: string; text?: string }[] };
    return parsed.content?.find((block) => block.type === 'text')?.text ?? '';
  } catch {
    return '';
  }
}

function anthropicUsage(raw: string): { input: number; output: number } | null {
  try {
    const parsed = JSON.parse(raw) as { usage?: { input_tokens?: unknown; output_tokens?: unknown } };
    const input = parsed.usage?.input_tokens;
    const output = parsed.usage?.output_tokens;
    if (typeof input !== 'number' || typeof output !== 'number') return null;
    return { input, output };
  } catch {
    return null;
  }
}

/**
 * Operator model call. Same Messages URL and Haiku snapshot as menu drafts.
 * Does not reserve or settle a member AI budget.
 */
export async function callActivityNoteModel(args: {
  system: string;
  user: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<{ text: string; usage: { input: number; output: number } | null }> {
  const apiKey = args.apiKey.trim();
  if (!apiKey) return { text: '', usage: null };
  const fetchImpl = args.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ACTIVITY_NOTE_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0,
        system: args.system,
        messages: [{ role: 'user', content: args.user }],
      }),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      console.error('[activity-notes] model failed', response.status);
      return { text: '', usage: null };
    }
    return { text: anthropicText(raw), usage: anthropicUsage(raw) };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') console.error('[activity-notes] model timed out');
    else console.error('[activity-notes] model failed');
    return { text: '', usage: null };
  } finally {
    clearTimeout(timer);
  }
}
