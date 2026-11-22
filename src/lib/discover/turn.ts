import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase/server';
import { requireLaunchMarketId } from '@/lib/launch-market-server';
import { LAUNCH_MARKET } from '@/lib/launch-market';
import { safeManualImagePath } from '@/lib/restaurant-image';
import type { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { restaurantMatchesDietaryQuick, shuffleArray } from '@/lib/roulette-dietary';
import { cuisineLabel, isCuisineId, restaurantHasExcludedCuisine } from '@/lib/cuisines';
import { isRoulettePriceRange, ROULETTE_TIMES, ROULETTE_VIBES } from '@/lib/roulette-options';
import { allowBillableRoulette } from '@/lib/ratelimit';
import { isWanderbiteAiDisabled } from '@/lib/ai-kill-switch';
import { trustedClientIpFromHeaders } from '@/lib/client-ip';
import {
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
  DISCOVER_LINE_MAX_OUTPUT_TOKENS,
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
import {
  fallbackReasonForReplayMiss,
  logDiscoverAiPick,
  logDiscoverFallback,
  modelPickFallbackReason,
  prerequisiteFallbackReason,
  type DiscoverFallbackReason,
  type DiscoverMemberType,
} from '@/lib/discover/fallback-reason';
import { briefingsEnabled, logBriefingsReadFailedOnce } from '@/lib/briefings/flag';
import { loadDiscoverBriefingFacts } from '@/lib/briefings/load';
import type { RestaurantBriefings } from '@/lib/briefings/types';
import { eventsForDiscoverCard } from '@/lib/discover/card-events';
import {
  MESSAGE_EXCLUSION_EMPTY,
  listingTagsFromMessage,
  constrainDiscoverPool,
  mergeSoftAsk,
  rankDiscoverRestaurant,
} from '@/lib/discover/code-pick';
import { discoverCodePickEnabled } from '@/lib/discover/flag';
import { preferUnvisitedRestaurants } from '@/lib/discover/member-memory';
import { buildDiscoverLinePrompt, validateDiscoverLine } from '@/lib/discover/pick-line';
import {
  loadMemberVisitedRestaurantIds,
  logMemberVisitsReadFailedOnce,
} from '@/lib/discover/member-visits';
import {
  DISCOVER_FACT_PROMPT_NOTE,
  discoverCardFacts,
  discoverLineSourceText,
  discoverPromptFacts,
} from '@/lib/discover/briefing-facts';
import { parseDiscoverAskTone, type DiscoverEvent } from '@/lib/discover/events';
import {
  applyRestaurantExclusion,
  canonicalFilterWithExcludedRestaurants,
  exclusionEmptiesPool,
} from '@/lib/discover/exclude-restaurants';
import { cheaperChoiceLanded, type DiscoverRefineKind } from '@/lib/discover/voice';
import {
  listedDiscoverRestaurants,
  restaurantMatchesPreferredCuisine,
  type DiscoverRestaurant,
} from '@/lib/discover/stages';
import { recipeQaEnabled } from '@/lib/recipes/flag';
import { discoveryRecipeQaIntent } from '@/lib/recipes/qa-intent';
import { loadVisitCatalogNames, runRecipeQaTurn } from '@/lib/recipes/qa-turn';

const ANTHROPIC_TIMEOUT_MS = 7_000;

export type RouletteSelectionMode = 'ai' | 'random_fallback';

type RouletteRestaurant = DiscoverRestaurant;

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

export type DiscoverTurnResult = {
  status: number;
  body: object;
  guestCookie: string | null;
  events: DiscoverEvent[];
  memberUserId: string | null;
  selectionMode: RouletteSelectionMode | null;
};

function pickRandom<T>(arr: readonly T[]): T {
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
  line?: string,
): RouletteJson {
  const sentence = line?.trim()
    ? line.trim()
    : discoveryCardSentence(chosen, LAUNCH_MARKET.displayName);
  return {
    restaurantId: chosen.id,
    restaurantName: chosen.name,
    reason: clipChars(sentence, ROULETTE_MAX_RESULT_REASON_CHARS),
    cuisine_tags: chosen.cuisine_tags,
    neighborhood: chosen.neighborhood,
    address: chosen.address,
    price_range: chosen.price_range,
    image_url: safeManualImagePath(chosen.image_url),
    google_place_id: chosen.google_place_id,
    selectionMode,
  };
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

export async function runDiscoverTurn(request: NextRequest): Promise<DiscoverTurnResult> {
  let guestCookieToSet: string | null = null;
  try {
    const declared = request.headers.get('content-length');
    const declaredLength = declared ? Number(declared) : null;
    if (declaredLength !== null && !Number.isFinite(declaredLength)) {
      return {
        status: 400,
        body: { error: 'Invalid request body.' },
        guestCookie: guestCookieToSet,
        events: [],
        memberUserId: null,
        selectionMode: null,
      };
    }
    if (declaredLength !== null && declaredLength > ROULETTE_MAX_BODY_BYTES) {
      return {
        status: 413,
        body: { error: 'Request too large.' },
        guestCookie: guestCookieToSet,
        events: [],
        memberUserId: null,
        selectionMode: null,
      };
    }

    const rawBuf = await request.arrayBuffer();
    if (!isBodyWithinByteLimit(rawBuf.byteLength, declaredLength)) {
      return {
        status: 413,
        body: { error: 'Request too large.' },
        guestCookie: guestCookieToSet,
        events: [],
        memberUserId: null,
        selectionMode: null,
      };
    }

    type RouletteBody = {
      vibe?: string;
      timeOfDay?: string;
      dietaryQuick?: unknown;
      excludedCuisines?: unknown;
      excludeRestaurantIds?: unknown;
      priceRange?: string;
      preferredCuisine?: string;
      idempotencyKey?: string;
      message?: unknown;
      /** Fallback copy only. Not a filter, a prompt line, or a log field. */
      askTone?: unknown;
      /** Cheaper or New vibe. Copy and a cheaper tie-break. Not a log field. */
      refine?: unknown;
      /** Another idea or a tweak while the session is still Surprise me. */
      surpriseSession?: unknown;
      /** Round-robin slot for the surprise lines. */
      lineIndex?: unknown;
      /** Price on the ask before Cheaper. Null means there was no price yet. */
      previousPrice?: unknown;
    };
    let body: RouletteBody;
    try {
      body = JSON.parse(new TextDecoder().decode(rawBuf)) as RouletteBody;
    } catch {
      return {
        status: 400,
        body: { error: 'Invalid request body.' },
        guestCookie: guestCookieToSet,
        events: [],
        memberUserId: null,
        selectionMode: null,
      };
    }

    const messageGate = gateDiscoveryMessage(body.message);
    if (!messageGate.ok) {
      return {
        status: messageGate.status,
        body: { error: messageGate.error },
        guestCookie: guestCookieToSet,
        events: [],
        memberUserId: null,
        selectionMode: null,
      };
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
    const excludeRestaurantIds = boundStringArray(
      body.excludeRestaurantIds,
      ROULETTE_MAX_EXCLUDED,
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
    const askTone = parseDiscoverAskTone(body.askTone);
    const refine: DiscoverRefineKind | null =
      body.refine === 'cheaper' || body.refine === 'new-vibe' ? body.refine : null;
    const surpriseSession = body.surpriseSession === true;
    const lineIndex =
      typeof body.lineIndex === 'number' && Number.isFinite(body.lineIndex)
        ? Math.trunc(body.lineIndex)
        : 0;
    const previousPrice =
      typeof body.previousPrice === 'string' && isRoulettePriceRange(body.previousPrice)
        ? body.previousPrice
        : null;

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

    const finish = (
      status: number,
      payload: object,
      extra?: {
        events?: DiscoverEvent[];
        selectionMode?: RouletteSelectionMode | null;
      },
    ): DiscoverTurnResult => ({
      status,
      body: payload,
      guestCookie: guestCookieToSet,
      events: extra?.events ?? [],
      memberUserId: userId,
      selectionMode: extra?.selectionMode ?? null,
    });

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
        return finish(422, { error: DISCOVERY_ALLERGY_ERROR });
      }
      if (!profileGate.ok) {
        if (profileError) console.error('[roulette] profile', profileError.message);
        if (prefsError) console.error('[roulette] preferences', prefsError.message);
        return finish(503, { error: DISCOVERY_PROFILE_ERROR });
      }
      accountTier = profileGate.accountTier;
      dietaryFlags = mergeDietaryFlags(bodyDietary, profileGate.dietaryFlags);
      excludedCuisines = mergeExcludedCuisines(bodyExcluded, profileGate.excludedCuisines);
      const classified = discoveryRecipeQaIntent(acceptedMessage);
      const restaurantNames =
        !classified && recipeQaEnabled() && /\b(?:hours|visit)\b/i.test(acceptedMessage)
          ? await loadVisitCatalogNames(admin)
          : [];
      const qaIntent = classified ?? discoveryRecipeQaIntent(acceptedMessage, { restaurantNames });
      if (qaIntent && profile) {
        const qaIp = trustedClientIpFromHeaders(request.headers);
        const qa = await runRecipeQaTurn({
          userId: user.id,
          accountTier: profileGate.accountTier,
          message: acceptedMessage,
          intent: qaIntent,
          dietaryFlags: profile.dietary_flags,
          allergyFlags: profile.allergy_flags,
          excludedCuisines: [...profileGate.excludedCuisines],
          subjectKey,
          clientUuid,
          ipHash: qaIp ? hashClientIp(qaIp) : null,
        });
        return finish(200, { recipeQa: qa });
      }
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

    const memberType: DiscoverMemberType = userId ? 'member' : 'guest';

    const errorResponse = (error: string, status: number) => finish(status, { error });

    const market = await requireLaunchMarketId(admin);
    if (!market.ok) {
      return errorResponse('No restaurants available right now.', 503);
    }
    const { data: rows, error: dbError } = await admin
      .from('restaurants')
      .select(
        'id, name, cuisine_tags, neighborhood, address, price_range, image_url, google_place_id, is_dairy_free, is_vegan, is_halal, status',
      )
      .eq('status', 'active')
      .eq('market_id', market.marketId);

    if (dbError) {
      console.error('[roulette] supabase:', dbError.message);
      return errorResponse('Could not load restaurants. Please try again.', 500);
    }

    let restaurants = listedDiscoverRestaurants((rows ?? []) as RouletteRestaurant[]);
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

    const softAsk = mergeSoftAsk({
      message: acceptedMessage,
      preferredCuisine,
      priceRange,
    });
    const requireAllCuisines =
      softAsk.preferredCuisines.length > 1 && !/\bor\b/i.test(acceptedMessage);
    const constrained = constrainDiscoverPool(restaurants, softAsk, requireAllCuisines);
    if (constrained.emptiedByNegation) {
      return errorResponse(MESSAGE_EXCLUSION_EMPTY, 404);
    }
    restaurants = constrained.pool;

    const poolRestarted = exclusionEmptiesPool(restaurants, excludeRestaurantIds);
    if (!poolRestarted) {
      restaurants = applyRestaurantExclusion(restaurants, excludeRestaurantIds);
    }

    const restaurantIds = restaurants.map((row) => row.id);
    async function readBriefingFacts(): Promise<RestaurantBriefings> {
      try {
        return await loadDiscoverBriefingFacts({ restaurantIds });
      } catch {
        logBriefingsReadFailedOnce();
        return { byRestaurantId: {} };
      }
    }
    async function readVisitedRestaurants(): Promise<ReadonlySet<string> | null> {
      if (!userId) return null;
      try {
        return await loadMemberVisitedRestaurantIds(admin, userId, restaurantIds);
      } catch {
        logMemberVisitsReadFailedOnce();
        return null;
      }
    }
    const [briefingFacts, visitedRestaurantIds] = await Promise.all([
      readBriefingFacts(),
      readVisitedRestaurants(),
    ]);

    // Fallback only. The prompt and the facts loader keep `restaurants`.
    const fallbackPool = (): readonly RouletteRestaurant[] =>
      visitedRestaurantIds == null
        ? restaurants
        : preferUnvisitedRestaurants(restaurants, visitedRestaurantIds);

    const byId = new Map(restaurants.map((r) => [r.id, r]));
    const poolIds = new Set(byId.keys());

    /**
     * Null unless DISCOVER_CODE_PICK_ENABLED is exactly "true".
     * The model still chooses the id on the flag-off path below.
     * On this path the ranker chooses the id. selectionMode is `ai` only
     * when Haiku's sentence is shown, and `random_fallback` when the card
     * uses the template sentence.
     */
    const messageAsk = discoverCodePickEnabled() ? softAsk : null;
    const codePick = messageAsk
      ? rankDiscoverRestaurant({
          pool: restaurants,
          preferredCuisines: messageAsk.preferredCuisines,
          excludedCuisines: messageAsk.excludedCuisines,
          priceRange: messageAsk.priceRange,
          vibe,
          preferredTags: listingTagsFromMessage(acceptedMessage),
          preferCheaper: refine === 'cheaper',
          requireAllCuisines,
          visitedRestaurantIds,
          random: Math.random,
        })
      : null;
    const codePickRestaurant = codePick?.restaurant ?? null;
    const codePickPreferencesMet = codePick?.preferencesMet ?? true;

    const cardEvents = (
      chosen: RouletteRestaurant,
      selectionMode: RouletteSelectionMode,
      fallbackReason: DiscoverFallbackReason | null,
      providerTimedOut: boolean,
      line?: string,
    ) => {
      const payload = toRouletteJson(chosen, selectionMode, line);
      return finish(200, payload, {
        selectionMode,
        events: eventsForDiscoverCard({
          message: acceptedMessage,
          dietary: dietaryFlags,
          excludedCuisineIds: [...excludedCuisines, ...softAsk.excludedCuisines],
          vibe,
          timeOfDay,
          priceRange,
          preferredCuisine,
          restaurants,
          chosen,
          reason: payload.reason,
          selectionMode,
          fallbackReason,
          providerTimedOut,
          askTone,
          surpriseSession,
          refine,
          lineIndex,
          poolRestarted,
          cheaperLanded: refine === 'cheaper' && cheaperChoiceLanded(chosen.price_range, previousPrice),
          vibeChanged:
            refine === 'new-vibe' &&
            Boolean(vibe) &&
            excludeRestaurantIds.at(-1) !== chosen.id,
          samePlace: refine === 'new-vibe' && excludeRestaurantIds.at(-1) === chosen.id,
          facts: discoverCardFacts(briefingFacts.byRestaurantId[chosen.id] ?? []),
          visitedRestaurantIds,
        }),
      });
    };

    const discoverBase = (requestId: string) => ({
      requestId,
      memberType,
      poolSize: restaurants.length,
      dietaryFilterCount: dietaryFlags.length,
    });

    const matchesNamedCuisine = (row: RouletteRestaurant) =>
      messageAsk !== null &&
      messageAsk.preferredCuisines.some((id) =>
        restaurantMatchesPreferredCuisine(row.cuisine_tags, id),
      );

    const randomFallback = (reason: DiscoverFallbackReason, requestId: string = clientUuid) => {
      logDiscoverFallback({
        reason,
        ...discoverBase(requestId),
      });
      const chosen = codePickRestaurant ?? pickRandom(fallbackPool());
      if (reason !== 'unmet_preference' && codePickPreferencesMet && matchesNamedCuisine(chosen)) {
        return cardEvents(chosen, 'ai', null, false);
      }
      return cardEvents(chosen, 'random_fallback', reason, false);
    };

    const clientIp = trustedClientIpFromHeaders(request.headers);
    const ipHash = clientIp ? hashClientIp(clientIp) : null;
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    const prerequisiteReason = prerequisiteFallbackReason({
      aiDisabled: isWanderbiteAiDisabled(),
      hasApiKey: Boolean(apiKey),
      hasGuestSigningSecret: hasGuestSigningSecret(),
      hasIpHashSecret: hasIpHashSecret(),
      hasIpHash: Boolean(ipHash),
      hasSubject: userId !== null || guestId !== null,
    });

    if (codePickRestaurant && !codePickPreferencesMet) {
      return randomFallback('unmet_preference');
    }

    if (prerequisiteReason || !ipHash) {
      return randomFallback(prerequisiteReason ?? 'missing_identity');
    }

    const redisOk = await allowBillableRoulette(subjectKey, ipHash);
    if (!redisOk) {
      return randomFallback('rate_limited');
    }

    try {
      await rpcAiRecoverStaleRequests();
    } catch {
      // Recovery is best-effort; a lock skip must not block this ask.
    }

    const filterCanonical = canonicalFilterWithExcludedRestaurants(
      canonicalFilterString({
        dietary: dietaryFlags,
        excluded: excludedCuisines,
        vibe,
        timeOfDay,
        priceRange,
        preferredCuisine,
      }),
      excludeRestaurantIds,
    );

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

    let systemPrompt: string;
    let userPrompt: string;
    let promptRows: RouletteRestaurant[];
    let maxOutputTokens: number;

    if (codePickRestaurant) {
      const facts = briefingsEnabled()
        ? discoverPromptFacts(briefingFacts.byRestaurantId[codePickRestaurant.id] ?? [])
        : undefined;
      const linePrompt = buildDiscoverLinePrompt({
        marketDisplayName: LAUNCH_MARKET.displayName,
        restaurant: codePickRestaurant,
        preferenceLines: userPrefs,
        facts,
      });
      systemPrompt = linePrompt.systemPrompt;
      userPrompt = linePrompt.userPrompt;
      promptRows = [codePickRestaurant];
      maxOutputTokens = DISCOVER_LINE_MAX_OUTPUT_TOKENS;
    } else {
      promptRows = shuffleArray(restaurants).slice(0, ROULETTE_MAX_RESTAURANTS_IN_PROMPT);
      const requestNonce = randomUUID();
      systemPrompt = `You choose one restaurant id for a discovery app in ${LAUNCH_MARKET.displayName}.

Each request is independent. Do not default to the same restaurant. Choose exactly one id from the JSON array you receive.

Return ONLY a single JSON object, no markdown fences, no commentary before or after.
Required key: "restaurantId" (string id from the list). Do not include a reason, a vibe, or a dish.

{"restaurantId":"..."}`;

      const buildUserPrompt = (list: RouletteRestaurant[]) => {
        const rows = list.map((r) => {
          const row = {
            id: r.id,
            name: clipChars(r.name, ROULETTE_MAX_NAME_CHARS),
            cuisine_tags: r.cuisine_tags,
            neighborhood: r.neighborhood,
            price_range: r.price_range,
          };
          const facts = discoverPromptFacts(briefingFacts.byRestaurantId[r.id] ?? []);
          return facts ? { ...row, facts } : row;
        });
        const factsNote = rows.some((row) => 'facts' in row)
          ? `${DISCOVER_FACT_PROMPT_NOTE}\n\n`
          : '';
        const listJson = JSON.stringify(rows);
        return `Request id: ${requestNonce}

Here is the JSON array of eligible partner restaurants (each has id, name, cuisine_tags, neighborhood, price_range):
${listJson}

${factsNote}User preferences (each line may be absent):
${userPrefs || '(No specific preferences — pick a varied standout for a night out.)'}`;
      };

      userPrompt = buildUserPrompt(promptRows);
      while (
        Buffer.byteLength(systemPrompt, 'utf8') + Buffer.byteLength(userPrompt, 'utf8') >
          ROULETTE_MAX_PROMPT_BYTES &&
        promptRows.length > 8
      ) {
        promptRows = promptRows.slice(0, Math.ceil(promptRows.length / 2));
        userPrompt = buildUserPrompt(promptRows);
      }
      maxOutputTokens = ROULETTE_MAX_OUTPUT_TOKENS;
    }
    const promptIds = promptRows.map((row) => row.id);

    const messageMac = discoveryReplayMac('message', acceptedMessage);
    const filterMac = discoveryReplayMac('filter', filterCanonical);
    if (!messageMac || !filterMac) {
      return randomFallback('missing_config');
    }

    const usageUnits = rouletteQuoteUsageUnits(systemPrompt, userPrompt, maxOutputTokens);
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

    const replayStored = async (): Promise<DiscoverTurnResult> => {
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
        const replayRestaurant = byId.get(decision.restaurantId);
        if (replayRestaurant) {
          const mode: RouletteSelectionMode = decision.outcome === 'ai' ? 'ai' : 'random_fallback';
          if (mode === 'ai') {
            logDiscoverAiPick({
              requestId: reserved.request_id,
              poolSize: restaurants.length,
            });
            return cardEvents(
              replayRestaurant,
              'ai',
              null,
              false,
              decision.outcome === 'ai' ? decision.line : undefined,
            );
          }
          logDiscoverFallback({
            reason: 'replay_fallback',
            ...discoverBase(reserved.request_id),
          });
          return cardEvents(replayRestaurant, 'random_fallback', 'replay_fallback', false);
        }
        return randomFallback('invalid_pick', reserved.request_id);
      }
      return randomFallback(
        fallbackReasonForReplayMiss({
          denyReason: reserved.deny_reason,
          payload: loaded?.result_payload,
        }),
        reserved.request_id,
      );
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
    let providerFailed = false;
    let providerTimedOut = false;
    let providerStatus: number | undefined;
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
          max_tokens: maxOutputTokens,
          temperature: 1,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
        signal: anthropicController.signal,
      });

      const providerRequestId = anthropicRequestIdFromHeaders(anthropicRes.headers);
      const anthropicRaw = await anthropicRes.text();
      if (!anthropicRes.ok) {
        providerStatus = anthropicRes.status;
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
      providerFailed = true;
      if (err instanceof Error && err.name === 'AbortError') {
        providerTimedOut = true;
        console.warn('[roulette] anthropic timeout — using template fallback');
      }
      claudeText = '';
    } finally {
      clearTimeout(anthropicTimeout);
    }

    const parsedId = !codePickRestaurant && claudeText ? parseModelRestaurantId(claudeText) : null;
    const modelPickValid = isIdInPromptRows(parsedId, promptIds);
    let lineDecision: ReturnType<typeof validateDiscoverLine> | null = null;
    if (codePickRestaurant && !providerFailed) {
      try {
        const lineFacts = briefingsEnabled()
          ? briefingFacts.byRestaurantId[codePickRestaurant.id] ?? []
          : [];
        const sourceText = discoverLineSourceText(codePickRestaurant.name, lineFacts);
        lineDecision = validateDiscoverLine({
          text: claudeText,
          otherRestaurantNames: restaurants
            .filter((row) => row.id !== codePickRestaurant.id)
            .map((row) => row.name),
          sourceText,
        });
      } catch {
        lineDecision = { ok: false, code: 'empty' };
      }
    }
    const lineAccepted = lineDecision?.ok === true;
    const pickValid = codePickRestaurant ? lineAccepted : modelPickValid;
    const modelReason = codePickRestaurant
      ? providerFailed
        ? modelPickFallbackReason({ providerFailed: true, parsedId: null, pickValid: false })
        : null
      : modelPickFallbackReason({ providerFailed, parsedId, pickValid: modelPickValid });
    const chosen =
      !codePickRestaurant && modelPickValid && parsedId
        ? promptRows.find((row) => row.id === parsedId)
        : undefined;
    const showHaikuLine = lineAccepted && codePickPreferencesMet;
    const selectionMode: RouletteSelectionMode = codePickRestaurant
      ? showHaikuLine
        ? 'ai'
        : 'random_fallback'
      : chosen
        ? 'ai'
        : 'random_fallback';
    const cardRestaurant = codePickRestaurant ?? chosen ?? pickRandom(fallbackPool());
    const shownLine = showHaikuLine && lineDecision?.ok ? lineDecision.line : undefined;
    const fallbackReason: DiscoverFallbackReason | null =
      selectionMode === 'ai'
        ? null
        : !codePickRestaurant
          ? (modelReason ?? 'invalid_pick')
          : providerFailed
            ? (modelReason ?? 'provider_error')
            : lineDecision?.ok
              ? 'unmet_preference'
              : 'line_rejected';
    const presentMatchedCuisine =
      fallbackReason !== null &&
      fallbackReason !== 'unmet_preference' &&
      codePickPreferencesMet &&
      matchesNamedCuisine(cardRestaurant);
    const presentedMode: RouletteSelectionMode =
      selectionMode === 'ai' || presentMatchedCuisine ? 'ai' : 'random_fallback';

    await accountForOutcome({
      requestId: reserved.request_id,
      dispatched: true,
      pickValid,
      usage,
    });

    try {
      await rpcAiStoreResultPayload(
        reserved.request_id,
        buildStoredDiscoveryPayload({
          restaurantId: cardRestaurant.id,
          selectionMode: presentedMode,
          promptIds,
          messageMac,
          filterMac,
          line: shownLine,
        }),
      );
    } catch {
      // Replay can still fall back if the payload does not persist.
    }
    // Log only with the card that is returned. A ledger throw is a 500, not a pick.
    if (presentedMode === 'ai' && selectionMode === 'ai') {
      logDiscoverAiPick({
        requestId: reserved.request_id,
        poolSize: restaurants.length,
      });
      return cardEvents(cardRestaurant, 'ai', null, false, shownLine);
    }
    const reason = fallbackReason ?? 'invalid_pick';
    logDiscoverFallback({
      reason,
      ...discoverBase(reserved.request_id),
      ...(reason === 'provider_error' && providerStatus !== undefined ? { providerStatus } : {}),
      ...(reason === 'line_rejected' && lineDecision && !lineDecision.ok
        ? { lineCode: lineDecision.code }
        : {}),
    });
    if (presentMatchedCuisine) {
      return cardEvents(cardRestaurant, 'ai', null, false);
    }
    return cardEvents(cardRestaurant, 'random_fallback', reason, providerTimedOut);
  } catch (err) {
    console.error('[roulette] unhandled:', err);
    return {
      status: 500,
      body: { error: 'Something went wrong. Please try again.' },
      guestCookie: guestCookieToSet,
      events: [],
      memberUserId: null,
      selectionMode: null,
    };
  }
}
