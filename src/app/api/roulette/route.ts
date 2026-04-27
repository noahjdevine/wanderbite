import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import {
  isDietaryQuickFlag,
  restaurantMatchesDietaryQuick,
  shuffleArray,
  type DietaryQuickFlag,
} from '@/lib/roulette-dietary';
import { restaurantHasExcludedCuisine } from '@/lib/cuisines';

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
  is_dairy_free?: boolean | null;
  is_vegan?: boolean | null;
  is_halal?: boolean | null;
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

  type RouletteBody = {
    vibe?: string;
    timeOfDay?: string;
    dietary?: string;
    dietaryQuick?: unknown;
    excludedCuisines?: unknown;
  };
  let body: RouletteBody;
  try {
    body = (await request.json()) as RouletteBody;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const dietaryQuick: DietaryQuickFlag[] = Array.isArray(body.dietaryQuick)
    ? body.dietaryQuick.filter(
        (x): x is DietaryQuickFlag =>
          typeof x === 'string' && isDietaryQuickFlag(x)
      )
    : [];

  const excludedCuisines: string[] = Array.isArray(body.excludedCuisines)
    ? body.excludedCuisines.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : [];

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
      'id, name, cuisine_tags, neighborhood, address, description, image_url, google_photo_url, is_dairy_free, is_vegan, is_halal'
    )
    .eq('status', 'active');

  if (dbError) {
    console.error('[roulette] supabase:', dbError.message);
    return NextResponse.json(
      { error: 'Could not load restaurants. Please try again.' },
      { status: 500 }
    );
  }

  let restaurants = (rows ?? []) as RouletteRestaurant[];
  if (restaurants.length === 0) {
    return NextResponse.json(
      { error: 'No restaurants available right now.' },
      { status: 503 }
    );
  }

  if (dietaryQuick.length > 0) {
    restaurants = restaurants.filter((r) =>
      restaurantMatchesDietaryQuick(r, dietaryQuick)
    );
    if (restaurants.length === 0) {
      return NextResponse.json(
        {
          error:
            'No restaurants match those dietary filters yet. Try fewer options, or we may still be tagging partners — check back soon.',
        },
        { status: 404 }
      );
    }
  }

  if (excludedCuisines.length > 0) {
    restaurants = restaurants.filter(
      (r) =>
        !restaurantHasExcludedCuisine({
          restaurantCuisineTags: r.cuisine_tags,
          excludedCuisineIds: excludedCuisines,
        })
    );
    if (restaurants.length === 0) {
      return NextResponse.json(
        {
          error:
            'No restaurants match your exclusions right now. Try removing one exclusion, or we may still be tagging partners — check back soon.',
        },
        { status: 404 }
      );
    }
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

  const shuffledForPrompt = shuffleArray(restaurants);

  const listJson = JSON.stringify(
    shuffledForPrompt.map((r) => ({
      id: r.id,
      name: r.name,
      cuisine_tags: r.cuisine_tags,
      neighborhood: r.neighborhood,
      address: r.address,
      description: r.description,
    }))
  );

  const spinNonce = randomUUID();

  const dietaryQuickLine =
    dietaryQuick.length > 0
      ? `Required dietary filters (ALL must be satisfied — list is pre-filtered): ${dietaryQuick.join(', ')}`
      : null;

  const userPrefs = [
    params.vibe ? `Vibe: ${params.vibe}` : null,
    params.timeOfDay ? `Time of day: ${params.timeOfDay}` : null,
    params.dietary ? `Dietary (refinement): ${params.dietary}` : null,
    dietaryQuickLine,
  ]
    .filter(Boolean)
    .join('\n');

  const systemPrompt = `You are Wanderbite Roulette, recommending restaurants for a discovery app in Austin.

Variety is critical: do NOT default to the same restaurant on repeated calls. Each user message is an independent spin with a unique random id—explore different options across the list. Lean toward discovery and rotation, not the single "most famous" pick every time.

You will receive a JSON array of partner restaurants (order is randomized each request). Choose exactly ONE restaurant by its id from that array only.

Return ONLY a single JSON object, no markdown fences, no commentary before or after.
Required keys: "restaurantId" (string uuid from the list), "restaurantName" (string), "reason" (2-4 sentences explaining why this pick fits their vibe/time/dietary choices).
Also include "vibeMatch" (one short phrase) and "suggestedDish" (one specific dish or order idea plausible for that restaurant).

Valid JSON shape:
{"restaurantId":"...","restaurantName":"...","reason":"...","vibeMatch":"...","suggestedDish":"..."}`;

  const userPrompt = `Random spin id: ${spinNonce}

Here is the JSON array of eligible Wanderbite partner restaurants (each has id, name, cuisine_tags, neighborhood, address, description):
${listJson}

User preferences (each line may be absent — use judgment when absent):
${userPrefs || '(No specific preferences — pick a varied, fun standout for a night out.)'}`;

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
        temperature: 1,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
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
