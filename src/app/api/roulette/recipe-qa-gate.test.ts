import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DISCOVERY_ALLERGY_ERROR, DISCOVERY_PROFILE_ERROR } from '@/lib/discovery-turn';

const { runRecipeQaTurn, rpcAiReserve, getUser, from } = vi.hoisted(() => ({
  runRecipeQaTurn: vi.fn(),
  rpcAiReserve: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/lib/recipes/qa-turn', () => ({
  runRecipeQaTurn: (...args: unknown[]) => runRecipeQaTurn(...args),
  loadVisitCatalogNames: async () => [],
}));

vi.mock('@/lib/ai-budget/rpcs', () => ({
  rpcAiReserve: (...args: unknown[]) => rpcAiReserve(...args),
  rpcAiCurrentVersions: vi.fn(),
  rpcAiDispatch: vi.fn(),
  rpcAiFailBeforeDispatch: vi.fn(),
  rpcAiLoadResultPayload: vi.fn(),
  rpcAiMarkAssumedSpent: vi.fn(),
  rpcAiReconcile: vi.fn(),
  rpcAiRecoverStaleRequests: vi.fn(),
  rpcAiReleaseCustomerAllowance: vi.fn(),
  rpcAiSettle: vi.fn(),
  rpcAiStoreResultPayload: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: () => getUser() },
  }),
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ from }),
}));

vi.mock('@/lib/launch-market-server', () => ({
  requireLaunchMarketId: async () => ({ ok: false, error: 'unavailable' }),
}));

import { POST } from '@/app/api/roulette/route';

const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const profileState: {
  data: {
    subscription_status: string | null;
    dietary_flags: string[] | null;
    allergy_flags: string[] | null;
  } | null;
  error: { message: string } | null;
} = {
  data: { subscription_status: 'active', dietary_flags: [], allergy_flags: [] },
  error: null,
};

const prefsState: {
  data: { excluded_cuisines: string[] | null } | null;
  error: { message: string } | null;
} = { data: { excluded_cuisines: [] }, error: null };

function post(message: string): NextRequest {
  return new NextRequest('http://localhost/api/roulette', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
  });
}

describe('Discover allergy gates on the recipe path', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    delete process.env.E05_RECIPES_ENABLED;
    delete process.env.E05_RECIPE_QA_ENABLED;
    runRecipeQaTurn.mockReset();
    rpcAiReserve.mockReset();
    getUser.mockReset();
    from.mockReset();
    profileState.data = { subscription_status: 'active', dietary_flags: [], allergy_flags: [] };
    profileState.error = null;
    prefsState.data = { excluded_cuisines: [] };
    prefsState.error = null;
    getUser.mockResolvedValue({ data: { user: { id: USER } } });
    from.mockImplementation((table: string) => {
      const api = {
        select: () => api,
        eq: () => api,
        maybeSingle: async () => {
          if (table === 'user_profiles') return { data: profileState.data, error: profileState.error };
          if (table === 'user_preferences') return { data: prefsState.data, error: prefsState.error };
          return { data: null, error: null };
        },
      };
      return api;
    });
    runRecipeQaTurn.mockResolvedValue({
      answer: 'Inspired-by home recipe.',
      notice: null,
      recipes: [],
      generatedLabel: null,
      generatedText: null,
      visitLines: [],
    });
  });

  it('returns the main 422 for a recipe question on the safety list and does not call the model', async () => {
    process.env.E05_RECIPES_ENABLED = 'true';
    process.env.E05_RECIPE_QA_ENABLED = 'true';
    const response = await POST(post('how can I make peanut sauce at home?'));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: DISCOVERY_ALLERGY_ERROR });
    expect(getUser).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(runRecipeQaTurn).not.toHaveBeenCalled();
    expect(rpcAiReserve).not.toHaveBeenCalled();
  });

  it('blocks a signed-in member with saved allergies before any recipe turn', async () => {
    process.env.E05_RECIPES_ENABLED = 'true';
    process.env.E05_RECIPE_QA_ENABLED = 'true';
    profileState.data = {
      subscription_status: 'active',
      dietary_flags: ['vegan'],
      allergy_flags: ['peanut'],
    };
    const response = await POST(post('what is the exact recipe from Demo Grill'));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: DISCOVERY_ALLERGY_ERROR });
    expect(from.mock.calls.map((call) => call[0])).not.toContain('recipes');
    expect(runRecipeQaTurn).not.toHaveBeenCalled();
    expect(rpcAiReserve).not.toHaveBeenCalled();
  });

  it('keeps profile-unavailable handling and does not start recipe Q&A', async () => {
    process.env.E05_RECIPES_ENABLED = 'true';
    process.env.E05_RECIPE_QA_ENABLED = 'true';
    profileState.data = null;
    profileState.error = { message: 'profile down' };
    const response = await POST(post('what is the exact recipe from Demo Grill'));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: DISCOVERY_PROFILE_ERROR });
    expect(runRecipeQaTurn).not.toHaveBeenCalled();
    expect(rpcAiReserve).not.toHaveBeenCalled();
  });

  it('leaves a flagged-off recipe question on the Discover path', async () => {
    const response = await POST(post('what is the exact recipe from Demo Grill'));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'No restaurants available right now.',
    });
    expect(runRecipeQaTurn).not.toHaveBeenCalled();
    expect(rpcAiReserve).not.toHaveBeenCalled();
  });

  it('runs recipe Q&A only after the profile gate allows the member', async () => {
    process.env.E05_RECIPES_ENABLED = 'true';
    process.env.E05_RECIPE_QA_ENABLED = 'true';
    const response = await POST(post('what is the exact recipe from Demo Grill'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { recipeQa?: { answer?: string } };
    expect(body.recipeQa?.answer).toBe('Inspired-by home recipe.');
    expect(runRecipeQaTurn).toHaveBeenCalledOnce();
    expect(rpcAiReserve).not.toHaveBeenCalled();
  });
});
