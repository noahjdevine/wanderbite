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

const USER = '40000000-0000-4000-8000-000000000001';
const OTHER = '40000000-0000-4000-8000-000000000002';

const insert = vi.fn();
const update = vi.fn();
const updateEq = vi.fn();
const upsert = vi.fn();
const from = vi.fn();
const redirect = vi.fn();

const db = {
  lookup: { data: null as { id?: string; subscription_status?: string | null } | null, error: null as { message: string } | null },
  insertError: null as { code?: string; message: string; details?: string } | null,
  updateResult: {
    data: [{ id: USER }] as { id: string }[],
    error: null as { message: string } | null,
  },
};

const prefs = {
  dietary_flags: ['peanut'],
  excluded_cuisines: [] as string[],
  distance_band: '15_mi',
  wants_cocktail_experience: true,
};

const profileFields = {
  email: 'g2@example.com',
  dietary_flags: ['peanut'],
  distance_band: '15_mi',
  wants_cocktail_experience: true,
};

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

function query(table: string) {
  return {
    insert: (payload: unknown) => {
      insert(table, payload);
      return Promise.resolve({ error: db.insertError });
    },
    update: (payload: unknown) => {
      update(table, payload);
      return {
        eq: (column: string, id: string) => {
          updateEq(table, column, id);
          return {
            select: () => Promise.resolve(db.updateResult),
          };
        },
      };
    },
    upsert: (payload: unknown, options?: unknown) => {
      upsert(table, payload, options);
      const result = { data: [{ id: USER }], error: null };
      return {
        select: () => Promise.resolve(result),
        then: (
          resolve: (value: typeof result) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(result).then(resolve, reject),
      };
    },
    select: () => ({
      eq: () => ({
        maybeSingle: async () =>
          table === 'user_profiles'
            ? db.lookup
            : { data: { subscription_status: 'inactive' }, error: null },
      }),
    }),
  };
}

describe('G2 member profile write payloads', () => {
  beforeEach(() => {
    insert.mockReset();
    update.mockReset();
    updateEq.mockReset();
    upsert.mockReset();
    from.mockReset();
    redirect.mockReset();
    db.lookup = { data: null, error: null };
    db.insertError = null;
    db.updateResult = { data: [{ id: USER }], error: null };
    from.mockImplementation((table: string) => query(table));
  });

  it('inserts a missing profile without privileged columns', async () => {
    const { updatePreferences } = await import('@/app/actions/update-preferences');
    const result = await updatePreferences(prefs, USER);
    expect(result).toEqual({ ok: true });
    expect(insert).toHaveBeenCalledWith('user_profiles', {
      id: USER,
      ...profileFields,
    });
    const payload = insert.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('role');
    expect(payload).not.toHaveProperty('is_admin');
    expect(payload).not.toHaveProperty('subscription_status');
    expect(payload).not.toHaveProperty('stripe_subscription_id');
    expect(update).not.toHaveBeenCalled();
  });

  it('updates an existing profile without sending id', async () => {
    db.lookup = { data: { id: USER }, error: null };
    const { updatePreferences } = await import('@/app/actions/update-preferences');
    const result = await updatePreferences(prefs, USER);
    expect(result).toEqual({ ok: true });
    expect(insert).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith('user_profiles', profileFields);
    expect(updateEq).toHaveBeenCalledWith('user_profiles', 'id', USER);
    expect(update.mock.calls[0][1]).not.toHaveProperty('id');
  });

  it('does not insert when the profile lookup fails', async () => {
    db.lookup = { data: null, error: { message: 'db down' } };
    const { updatePreferences } = await import('@/app/actions/update-preferences');
    const result = await updatePreferences(prefs, USER);
    expect(result.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('retries an insert that conflicts on this profile id and checks the updated row', async () => {
    db.insertError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "user_profiles_pkey"',
      details: `Key (id)=(${USER}) already exists.`,
    };
    const { updatePreferences } = await import('@/app/actions/update-preferences');
    const result = await updatePreferences(prefs, USER);
    expect(result).toEqual({ ok: true });
    expect(update).toHaveBeenCalledTimes(1);
    expect(updateEq).toHaveBeenCalledWith('user_profiles', 'id', USER);
  });

  it('does not retry a unique conflict on another column', async () => {
    db.insertError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "user_profiles_username_key"',
      details: 'Key (username)=(g2) already exists.',
    };
    const { updatePreferences } = await import('@/app/actions/update-preferences');
    const result = await updatePreferences(prefs, USER);
    expect(result.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('fails when the preference update does not change this profile', async () => {
    db.lookup = { data: { id: USER }, error: null };
    db.updateResult = { data: [], error: null };
    const { updatePreferences } = await import('@/app/actions/update-preferences');
    const result = await updatePreferences(prefs, USER);
    expect(result.ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();

    upsert.mockClear();
    db.updateResult = { data: [{ id: OTHER }], error: null };
    const wrong = await updatePreferences(prefs, USER);
    expect(wrong.ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects a stale preferences form before any write', async () => {
    const { updatePreferences } = await import('@/app/actions/update-preferences');
    const result = await updatePreferences(prefs, OTHER);
    expect(result).toEqual({ ok: false, error: 'Your account changed—reload' });
    expect(from).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('omits privileged columns from structured profile upserts', async () => {
    const { updateProfileStructured } = await import('@/app/actions/update-profile-structured');
    const result = await updateProfileStructured(
      {
        username: 'g2_member',
        address: { street: '1 Main St', city: 'McKinney', state: 'tx', zip: '75070' },
      },
      USER,
    );
    expect(result).toEqual({ ok: true });
    expect(upsert.mock.calls[0][1]).toMatchObject({
      id: USER,
      username: 'g2_member',
      address_street: '1 Main St',
      address_city: 'McKinney',
      address_state: 'TX',
      address_zip: '75070',
    });
    expect(upsert.mock.calls[0][1]).not.toHaveProperty('role');
  });

  it('rejects a stale profile form before the service-client write', async () => {
    const { updateProfileStructured } = await import('@/app/actions/update-profile-structured');
    const result = await updateProfileStructured(
      {
        username: 'g2_member',
        address: { street: '1 Main St', city: 'McKinney', state: 'tx', zip: '75070' },
      },
      OTHER,
    );
    expect(result).toEqual({ ok: false, error: 'Your account changed—reload' });
    expect(from).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('omits privileged columns from onboarding upserts', async () => {
    const { completeOnboarding } = await import('@/app/actions/onboarding');
    await completeOnboarding({
      dietary_flags: ['peanut'],
      distance_band: '15_mi',
      wants_cocktail_experience: false,
    });
    expect(upsert.mock.calls[0][1]).toEqual({
      id: USER,
      email: 'g2@example.com',
      dietary_flags: ['peanut'],
      distance_band: '15_mi',
      wants_cocktail_experience: false,
    });
    expect(upsert.mock.calls[0][1]).not.toHaveProperty('role');
    expect(redirect).toHaveBeenCalledWith('/pricing');
  });
});
