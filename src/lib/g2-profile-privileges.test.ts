import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const MIGRATION = 'supabase/migrations/20260906012137_user_profiles_privilege_grants.sql';
const MEMBER_WRITE_FILES = [
  'src/app/actions/update-preferences.ts',
  'src/app/actions/update-profile-structured.ts',
  'src/app/actions/onboarding.ts',
] as const;

const upsert = vi.fn();
const from = vi.fn();
const redirect = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: '40000000-0000-4000-8000-000000000001', email: 'g2@example.com' } },
      }),
    },
    from: (...args: unknown[]) => from(...args),
  }),
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ from: (...args: unknown[]) => from(...args) }),
}));

vi.mock('next/navigation', () => ({
  redirect: (...args: unknown[]) => redirect(...args),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('G2 user_profiles privilege lock', () => {
  it('uses a forward-only migration that revokes table insert and update', () => {
    const initial = source('supabase/migrations/001_initial_schema.sql');
    const migration = source(MIGRATION);
    const sql = migration.replace(/--[^\n]*/g, '').replace(/\$\$[\s\S]*?\$\$/g, ' FUNCTION_BODY ');
    expect(initial).toMatch(/Users can update own profile/);
    expect(sql).not.toMatch(/^\s*(begin|start\s+transaction|commit|rollback)\b/im);
    expect(sql).toContain("set local lock_timeout = '5s'");
    expect(sql).toContain("set local statement_timeout = '30s'");
    expect(sql).toMatch(/revoke insert,\s*update on table public\.user_profiles from anon, authenticated/i);
    expect(sql).toMatch(/grant insert \(/i);
    expect(sql).toMatch(/grant update \(/i);
    expect(sql).not.toMatch(/grant insert on table public\.user_profiles/i);
    expect(sql).not.toMatch(/grant update on table public\.user_profiles/i);
    expect(sql).toMatch(/protect_user_profiles_privileged_columns/);
    expect(sql).toMatch(/before insert or update/);
  });

  it('stops member profile writes from setting role', () => {
    for (const rel of MEMBER_WRITE_FILES) {
      const src = source(rel);
      expect(src, rel).not.toMatch(/role:\s*['"]subscriber['"]/);
      expect(src, rel).not.toMatch(/role:\s*['"]admin['"]/);
    }
  });
});

describe('G2 member profile write payloads', () => {
  beforeEach(() => {
    upsert.mockReset();
    from.mockReset();
    redirect.mockReset();
    from.mockImplementation(() => ({
      upsert: (...args: unknown[]) => {
        upsert(...args);
        return Promise.resolve({ error: null });
      },
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { subscription_status: 'inactive' },
            error: null,
          }),
        }),
      }),
    }));
  });

  it('omits privileged columns from preference upserts', async () => {
    const { updatePreferences } = await import('@/app/actions/update-preferences');
    const result = await updatePreferences({
      dietary_flags: ['peanut'],
      excluded_cuisines: [],
      distance_band: '15_mi',
      wants_cocktail_experience: true,
    });
    expect(result).toEqual({ ok: true });
    expect(upsert.mock.calls[0][0]).toEqual({
      id: '40000000-0000-4000-8000-000000000001',
      email: 'g2@example.com',
      dietary_flags: ['peanut'],
      distance_band: '15_mi',
      wants_cocktail_experience: true,
    });
    expect(upsert.mock.calls[0][0]).not.toHaveProperty('role');
    expect(upsert.mock.calls[0][0]).not.toHaveProperty('is_admin');
    expect(upsert.mock.calls[0][0]).not.toHaveProperty('subscription_status');
  });

  it('omits privileged columns from structured profile upserts', async () => {
    const { updateProfileStructured } = await import('@/app/actions/update-profile-structured');
    const result = await updateProfileStructured({
      username: 'g2_member',
      address: { street: '1 Main St', city: 'McKinney', state: 'tx', zip: '75070' },
    });
    expect(result).toEqual({ ok: true });
    expect(upsert.mock.calls[0][0]).toMatchObject({
      id: '40000000-0000-4000-8000-000000000001',
      username: 'g2_member',
      address_street: '1 Main St',
      address_city: 'McKinney',
      address_state: 'TX',
      address_zip: '75070',
    });
    expect(upsert.mock.calls[0][0]).not.toHaveProperty('role');
  });

  it('omits privileged columns from onboarding upserts', async () => {
    const { completeOnboarding } = await import('@/app/actions/onboarding');
    await completeOnboarding({
      dietary_flags: ['peanut'],
      distance_band: '15_mi',
      wants_cocktail_experience: false,
    });
    expect(upsert.mock.calls[0][0]).toEqual({
      id: '40000000-0000-4000-8000-000000000001',
      email: 'g2@example.com',
      dietary_flags: ['peanut'],
      distance_band: '15_mi',
      wants_cocktail_experience: false,
    });
    expect(upsert.mock.calls[0][0]).not.toHaveProperty('role');
    expect(redirect).toHaveBeenCalledWith('/pricing');
  });
});
