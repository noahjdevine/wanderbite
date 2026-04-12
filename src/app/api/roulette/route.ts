import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 10;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

type RouletteRestaurant = {
  id: string;
  name: string;
  cuisine_tags: string[] | null;
  neighborhood: string | null;
  address: string | null;
  description: string | null;
  image_url: string | null;
  google_photo_url: string | null;
};

type ClaudePick = {
  restaurantId: string;
  restaurantName: string;
  reason: string;
  vibeMatch?: string;
  suggestedDish?: string;
};

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip') ?? 'unknown';
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_MAX) return false;
  bucket.count += 1;
  return true;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function parseClaudeJson(text: string): ClaudePick | null {
  const trimmed = text.trim();
  const tryParse = (s: string): ClaudePick | null => {
    try {
      const obj = JSON.parse(s) as unknown;
      if (!obj || typeof obj !== 'object') return null;
      const o = obj as Record<string, unknown>;
      const restaurantId = o.restaurantId;
      const restaurantName = o.restaurantName;
      const reason = o.reason;
      if (
        typeof restaurantId !== 'string' ||
        typeof restaurantName !== 'string' ||
        typeof reason !== 'string'
      ) {
        return null;
      }
      return {
        restaurantId,
        restaurantName,
        reason,
        vibeMatch: typeof o.vibeMatch === 'string' ? o.vibeMatch : undefined,
        suggestedDish: typeof o.suggestedDish === 'string' ? o.suggestedDish : undefined,
      };
    } catch {
      return null;
    }
  };

  let direct = tryParse(trimmed);
  if (direct) return direct;

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    direct = tryParse(fence[1].trim());
    if (direct) return direct;
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    direct = tryParse(trimmed.slice(start, end + 1));
    if (direct) return direct;
  }

  return null;
}

export async function POST(request: NextRequest) {
  console.log(
    'ANTHROPIC_API_KEY present:',
    !!process.env.ANTHROPIC_API_KEY
  );
  console.log('Supabase URL present:', !!process.env.NEXT_PUBLIC_SUPABASE_URL);

  const ip = getClientIp(request);

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    console.error('Roulette config error:', { reason: 'missing key or config' });
    return NextResponse.json(
      { error: 'Wanderbite Roulette is not configured yet. Please try again later.' },
      { status: 503 }
    );
  }

  let body: { vibe?: string; timeOfDay?: string; dietary?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return NextResponse.json(
      { error: 'Server configuration error.' },
      { status: 500 }
    );
  }

  const supabase = createClient(url, anon);
  const { data: rows, error: dbError } = await supabase
    .from('restaurants')
    .select(
      'id, name, cuisine_tags, neighborhood, address, description, image_url, google_photo_url'
    )
    .eq('status', 'active');

  if (dbError) {
    console.error('[roulette] supabase:', dbError.message);
    return NextResponse.json(
      { error: 'Could not load restaurants. Please try again.' },
      { status: 500 }
    );
  }

  const restaurants = (rows ?? []) as RouletteRestaurant[];
  if (restaurants.length === 0) {
    return NextResponse.json(
      { error: 'No restaurants available right now.' },
      { status: 503 }
    );
  }

  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Too many spins! Come back in an hour.' },
      { status: 429 }
    );
  }

  const byId = new Map(restaurants.map((r) => [r.id, r]));

  const params = {
    vibe: body.vibe?.trim() || undefined,
    timeOfDay: body.timeOfDay?.trim() || undefined,
    dietary: body.dietary?.trim() || undefined,
  };

  const listJson = JSON.stringify(
    restaurants.map((r) => ({
      id: r.id,
      name: r.name,
      cuisine_tags: r.cuisine_tags,
      neighborhood: r.neighborhood,
      address: r.address,
      description: r.description,
    }))
  );

  const userPrefs = [
    params.vibe ? `Vibe: ${params.vibe}` : null,
    params.timeOfDay ? `Time of day: ${params.timeOfDay}` : null,
    params.dietary ? `Dietary: ${params.dietary}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const systemUserPrompt = `You are Wanderbite Roulette, helping someone pick one restaurant for Austin.

Here is the complete JSON array of active Wanderbite partner restaurants (each has id, name, cuisine_tags, neighborhood, address, description):
${listJson}

User preferences (each may be omitted — use your judgment when omitted):
${userPrefs || '(No specific preferences — pick a standout match for a fun night out.)'}

Rules:
- Choose exactly ONE restaurant from the list by its id.
- Return ONLY a single JSON object, no markdown fences, no commentary before or after.
- Required keys: "restaurantId" (string uuid from the list), "restaurantName" (string), "reason" (2-4 sentences explaining why this pick fits their vibe/time/dietary choices).
- Also include "vibeMatch" (one short phrase) and "suggestedDish" (one specific dish or order idea plausible for that restaurant).

Valid JSON shape:
{"restaurantId":"...","restaurantName":"...","reason":"...","vibeMatch":"...","suggestedDish":"..."}`;

  let claudeText = '';
  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 500,
        messages: [{ role: 'user', content: systemUserPrompt }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('[roulette] anthropic', anthropicRes.status, errText.slice(0, 500));
      throw new Error('anthropic_failed');
    }

    const anthropicJson = (await anthropicRes.json()) as {
      content?: { type: string; text?: string }[];
    };
    const block = anthropicJson.content?.find((c) => c.type === 'text');
    claudeText = block?.text ?? '';
  } catch {
    claudeText = '';
  }

  let pick = claudeText ? parseClaudeJson(claudeText) : null;
  let chosen = pick?.restaurantId ? byId.get(pick.restaurantId) : undefined;

  if (!pick || !chosen) {
    chosen = pickRandom(restaurants);
    pick = {
      restaurantId: chosen.id,
      restaurantName: chosen.name,
      reason:
        'We had a little trouble reading the full Wanderbite Roulette pick, so here is a great random Austin partner spot from our list. Enjoy the adventure!',
      vibeMatch: 'Surprise pick',
      suggestedDish: 'Ask your server for the house favorite.',
    };
  }

  return NextResponse.json({
    restaurantId: chosen.id,
    restaurantName: chosen.name,
    reason: pick.reason,
    vibeMatch: pick.vibeMatch ?? null,
    suggestedDish: pick.suggestedDish ?? null,
    cuisine_tags: chosen.cuisine_tags,
    neighborhood: chosen.neighborhood,
    address: chosen.address,
    image_url: chosen.image_url,
    google_photo_url: chosen.google_photo_url,
  });
}
