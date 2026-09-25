import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase/server';
import { requireLaunchMarketId } from '@/lib/launch-market-server';
import { LAUNCH_MARKET } from '@/lib/launch-market';
import { safeManualImagePath } from '@/lib/restaurant-image';
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { restaurantMatchesDietaryQuick, shuffleArray } from '@/lib/roulette-dietary';
import { cuisineLabel, isCuisineId, restaurantHasExcludedCuisine } from '@/lib/cuisines';
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
  discoveryReplayMac,
} from '@/lib/ai-guest';
import { hashClientIp, hasIpHashSecret } from '@/lib/ai-ip-hash';
import {
  boundStringArray,
  clipChars,
  isBodyWithinByteLimit,
  ROULETTE_MAX_BODY_BYTES,
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
import {
  buildStoredDiscoveryPayload,
  canonicalFilterString,
  decideReplay,
  discoveryCardSentence,
  DISCOVERY_ALLERGY_ERROR,
  DISCOVERY_PROFILE_ERROR,
  DISCOVERY_REPLAY_MISMATCH_ERROR,
  gateDiscoveryMessage,
  gateSignedInProfile,
  isIdInPromptRows,
  mergeDietaryFlags,
  mergeExcludedCuisines,
  parseModelRestaurantId,
} from '@/lib/discovery-turn';

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
  price_range: string | null;
  image_url: string | null;
  google_place_id: string | null;
  is_dairy_free?: boolean | null;
  is_vegan?: boolean | null;
  is_halal?: boolean | null;
};

type RouletteJson = {
  restaurantId: string;
  restaurantName: string;
  reason: string;
  cuisine_tags: string[] | null;
  neighborhood: string | null;
  address: string | null;
  price_range: string | null;
  image_url: string | null;
  google_place_id: string | null;
  selectionMode: RouletteSelectionMode;
};

type DiscoveryProfileRow = {
  subscription_status: string | null;
  dietary_flags: string[] | null;
  allergy_flags: string[] | null;
};

type DiscoveryPrefsRow = {
  excluded_cuisines: string[] | null;
};

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
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

function toRouletteJson(
  chosen: RouletteRestaurant,
  selectionMode: RouletteSelectionMode,
): RouletteJson {
  return {
    restaurantId: chosen.id,
    restaurantName: chosen.name,
    reason: clipChars(
      discoveryCardSentence(chosen, LAUNCH_MARKET.displayName),
      ROULETTE_MAX_RESULT_REASON_CHARS,
    ),
    cuisine_tags: chosen.cuisine_tags,
    neighborhood: chosen.neighborhood,
    address: chosen.address,
    price_range: chosen.price_range,
    image_url: safeManualImagePath(chosen.image_url),
    google_place_id: chosen.google_place_id,
    selectionMode,
  };
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
      message?: unknown;
    };
    let body: RouletteBody;
    try {
      body = JSON.parse(new TextDecoder().decode(rawBuf)) as RouletteBody;
    } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const messageGate = gateDiscoveryMessage(body.message);
    if (!messageGate.ok) {
      return NextResponse.json({ error: messageGate.error }, { status: messageGate.status });
    }
    const acceptedMessage = messageGate.message;

    const bodyDietary = boundStringArray(body.dietaryQuick, ROULETTE_MAX_DIETARY);
    const priceRange =
      typeof body.priceRange === 'string' && isRoulettePriceRange(body.priceRange)
        ? body.priceRange
        : undefined;
    const preferredCuisine =
      typeof body.preferredCuisine === 'string' && isCuisineId(body.preferredCuisine)
        ? body.preferredCuisine
        : undefined;
    const bodyExcluded = boundStringArray(body.excludedCuisines, ROULETTE_MAX_EXCLUDED);
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
    let dietaryFlags = mergeDietaryFlags(bodyDietary, []);
    let excludedCuisines = mergeExcludedCuisines(bodyExcluded, []);

    const admin = getSupabaseAdmin();

    if (user) {
      userId = user.id;
      featureClass = 'optional';
      subjectKey = `user:${user.id}`;
      const [{ data: profileRow, error: profileError }, { data: prefsRow, error: prefsError }] =
        await Promise.all([
          admin
            .from('user_profiles')
            .select('subscription_status, dietary_flags, allergy_flags')
            .eq('id', user.id)
            .maybeSingle(),
          admin
            .from('user_preferences')
            .select('excluded_cuisines')
            .eq('user_id', user.id)
            .maybeSingle(),
        ]);
      const profile = profileRow as DiscoveryProfileRow | null;
      const prefs = prefsRow as DiscoveryPrefsRow | null;
      const profileGate = gateSignedInProfile({
        profileError: Boolean(profileError),
        profile,
        preferencesError: Boolean(prefsError),
        excludedCuisines: prefs?.excluded_cuisines ?? null,
      });
      if (!profileGate.ok && profileGate.reason === 'allergy') {
        return NextResponse.json({ error: DISCOVERY_ALLERGY_ERROR }, { status: 422 });
      }
      if (!profileGate.ok) {
        if (profileError) console.error('[roulette] profile', profileError.message);
        if (prefsError) console.error('[roulette] preferences', prefsError.message);
        return NextResponse.json({ error: DISCOVERY_PROFILE_ERROR }, { status: 503 });
      }
      accountTier = profileGate.accountTier;
      dietaryFlags = mergeDietaryFlags(bodyDietary, profileGate.dietaryFlags);
      excludedCuisines = mergeExcludedCuisines(bodyExcluded, profileGate.excludedCuisines);
    } else {
      const existing = parseGuestCookieValue(request.cookies.get(AI_GUEST_COOKIE_NAME)?.value);
      if (existing) {
        guestId = existing;
      } else if (hasGuestSigningSecret()) {
        const minted = mintGuestCookieValue();
        guestCookieToSet = minted;
        guestId = minted ? parseGuestCookieValue(minted) : null;
      }
      subjectKey = guestId ? `guest:${guestId}` : `guest:anon`;
    }

    const errorResponse = (error: string, status: number) =>
      withGuestCookie(NextResponse.json({ error }, { status }), guestCookieToSet);

    const market = await requireLaunchMarketId(admin);
    if (!market.ok) {
      return errorResponse('No restaurants available right now.', 503);
    }
    const { data: rows, error: dbError } = await admin
      .from('restaurants')
      .select(
        'id, name, cuisine_tags, neighborhood, address, price_range, image_url, google_place_id, is_dairy_free, is_vegan, is_halal',
      )
      .eq('status', 'active')
      .eq('market_id', market.marketId);

    if (dbError) {
      console.error('[roulette] supabase:', dbError.message);
      return errorResponse('Could not load restaurants. Please try again.', 500);
    }

    let restaurants = (rows ?? []) as RouletteRestaurant[];
    if (restaurants.length === 0) {
      return errorResponse('No restaurants available right now.', 503);
    }

    if (dietaryFlags.length > 0) {
      restaurants = restaurants.filter((r) => restaurantMatchesDietaryQuick(r, dietaryFlags));
      if (restaurants.length === 0) {
        return errorResponse(
          'No restaurants match those dietary filters yet. Try fewer options, or we may still be tagging partners — check back soon.',
          404,
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
        return errorResponse(
          'No restaurants match your exclusions right now. Try removing one exclusion, or we may still be tagging partners — check back soon.',
          404,
        );
      }
    }

    const byId = new Map(restaurants.map((r) => [r.id, r]));
    const poolIds = new Set(byId.keys());

    const respond = (payload: RouletteJson, status = 200) =>
      withGuestCookie(NextResponse.json(payload, { status }), guestCookieToSet);

    const randomFallback = () => {
      const chosen = pickRandom(restaurants);
      return respond(toRouletteJson(chosen, 'random_fallback'));
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
      // Recovery is best-effort; a lock skip must not block this ask.
    }

    let promptRows = shuffleArray(restaurants).slice(0, ROULETTE_MAX_RESTAURANTS_IN_PROMPT);
    const requestNonce = randomUUID();
    const filterCanonical = canonicalFilterString({
      dietary: dietaryFlags,
      excluded: excludedCuisines,
      vibe,
      timeOfDay,
      priceRange,
      preferredCuisine,
    });

    const dietaryLine =
      dietaryFlags.length > 0
        ? `Dietary filters already applied to this list: ${dietaryFlags.join(', ')}`
        : null;
    const priceLine = priceRange ? `Price preference (soft): ${priceRange}` : null;
    const cuisineLine = preferredCuisine
      ? `Preferred cuisine (soft): ${cuisineLabel(preferredCuisine)}`
      : null;
    const messageLine = acceptedMessage ? `Request: ${acceptedMessage}` : null;
    const userPrefs = [
      vibe ? `Vibe: ${vibe}` : null,
      timeOfDay ? `Time of day: ${timeOfDay}` : null,
      dietaryLine,
      priceLine,
      cuisineLine,
      messageLine,
    ]
      .filter(Boolean)
      .join('\n');

    const systemPrompt = `You choose one restaurant id for a discovery app in ${LAUNCH_MARKET.displayName}.

Each request is independent. Do not default to the same restaurant. Choose exactly one id from the JSON array you receive.

Return ONLY a single JSON object, no markdown fences, no commentary before or after.
Required key: "restaurantId" (string id from the list). Do not include a reason, a vibe, or a dish.

{"restaurantId":"..."}`;

    const buildUserPrompt = (list: RouletteRestaurant[]) => {
      const listJson = JSON.stringify(
        list.map((r) => ({
          id: r.id,
          name: clipChars(r.name, ROULETTE_MAX_NAME_CHARS),
          cuisine_tags: r.cuisine_tags,
          neighborhood: r.neighborhood,
          price_range: r.price_range,
        })),
      );
      return `Request id: ${requestNonce}

Here is the JSON array of eligible partner restaurants (each has id, name, cuisine_tags, neighborhood, price_range):
${listJson}

User preferences (each line may be absent):
${userPrefs || '(No specific preferences — pick a varied standout for a night out.)'}`;
    };

    let userPrompt = buildUserPrompt(promptRows);
    while (
      Buffer.byteLength(systemPrompt, 'utf8') + Buffer.byteLength(userPrompt, 'utf8') >
        ROULETTE_MAX_PROMPT_BYTES &&
      promptRows.length > 8
    ) {
      promptRows = promptRows.slice(0, Math.ceil(promptRows.length / 2));
      userPrompt = buildUserPrompt(promptRows);
    }
    const promptIds = promptRows.map((row) => row.id);

    const messageMac = discoveryReplayMac('message', acceptedMessage);
    const filterMac = discoveryReplayMac('filter', filterCanonical);
    if (!messageMac || !filterMac) {
      return randomFallback();
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

    const replayStored = async (): Promise<NextResponse> => {
      const loaded = await rpcAiLoadResultPayload(reserved.request_id);
      const decision = decideReplay({
        payload: loaded?.result_payload,
        messageMac,
        filterMac,
        poolIds,
      });
      if (decision.outcome === 'mismatch') {
        return errorResponse(DISCOVERY_REPLAY_MISMATCH_ERROR, 409);
      }
      if (decision.outcome === 'ai' || decision.outcome === 'legacy') {
        const chosen = byId.get(decision.restaurantId);
        if (chosen) {
          const mode: RouletteSelectionMode = decision.outcome === 'ai' ? 'ai' : 'random_fallback';
          return respond(toRouletteJson(chosen, mode));
        }
      }
      return randomFallback();
    };

    if (!reserved.acquired) {
      return replayStored();
    }

    const dispatched = await rpcAiDispatch(reserved.request_id);
    if (!dispatched.acquired) {
      return replayStored();
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
        console.warn('[roulette] anthropic timeout — using template fallback');
      }
      claudeText = '';
    } finally {
      clearTimeout(anthropicTimeout);
    }

    const parsedId = claudeText ? parseModelRestaurantId(claudeText) : null;
    const pickValid = isIdInPromptRows(parsedId, promptIds);
    const chosen = pickValid && parsedId ? promptRows.find((row) => row.id === parsedId) : undefined;
    const selectionMode: RouletteSelectionMode = chosen ? 'ai' : 'random_fallback';
    const cardRestaurant = chosen ?? pickRandom(restaurants);

    await accountForOutcome({
      requestId: reserved.request_id,
      dispatched: true,
      pickValid,
      usage,
    });

    const payload = toRouletteJson(cardRestaurant, selectionMode);
    try {
      await rpcAiStoreResultPayload(
        reserved.request_id,
        buildStoredDiscoveryPayload({
          restaurantId: cardRestaurant.id,
          selectionMode,
          promptIds,
          messageMac,
          filterMac,
        }),
      );
    } catch {
      // Replay can still fall back if the payload does not persist.
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
