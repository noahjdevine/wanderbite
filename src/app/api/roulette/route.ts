import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase/server';
import { requireLaunchMarketId } from '@/lib/launch-market-server';
import { LAUNCH_MARKET } from '@/lib/launch-market';
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import {
  isRouletteDietaryFlag,
  restaurantMatchesDietaryQuick,
  shuffleArray,
  type RouletteDietaryFlag,
} from '@/lib/roulette-dietary';
import {
  cuisineLabel,
  isCuisineId,
  restaurantHasExcludedCuisine,
} from '@/lib/cuisines';
import { isRoulettePriceRange, ROULETTE_TIMES, ROULETTE_VIBES } from '@/lib/roulette-options';
import { allowBillableRoulette } from '@/lib/ratelimit';
import { isWanderbiteAiDisabled } from '@/lib/ai-kill-switch';
import { trustedClientIpFromHeaders } from '@/lib/client-ip';
import {
  guestCookieSetOptions,
  mintGuestCookieValue,
  parseGuestCookieValue,
  AI_GUEST_COOKIE_NAME,
  hasGuestSigningSecret,
} from '@/lib/ai-guest';
import { hashClientIp, hasIpHashSecret } from '@/lib/ai-ip-hash';
import {
  boundStringArray,
  clipChars,
  isBodyWithinByteLimit,
  ROULETTE_MAX_ADDRESS_CHARS,
  ROULETTE_MAX_BODY_BYTES,
  ROULETTE_MAX_DESC_CHARS,
  ROULETTE_MAX_DIETARY,
  ROULETTE_MAX_EXCLUDED,
  ROULETTE_MAX_NAME_CHARS,
  ROULETTE_MAX_PROMPT_BYTES,
  ROULETTE_MAX_RESTAURANTS_IN_PROMPT,
  ROULETTE_MAX_RESULT_REASON_CHARS,
  ROULETTE_MAX_STRING_CHARS,
} from '@/lib/ai-bounds';
import { parseIdempotencyUuid, rouletteIdempotencyKey } from '@/lib/ai-idempotency';
import { classifyRouletteAccounting } from '@/lib/ai-budget/accounting';
import {
  ANTHROPIC_HAIKU_SNAPSHOT,
  ANTHROPIC_PROVIDER,
  ROULETTE_MAX_OUTPUT_TOKENS,
} from '@/lib/ai-budget/models';
import { rouletteQuoteUsageUnits } from '@/lib/ai-budget/quote';
import { anthropicRequestIdFromHeaders, usageUnitsFromAnthropic } from '@/lib/ai-budget/usage';
import {
  rpcAiCurrentVersions,
  rpcAiDispatch,
  rpcAiFailBeforeDispatch,
  rpcAiLoadResultPayload,
  rpcAiMarkAssumedSpent,
  rpcAiReconcile,
  rpcAiRecoverStaleRequests,
  rpcAiReleaseCustomerAllowance,
  rpcAiReserve,
  rpcAiSettle,
  rpcAiStoreResultPayload,
} from '@/lib/ai-budget/rpcs';

export const dynamic = 'force-dynamic';
/** Claude + DB can exceed the default serverless limit on cold starts. */
export const maxDuration = 60;

const ANTHROPIC_TIMEOUT_MS = 7_000;

export type RouletteSelectionMode = 'ai' | 'random_fallback';

type RouletteRestaurant = {
  id: string;
  name: string;
  cuisine_tags: string[] | null;
  neighborhood: string | null;
  address: string | null;
  description: string | null;
  price_range: string | null;
  image_url: string | null;
  google_photo_url: string | null;
  google_place_id: string | null;
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

type RouletteJson = {
  restaurantId: string;
  restaurantName: string;
  reason: string;
  vibeMatch: string | null;
  suggestedDish: string | null;
  cuisine_tags: string[] | null;
  neighborhood: string | null;
  address: string | null;
  price_range: string | null;
  image_url: string | null;
  google_photo_url: string | null;
  google_place_id: string | null;
  selectionMode: RouletteSelectionMode;
};

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
        restaurantId: clipChars(restaurantId.trim(), 64),
        restaurantName: clipChars(restaurantName.trim(), ROULETTE_MAX_NAME_CHARS),
        reason: clipChars(reason.trim(), ROULETTE_MAX_RESULT_REASON_CHARS),
        vibeMatch:
          typeof o.vibeMatch === 'string'
            ? clipChars(o.vibeMatch, ROULETTE_MAX_STRING_CHARS)
            : undefined,
        suggestedDish:
          typeof o.suggestedDish === 'string'
            ? clipChars(o.suggestedDish, ROULETTE_MAX_STRING_CHARS)
            : undefined,
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

function extractAnthropicText(raw: string): string {
  if (!raw.trim()) return '';
  try {
    const anthropicJson = JSON.parse(raw) as {
      content?: { type: string; text?: string }[];
    };
    const block = anthropicJson.content?.find((c) => c.type === 'text');
    return block?.text ?? '';
  } catch {
    return '';
  }
}

function fallbackPick(restaurants: RouletteRestaurant[]): ClaudePick & { chosen: RouletteRestaurant } {
  const chosen = pickRandom(restaurants);
  return {
    chosen,
    restaurantId: chosen.id,
    restaurantName: chosen.name,
    reason: `We had a little trouble reading the full Wanderbite Roulette pick, so here is a great random ${LAUNCH_MARKET.displayName} partner spot from our list. Enjoy the adventure!`,
    vibeMatch: 'Surprise pick',
    suggestedDish: 'Ask your server for the house favorite.',
  };
}

function toRouletteJson(
  chosen: RouletteRestaurant,
  pick: ClaudePick,
  selectionMode: RouletteSelectionMode,
): RouletteJson {
  return {
    restaurantId: chosen.id,
    restaurantName: chosen.name,
    reason: clipChars(pick.reason, ROULETTE_MAX_RESULT_REASON_CHARS),
    vibeMatch: pick.vibeMatch ?? null,
    suggestedDish: pick.suggestedDish ?? null,
    cuisine_tags: chosen.cuisine_tags,
    neighborhood: chosen.neighborhood,
    address: chosen.address,
    price_range: chosen.price_range,
    image_url: chosen.image_url,
    google_photo_url: chosen.google_photo_url,
    google_place_id: chosen.google_place_id,
    selectionMode,
  };
}

function jsonFromStoredPayload(
  payload: unknown,
  byId: Map<string, RouletteRestaurant>,
): RouletteJson | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const o = payload as Record<string, unknown>;
  if (typeof o.restaurantId !== 'string' || typeof o.restaurantName !== 'string' || typeof o.reason !== 'string') {
    return null;
  }
  const chosen = byId.get(o.restaurantId);
  if (!chosen) return null;
  const mode = o.selectionMode === 'ai' || o.selectionMode === 'random_fallback'
    ? o.selectionMode
    : 'ai';
  return toRouletteJson(
    chosen,
    {
      restaurantId: chosen.id,
      restaurantName: chosen.name,
      reason: o.reason,
      vibeMatch: typeof o.vibeMatch === 'string' ? o.vibeMatch : undefined,
      suggestedDish: typeof o.suggestedDish === 'string' ? o.suggestedDish : undefined,
    },
    mode,
  );
}

function withGuestCookie(response: NextResponse, cookieValue: string | null): NextResponse {
  if (cookieValue) {
    response.cookies.set(AI_GUEST_COOKIE_NAME, cookieValue, guestCookieSetOptions());
  }
  return response;
}

async function accountForOutcome(args: {
  requestId: string;
  dispatched: boolean;
  pickValid: boolean;
  usage: Record<string, number> | null;
}): Promise<void> {
  const action = classifyRouletteAccounting(args);
  if (action === 'fail_before_dispatch') {
    await rpcAiFailBeforeDispatch(args.requestId);
    return;
  }
  if (action === 'assumed_spent_release') {
    await rpcAiMarkAssumedSpent(args.requestId);
    await rpcAiReleaseCustomerAllowance(args.requestId);
    return;
  }
  if (action === 'assumed_spent_reconcile') {
    await rpcAiMarkAssumedSpent(args.requestId);
    await rpcAiReleaseCustomerAllowance(args.requestId);
    if (args.usage) {
      try {
        await rpcAiReconcile(args.requestId, args.usage);
      } catch {
        console.error('[roulette] reconcile actual exceeds quote', {
          requestId: args.requestId,
        });
      }
    }
    return;
  }

  if (!args.usage) return;
  try {
    await rpcAiSettle(args.requestId, args.usage);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes('exceeds')) {
      console.error('[roulette] actual exceeds quote', { requestId: args.requestId });
      await rpcAiMarkAssumedSpent(args.requestId);
      await rpcAiReleaseCustomerAllowance(args.requestId);
      return;
    }
    throw err;
  }
}

export async function POST(request: NextRequest) {
  let guestCookieToSet: string | null = null;
  try {
    const declared = request.headers.get('content-length');
    const declaredLength = declared ? Number(declared) : null;
    if (declaredLength !== null && !Number.isFinite(declaredLength)) {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }
    if (declaredLength !== null && declaredLength > ROULETTE_MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Request too large.' }, { status: 413 });
    }

    const rawBuf = await request.arrayBuffer();
    if (!isBodyWithinByteLimit(rawBuf.byteLength, declaredLength)) {
      return NextResponse.json({ error: 'Request too large.' }, { status: 413 });
    }

    type RouletteBody = {
      vibe?: string;
      timeOfDay?: string;
      dietaryQuick?: unknown;
      excludedCuisines?: unknown;
      priceRange?: string;
      preferredCuisine?: string;
      idempotencyKey?: string;
    };
    let body: RouletteBody;
    try {
      body = JSON.parse(new TextDecoder().decode(rawBuf)) as RouletteBody;
    } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const dietaryQuick: RouletteDietaryFlag[] = boundStringArray(
      body.dietaryQuick,
      ROULETTE_MAX_DIETARY,
    ).filter((x): x is RouletteDietaryFlag => isRouletteDietaryFlag(x));

    const priceRange =
      typeof body.priceRange === 'string' && isRoulettePriceRange(body.priceRange)
        ? body.priceRange
        : undefined;

    const preferredCuisine =
      typeof body.preferredCuisine === 'string' && isCuisineId(body.preferredCuisine)
        ? body.preferredCuisine
        : undefined;

    const excludedCuisines = boundStringArray(body.excludedCuisines, ROULETTE_MAX_EXCLUDED).filter(
      (id) => isCuisineId(id),
    );

    const vibeRaw =
      typeof body.vibe === 'string' ? clipChars(body.vibe.trim(), ROULETTE_MAX_STRING_CHARS) : '';
    const timeRaw =
      typeof body.timeOfDay === 'string'
        ? clipChars(body.timeOfDay.trim(), ROULETTE_MAX_STRING_CHARS)
        : '';
    const vibe = (ROULETTE_VIBES as readonly string[]).includes(vibeRaw) ? vibeRaw : undefined;
    const timeOfDay = (ROULETTE_TIMES as readonly string[]).includes(timeRaw)
      ? timeRaw
      : undefined;

    const clientUuid =
      parseIdempotencyUuid(request.headers.get('idempotency-key')) ??
      parseIdempotencyUuid(body.idempotencyKey) ??
      randomUUID();

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let accountTier: 'paid' | 'free' | 'guest' = 'guest';
    let featureClass: 'optional' | 'guest' = 'guest';
    let userId: string | null = null;
    let guestId: string | null = null;
    let subjectKey: string;

    if (user) {
      userId = user.id;
      const admin = getSupabaseAdmin();
      const { data: profile } = await admin
        .from('user_profiles')
        .select('subscription_status')
        .eq('id', user.id)
        .maybeSingle();
      accountTier =
        (profile as { subscription_status: string | null } | null)?.subscription_status ===
        'active'
          ? 'paid'
          : 'free';
      featureClass = 'optional';
      subjectKey = `user:${user.id}`;
    } else {
      const existing = parseGuestCookieValue(
        request.cookies.get(AI_GUEST_COOKIE_NAME)?.value,
      );
      if (existing) {
        guestId = existing;
      } else if (hasGuestSigningSecret()) {
        const minted = mintGuestCookieValue();
        guestCookieToSet = minted;
        guestId = minted ? parseGuestCookieValue(minted) : null;
      }
      subjectKey = guestId ? `guest:${guestId}` : `guest:anon`;
    }

    const admin = getSupabaseAdmin();
    const market = await requireLaunchMarketId(admin);
    if (!market.ok) {
      return withGuestCookie(
        NextResponse.json({ error: 'No restaurants available right now.' }, { status: 503 }),
        guestCookieToSet,
      );
    }
    const { data: rows, error: dbError } = await admin
      .from('restaurants')
      .select(
        'id, name, cuisine_tags, neighborhood, address, description, price_range, image_url, google_photo_url, google_place_id, is_dairy_free, is_vegan, is_halal',
      )
      .eq('status', 'active')
      .eq('market_id', market.marketId);

    if (dbError) {
      console.error('[roulette] supabase:', dbError.message);
      return withGuestCookie(
        NextResponse.json(
          { error: 'Could not load restaurants. Please try again.' },
          { status: 500 },
        ),
        guestCookieToSet,
      );
    }

    let restaurants = (rows ?? []) as RouletteRestaurant[];
    if (restaurants.length === 0) {
      return withGuestCookie(
        NextResponse.json({ error: 'No restaurants available right now.' }, { status: 503 }),
        guestCookieToSet,
      );
    }

    if (dietaryQuick.length > 0) {
      restaurants = restaurants.filter((r) => restaurantMatchesDietaryQuick(r, dietaryQuick));
      if (restaurants.length === 0) {
        return withGuestCookie(
          NextResponse.json(
            {
              error:
                'No restaurants match those dietary filters yet. Try fewer options, or we may still be tagging partners — check back soon.',
            },
            { status: 404 },
          ),
          guestCookieToSet,
        );
      }
    }

    if (excludedCuisines.length > 0) {
      restaurants = restaurants.filter(
        (r) =>
          !restaurantHasExcludedCuisine({
            restaurantCuisineTags: r.cuisine_tags,
            excludedCuisineIds: excludedCuisines,
          }),
      );
      if (restaurants.length === 0) {
        return withGuestCookie(
          NextResponse.json(
            {
              error:
                'No restaurants match your exclusions right now. Try removing one exclusion, or we may still be tagging partners — check back soon.',
            },
            { status: 404 },
          ),
          guestCookieToSet,
        );
      }
    }

    const byId = new Map(restaurants.map((r) => [r.id, r]));

    const respond = (payload: RouletteJson, status = 200) =>
      withGuestCookie(NextResponse.json(payload, { status }), guestCookieToSet);

    const randomFallback = () => {
      const fb = fallbackPick(restaurants);
      return respond(toRouletteJson(fb.chosen, fb, 'random_fallback'));
    };

    const clientIp = trustedClientIpFromHeaders(request.headers);
    const ipHash = clientIp ? hashClientIp(clientIp) : null;
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    const prerequisites =
      !isWanderbiteAiDisabled() &&
      Boolean(apiKey) &&
      hasGuestSigningSecret() &&
      hasIpHashSecret() &&
      Boolean(ipHash) &&
      (userId !== null || guestId !== null);

    if (!prerequisites || !ipHash) {
      return randomFallback();
    }

    const redisOk = await allowBillableRoulette(subjectKey, ipHash);
    if (!redisOk) {
      return randomFallback();
    }

    try {
      await rpcAiRecoverStaleRequests();
    } catch {
      // Recovery is best-effort; a lock skip must not block the spin.
    }

    let shuffledForPrompt = shuffleArray(restaurants).slice(
      0,
      ROULETTE_MAX_RESTAURANTS_IN_PROMPT,
    );
    const spinNonce = randomUUID();

    const dietaryQuickLine =
      dietaryQuick.length > 0
        ? `Required dietary filters (ALL must be satisfied — list is pre-filtered): ${dietaryQuick.join(', ')}`
        : null;
    const priceLine = priceRange
      ? `Price preference (soft — prefer restaurants near ${priceRange} tier when possible): ${priceRange}`
      : null;
    const cuisineLine = preferredCuisine
      ? `Preferred cuisine (soft — lean toward this style when possible): ${cuisineLabel(preferredCuisine)}`
      : null;
    const userPrefs = [
      vibe ? `Vibe: ${vibe}` : null,
      timeOfDay ? `Time of day: ${timeOfDay}` : null,
      dietaryQuickLine,
      priceLine,
      cuisineLine,
    ]
      .filter(Boolean)
      .join('\n');

    const systemPrompt = `You are Wanderbite Roulette, recommending restaurants for a discovery app in ${LAUNCH_MARKET.displayName}.

Variety is critical: do NOT default to the same restaurant on repeated calls. Each user message is an independent spin with a unique random id—explore different options across the list. Lean toward discovery and rotation, not the single "most famous" pick every time.

You will receive a JSON array of partner restaurants (order is randomized each request). Choose exactly ONE restaurant by its id from that array only.

Return ONLY a single JSON object, no markdown fences, no commentary before or after.
Required keys: "restaurantId" (string uuid from the list), "restaurantName" (string), "reason" (2-4 sentences explaining why this pick fits their vibe/time/dietary choices).
Also include "vibeMatch" (one short phrase) and "suggestedDish" (one specific dish or order idea plausible for that restaurant).

Valid JSON shape:
{"restaurantId":"...","restaurantName":"...","reason":"...","vibeMatch":"...","suggestedDish":"..."}`;

    const buildUserPrompt = (list: RouletteRestaurant[]) => {
      const listJson = JSON.stringify(
        list.map((r) => ({
          id: r.id,
          name: clipChars(r.name, ROULETTE_MAX_NAME_CHARS),
          cuisine_tags: r.cuisine_tags,
          neighborhood: r.neighborhood,
          address: r.address ? clipChars(r.address, ROULETTE_MAX_ADDRESS_CHARS) : null,
          description: r.description ? clipChars(r.description, ROULETTE_MAX_DESC_CHARS) : null,
          price_range: r.price_range,
        })),
      );
      return `Random spin id: ${spinNonce}

Here is the JSON array of eligible Wanderbite partner restaurants (each has id, name, cuisine_tags, neighborhood, address, description, price_range):
${listJson}

User preferences (each line may be absent — use judgment when absent):
${userPrefs || '(No specific preferences — pick a varied, fun standout for a night out.)'}`;
    };

    let userPrompt = buildUserPrompt(shuffledForPrompt);
    while (
      Buffer.byteLength(systemPrompt, 'utf8') + Buffer.byteLength(userPrompt, 'utf8') >
        ROULETTE_MAX_PROMPT_BYTES &&
      shuffledForPrompt.length > 8
    ) {
      shuffledForPrompt = shuffledForPrompt.slice(0, Math.ceil(shuffledForPrompt.length / 2));
      userPrompt = buildUserPrompt(shuffledForPrompt);
    }

    const usageUnits = rouletteQuoteUsageUnits(systemPrompt, userPrompt);
    const versions = await rpcAiCurrentVersions();
    const idempotencyKey = rouletteIdempotencyKey(subjectKey, clientUuid);

    const reserved = await rpcAiReserve({
      accountTier,
      configVersionId: versions.config_version_id,
      featureClass,
      guestId,
      idempotencyKey,
      modelId: ANTHROPIC_HAIKU_SNAPSHOT,
      priceVersionId: versions.price_version_id,
      provider: ANTHROPIC_PROVIDER,
      usageUnits,
      userId,
    });

    const replayStored = async (): Promise<RouletteJson | null> => {
      const loaded = await rpcAiLoadResultPayload(reserved.request_id);
      return jsonFromStoredPayload(loaded?.result_payload, byId);
    };

    if (!reserved.acquired) {
      const stored = await replayStored();
      if (stored) return respond(stored);
      return randomFallback();
    }

    const dispatched = await rpcAiDispatch(reserved.request_id);
    if (!dispatched.acquired) {
      const stored = await replayStored();
      if (stored) return respond(stored);
      return randomFallback();
    }

    let usage: Record<string, number> | null = null;
    let claudeText = '';
    const anthropicController = new AbortController();
    const anthropicTimeout = setTimeout(() => anthropicController.abort(), ANTHROPIC_TIMEOUT_MS);
    try {
      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: ANTHROPIC_HAIKU_SNAPSHOT,
          max_tokens: ROULETTE_MAX_OUTPUT_TOKENS,
          temperature: 1,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
        signal: anthropicController.signal,
      });

      const providerRequestId = anthropicRequestIdFromHeaders(anthropicRes.headers);
      const anthropicRaw = await anthropicRes.text();
      if (!anthropicRes.ok) {
        console.error('[roulette] anthropic', anthropicRes.status, providerRequestId);
        throw new Error('anthropic_failed');
      }

      try {
        const parsed = JSON.parse(anthropicRaw) as { usage?: unknown };
        usage = usageUnitsFromAnthropic(parsed.usage);
      } catch {
        usage = null;
      }
      claudeText = extractAnthropicText(anthropicRaw);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        console.warn('[roulette] anthropic timeout — using random fallback');
      }
      claudeText = '';
    } finally {
      clearTimeout(anthropicTimeout);
    }

    let pick = claudeText ? parseClaudeJson(claudeText) : null;
    let chosen = pick?.restaurantId ? byId.get(pick.restaurantId) : undefined;
    const pickValid = Boolean(pick && chosen);
    let selectionMode: RouletteSelectionMode = 'ai';

    if (!pick || !chosen) {
      const fb = fallbackPick(restaurants);
      chosen = fb.chosen;
      pick = fb;
      selectionMode = 'random_fallback';
    }

    await accountForOutcome({
      requestId: reserved.request_id,
      dispatched: true,
      pickValid,
      usage,
    });

    const payload = toRouletteJson(chosen, pick, selectionMode);
    try {
      await rpcAiStoreResultPayload(reserved.request_id, payload);
    } catch {
      // Replay can still honest-fallback if the payload does not persist.
    }
    return respond(payload);
  } catch (err) {
    console.error('[roulette] unhandled:', err);
    return withGuestCookie(
      NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 }),
      guestCookieToSet,
    );
  }
}
