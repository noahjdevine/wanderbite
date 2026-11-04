import 'server-only';

import { classifyRouletteAccounting } from '@/lib/ai-budget/accounting';
import {
  ANTHROPIC_HAIKU_SNAPSHOT,
  ANTHROPIC_PROVIDER,
  ROULETTE_MAX_OUTPUT_TOKENS,
} from '@/lib/ai-budget/models';
import { rouletteQuoteUsageUnits } from '@/lib/ai-budget/quote';
import {
  rpcAiCurrentVersions,
  rpcAiDispatch,
  rpcAiFailBeforeDispatch,
  rpcAiMarkAssumedSpent,
  rpcAiReconcile,
  rpcAiReleaseCustomerAllowance,
  rpcAiReserve,
  rpcAiSettle,
} from '@/lib/ai-budget/rpcs';
import { anthropicRequestIdFromHeaders, usageUnitsFromAnthropic } from '@/lib/ai-budget/usage';
import { ROULETTE_MAX_PROMPT_BYTES } from '@/lib/ai-bounds';
import { isWanderbiteAiDisabled } from '@/lib/ai-kill-switch';
import { loadReservedCapacityCounts } from '@/lib/challenges/generate';
import type { EligibilityVersion } from '@/lib/challenges/eligible-candidates';
import type { CooldownRedemption } from '@/lib/challenges/restaurant-safety';
import { requireLaunchMarketId } from '@/lib/launch-market-server';
import { assignmentDeadline, versionCapacityBuckets } from '@/lib/offers/version-capacity';
import { allowBillableRoulette } from '@/lib/ratelimit';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import type { Json } from '@/types/database.types';
import {
  logRecipesUnavailableOnce,
  recipeSchemaMissing,
} from '@/lib/recipes/flag';
import { PUBLISHED_RECIPE_COLUMNS, toRecipeCard, type PublishedRecipeRow } from '@/lib/recipes/load';
import {
  RECIPE_QA_BUDGET_NOTICE,
  RECIPE_QA_UNAVAILABLE_NOTICE,
  buildRecipeQaPrompts,
  composeRecipeQaAnswer,
  type QaRecipe,
  type RecipeQaAnswer,
} from '@/lib/recipes/qa-context';
import type { DiscoveryQaIntent } from '@/lib/recipes/qa-intent';
import { matchRestaurantName, recipeSearchKeywords, selectPublishedRecipes } from '@/lib/recipes/qa-match';
import { visitLinesFromLookup, type VisitCatalogRestaurant } from '@/lib/recipes/qa-visit';

const MODEL_TIMEOUT_MS = 7_000;
const BUDGET_DENIALS = new Set(['insufficient_budget', 'paid_core_reserve']);

export type RecipeQaTurnInput = {
  userId: string;
  accountTier: 'paid' | 'free';
  message: string;
  intent: DiscoveryQaIntent;
  dietaryFlags: string[] | null;
  allergyFlags: string[] | null;
  excludedCuisines: string[] | null;
  subjectKey: string;
  clientUuid: string;
  ipHash: string | null;
};

export type RecipeQaPublic = RecipeQaAnswer & {
  notice: string | null;
};

export type RecipeQaDeps = {
  loadRestaurants: () => Promise<VisitCatalogRestaurant[]>;
  loadRecipes: (restaurantId: string | null) => Promise<PublishedRecipeRow[]>;
  loadVisitLines: (restaurant: VisitCatalogRestaurant | null) => Promise<string[]>;
  allowModel: () => Promise<boolean>;
  reserve: (
    usage: Record<string, number>,
  ) => Promise<{ acquired: boolean; denyReason: string | null; requestId: string }>;
  dispatch: (requestId: string) => Promise<boolean>;
  account: (args: {
    requestId: string;
    text: string;
    usage: Record<string, number> | null;
  }) => Promise<void>;
  callModel: (args: { system: string; user: string }) => Promise<{
    text: string;
    usage: Record<string, number> | null;
  }>;
};

function promptBytes(systemPrompt: string, userPrompt: string): number {
  return Buffer.byteLength(systemPrompt, 'utf8') + Buffer.byteLength(userPrompt, 'utf8');
}

function toQaRecipe(
  row: PublishedRecipeRow,
  dietaryFlags: string[] | null,
  allergyFlags: string[] | null,
): QaRecipe | null {
  const card = toRecipeCard(row, new Set<string>(), dietaryFlags, allergyFlags);
  if (!card) return null;
  return {
    ...card,
    checkedAtIso: row.checked_at,
    retrievedAtIso: row.retrieved_at,
  };
}

export async function loadVisitCatalogNames(
  admin: ReturnType<typeof getSupabaseAdmin>,
): Promise<string[]> {
  try {
    const market = await requireLaunchMarketId(admin);
    if (!market.ok) return [];
    const { data, error } = await admin
      .from('restaurants')
      .select('name')
      .eq('status', 'active')
      .eq('market_id', market.marketId);
    if (error || !data) {
      console.warn('[recipe-qa] catalog unavailable');
      return [];
    }
    return data.map((row) => row.name);
  } catch {
    console.warn('[recipe-qa] catalog unavailable');
    return [];
  }
}

async function loadActiveRestaurants(): Promise<VisitCatalogRestaurant[]> {
  const admin = getSupabaseAdmin();
  const market = await requireLaunchMarketId(admin);
  if (!market.ok) {
    console.warn('[recipe-qa] catalog unavailable');
    return [];
  }
  const { data, error } = await admin
    .from('restaurants')
    .select(
      'id, name, cuisine_tags, neighborhood, address, description, price_range, is_dairy_free, is_vegan, is_halal, current_offer_version_id',
    )
    .eq('status', 'active')
    .eq('market_id', market.marketId);
  if (error || !data) {
    console.warn('[recipe-qa] catalog unavailable');
    return [];
  }
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    cuisine_tags: row.cuisine_tags,
    neighborhood: row.neighborhood,
    address: row.address,
    description: row.description,
    price_range: row.price_range,
    is_dairy_free: row.is_dairy_free,
    is_vegan: row.is_vegan,
    is_halal: row.is_halal,
    current_offer_version_id: row.current_offer_version_id,
    lat: null,
    lon: null,
  }));
}

async function loadPublishedRecipeRows(restaurantId: string | null): Promise<PublishedRecipeRow[]> {
  const admin = getSupabaseAdmin();
  const base = () =>
    admin.from('recipes').select(PUBLISHED_RECIPE_COLUMNS).eq('visibility', 'published');
  if (!restaurantId) {
    const { data, error } = await base().order('title', { ascending: true }).limit(80);
    if (error) {
      if (recipeSchemaMissing(error)) logRecipesUnavailableOnce();
      else console.warn('[recipe-qa] read failed');
      return [];
    }
    return (data ?? []) as PublishedRecipeRow[];
  }

  const [official, inspired] = await Promise.all([
    base()
      .eq('restaurant_id', restaurantId)
      .in('recipe_type', ['restaurant_approved', 'sourced_published'])
      .order('title', { ascending: true })
      .limit(3),
    base()
      .eq('restaurant_id', restaurantId)
      .eq('recipe_type', 'inspired_by')
      .order('title', { ascending: true })
      .limit(3),
  ]);
  if (official.error || inspired.error) {
    const error = official.error ?? inspired.error;
    if (recipeSchemaMissing(error)) logRecipesUnavailableOnce();
    else console.warn('[recipe-qa] read failed');
    return [];
  }
  return [...(official.data ?? []), ...(inspired.data ?? [])] as PublishedRecipeRow[];
}

async function lookupVisitLines(
  restaurant: VisitCatalogRestaurant | null,
  input: RecipeQaTurnInput,
): Promise<string[]> {
  const now = new Date();
  const dietaryFlags = input.dietaryFlags;
  const allergyFlags = input.allergyFlags;
  const excludedCuisineIds = input.excludedCuisines ?? [];
  if (!restaurant) {
    return visitLinesFromLookup({
      restaurant: null,
      version: null,
      redemptions: [],
      dietaryFlags,
      allergyFlags,
      excludedCuisineIds,
      now,
      confirmed: false,
    });
  }

  const admin = getSupabaseAdmin();
  const versionId = restaurant.current_offer_version_id;
  const [versionResult, redemptionResult] = await Promise.all([
    versionId
      ? admin
          .from('offer_versions')
          .select(
            'id, restaurant_id, valid_from, valid_until, withdrawn_from_selection_at, tiers, capacity_timezone, capacity_max_redemptions',
          )
          .eq('id', versionId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin
      .from('redemptions')
      .select('restaurant_id, status, verified_at, created_at')
      .eq('user_id', input.userId),
  ]);

  if (versionResult.error || redemptionResult.error) {
    console.warn('[recipe-qa] offer check unavailable');
    return visitLinesFromLookup({
      restaurant,
      version: null,
      redemptions: [],
      dietaryFlags,
      allergyFlags,
      excludedCuisineIds,
      now,
      confirmed: false,
    });
  }

  const versionRow = versionResult.data;
  const version: EligibilityVersion | null =
    versionRow && versionRow.restaurant_id === restaurant.id
      ? {
          id: versionRow.id,
          restaurant_id: versionRow.restaurant_id,
          valid_from: versionRow.valid_from,
          valid_until: versionRow.valid_until,
          withdrawn_from_selection_at: versionRow.withdrawn_from_selection_at,
          tiers: versionRow.tiers as Json,
          capacity_timezone: versionRow.capacity_timezone,
          capacity_max_redemptions: versionRow.capacity_max_redemptions,
        }
      : null;
  const redemptions = (redemptionResult.data ?? []) as CooldownRedemption[];
  let capacityCounts = new Map<string, number>();
  let confirmed = Boolean(version?.capacity_timezone && version.capacity_max_redemptions != null);
  if (confirmed && version?.capacity_timezone) {
    const buckets = versionCapacityBuckets(now, assignmentDeadline(now), version.capacity_timezone);
    if (buckets.length > 0) {
      const loaded = await loadReservedCapacityCounts(admin, [restaurant.id], buckets);
      if (!loaded.ok) {
        confirmed = false;
      } else {
        capacityCounts = loaded.counts.get(restaurant.id) ?? new Map<string, number>();
      }
    }
  }

  return visitLinesFromLookup({
    restaurant,
    version: confirmed ? version : null,
    redemptions,
    dietaryFlags,
    allergyFlags,
    excludedCuisineIds,
    capacityCounts,
    now,
    confirmed,
  });
}

async function defaultAllowModel(input: RecipeQaTurnInput): Promise<boolean> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (isWanderbiteAiDisabled() || !apiKey || !input.ipHash) return false;
  return allowBillableRoulette(input.subjectKey, input.ipHash);
}

async function defaultReserve(input: RecipeQaTurnInput, usage: Record<string, number>) {
  const versions = await rpcAiCurrentVersions();
  const reserved = await rpcAiReserve({
    accountTier: input.accountTier,
    configVersionId: versions.config_version_id,
    featureClass: 'optional',
    guestId: null,
    idempotencyKey: `recipe-qa:${input.subjectKey}:${input.clientUuid}`,
    modelId: ANTHROPIC_HAIKU_SNAPSHOT,
    priceVersionId: versions.price_version_id,
    provider: ANTHROPIC_PROVIDER,
    usageUnits: usage,
    userId: input.userId,
  });
  return {
    acquired: reserved.acquired,
    denyReason: reserved.deny_reason,
    requestId: reserved.request_id,
  };
}

async function defaultAccount(args: {
  requestId: string;
  text: string;
  usage: Record<string, number> | null;
}): Promise<void> {
  const action = classifyRouletteAccounting({
    dispatched: true,
    pickValid: args.text.trim().length > 0,
    usage: args.usage,
  });
  try {
    if (action === 'fail_before_dispatch') {
      await rpcAiFailBeforeDispatch(args.requestId);
      return;
    }
    if (action === 'assumed_spent_release' || action === 'assumed_spent_reconcile') {
      await rpcAiMarkAssumedSpent(args.requestId);
      await rpcAiReleaseCustomerAllowance(args.requestId);
      if (action === 'assumed_spent_reconcile' && args.usage) {
        try {
          await rpcAiReconcile(args.requestId, args.usage);
        } catch {
          console.error('[recipe-qa] reconcile failed');
        }
      }
      return;
    }
    if (!args.usage) return;
    await rpcAiSettle(args.requestId, args.usage);
  } catch {
    console.error('[recipe-qa] settle failed');
    try {
      await rpcAiMarkAssumedSpent(args.requestId);
      await rpcAiReleaseCustomerAllowance(args.requestId);
    } catch {
      console.error('[recipe-qa] settle failed');
    }
  }
}

function extractAnthropicText(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { content?: { type: string; text?: string }[] };
    return parsed.content?.find((block) => block.type === 'text')?.text ?? '';
  } catch {
    return '';
  }
}

async function defaultCallModel(args: {
  system: string;
  user: string;
}): Promise<{ text: string; usage: Record<string, number> | null }> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { text: '', usage: null };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_HAIKU_SNAPSHOT,
        max_tokens: ROULETTE_MAX_OUTPUT_TOKENS,
        temperature: 0,
        system: args.system,
        messages: [{ role: 'user', content: args.user }],
      }),
      signal: controller.signal,
    });
    const providerRequestId = anthropicRequestIdFromHeaders(response.headers);
    const raw = await response.text();
    if (!response.ok) {
      console.error('[recipe-qa] model failed', response.status, providerRequestId);
      return { text: '', usage: null };
    }
    let usage: Record<string, number> | null = null;
    try {
      const parsed = JSON.parse(raw) as { usage?: unknown };
      usage = usageUnitsFromAnthropic(parsed.usage);
    } catch {
      usage = null;
    }
    return { text: extractAnthropicText(raw), usage };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn('[recipe-qa] model timeout');
    } else {
      console.error('[recipe-qa] model failed');
    }
    return { text: '', usage: null };
  } finally {
    clearTimeout(timeout);
  }
}

function defaultDeps(input: RecipeQaTurnInput): RecipeQaDeps {
  return {
    loadRestaurants: loadActiveRestaurants,
    loadRecipes: loadPublishedRecipeRows,
    loadVisitLines: (restaurant) => lookupVisitLines(restaurant, input),
    allowModel: () => defaultAllowModel(input),
    reserve: (usage) => defaultReserve(input, usage),
    dispatch: async (requestId) => {
      const dispatched = await rpcAiDispatch(requestId);
      return dispatched.acquired;
    },
    account: defaultAccount,
    callModel: defaultCallModel,
  };
}

export async function runRecipeQaTurn(
  input: RecipeQaTurnInput,
  deps: RecipeQaDeps = defaultDeps(input),
): Promise<RecipeQaPublic> {
  const restaurants = await deps.loadRestaurants();
  const matched = matchRestaurantName(input.message, restaurants);
  const restaurantId = matched?.id ?? null;
  const rows = await deps.loadRecipes(restaurantId);
  const keywords = recipeSearchKeywords(input.message);
  const selection = selectPublishedRecipes({
    rows,
    restaurantId,
    keywords,
    intent: input.intent,
  });
  let recipes = selection.rows.flatMap((row) => {
    const card = toQaRecipe(row, input.dietaryFlags, input.allergyFlags);
    return card ? [card] : [];
  });
  const visitLines =
    input.intent === 'visit' || matched
      ? await deps.loadVisitLines(matched)
      : [];

  const build = (list: QaRecipe[]) =>
    buildRecipeQaPrompts({
      message: input.message,
      recipes: list,
      dietaryFlags: input.dietaryFlags,
      allergyFlags: input.allergyFlags,
      visitLines,
    });

  let prompts = build(recipes);
  while (
    promptBytes(prompts.systemPrompt, prompts.userPrompt) > ROULETTE_MAX_PROMPT_BYTES &&
    recipes.length > 0
  ) {
    recipes = recipes.slice(0, -1);
    prompts = build(recipes);
  }

  const finish = (modelText: string | null, notice: string | null): RecipeQaPublic => ({
    ...composeRecipeQaAnswer({
      intent: input.intent,
      recipes,
      hasOfficial: selection.hasOfficial,
      modelText,
      visitLines,
      now: new Date(),
    }),
    notice,
  });

  if (promptBytes(prompts.systemPrompt, prompts.userPrompt) > ROULETTE_MAX_PROMPT_BYTES) {
    return finish(null, RECIPE_QA_UNAVAILABLE_NOTICE);
  }

  if (!(await deps.allowModel())) {
    return finish(null, RECIPE_QA_UNAVAILABLE_NOTICE);
  }

  let reserved: { acquired: boolean; denyReason: string | null; requestId: string };
  try {
    reserved = await deps.reserve(rouletteQuoteUsageUnits(prompts.systemPrompt, prompts.userPrompt));
  } catch {
    console.error('[recipe-qa] reserve failed');
    return finish(null, RECIPE_QA_UNAVAILABLE_NOTICE);
  }

  if (!reserved.acquired) {
    const notice =
      reserved.denyReason && BUDGET_DENIALS.has(reserved.denyReason)
        ? RECIPE_QA_BUDGET_NOTICE
        : RECIPE_QA_UNAVAILABLE_NOTICE;
    return finish(null, notice);
  }

  const dispatched = await deps.dispatch(reserved.requestId);
  if (!dispatched) {
    return finish(null, RECIPE_QA_UNAVAILABLE_NOTICE);
  }

  const model = await deps.callModel({
    system: prompts.systemPrompt,
    user: prompts.userPrompt,
  });
  await deps.account({
    requestId: reserved.requestId,
    text: model.text,
    usage: model.usage,
  });
  return finish(model.text, null);
}
