import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertAdmin } from '@/lib/auth/assert-admin';
import { addRestaurant, deleteRestaurant, generateMissingSlugs, setRestaurantPin } from './actions';
import {
  attachGoogleMetadataToLatestRestaurantByName,
  getRestaurantDetailsFromGoogle,
  searchRestaurantsFromGoogle,
} from './actions-import';
import { enrichAllRestaurants, enrichSingleRestaurant } from './actions-places';
import AdminPage from './page';
import { AdminMfaGate } from './admin-mfa-gate';
import { AdminClient } from './admin-client';

type Query = {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete';
  select: string | null;
  eqId: string | null;
};

type QueryResult = { data: unknown; error: { message: string } | null };

const harness = vi.hoisted(() => ({
  calls: [] as Query[],
  aalArgs: [] as unknown[][],
  user: { ok: true as const, userId: 'user-a', email: 'a@example.com' } as
    | { ok: true; userId: string; email: string | null }
    | { ok: false; error: string },
  roles: { 'user-a': 'admin' } as Record<string, string>,
  roleError: null as { message: string } | null,
  aal: {
    data: {
      currentLevel: 'aal1' as string | null,
      nextLevel: 'aal1' as string | null,
      currentAuthenticationMethods: [] as string[],
    },
    error: null as { message: string } | null,
  },
  aalThrows: false,
  resolver: null as null | ((query: Query) => QueryResult),
}));

const places = vi.hoisted(() => ({
  searchPlaces: vi.fn(),
  getPlaceDetails: vi.fn(),
  findRestaurantPlace: vi.fn(),
  allocateUniqueRestaurantSlug: vi.fn(async () => 'test-kitchen'),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (href: string) => {
    throw new Error(`REDIRECT:${href}`);
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/auth/require-user', () => ({
  requireUser: vi.fn(async () => harness.user),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: (...args: unknown[]) => {
          harness.aalArgs.push(args);
          if (harness.aalThrows) throw new Error('auth down');
          return Promise.resolve(harness.aal);
        },
      },
    },
  })),
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      let op: Query['op'] = 'select';
      let select: string | null = null;
      let eqId: string | null = null;
      const run = () => {
        const query: Query = { table, op, select, eqId };
        harness.calls.push(query);
        const resolve = harness.resolver ?? defaultResolver;
        return Promise.resolve(resolve(query));
      };
      const api = {
        select(columns?: string) {
          select = columns ?? null;
          return api;
        },
        insert() {
          op = 'insert';
          return api;
        },
        update() {
          op = 'update';
          return api;
        },
        delete() {
          op = 'delete';
          return api;
        },
        eq(_column: string, value: string) {
          eqId = String(value);
          return api;
        },
        gte() {
          return api;
        },
        order() {
          return api;
        },
        limit() {
          return api;
        },
        in() {
          return api;
        },
        maybeSingle: () => run(),
        single: () => run(),
        then(
          onFulfilled: (value: QueryResult) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          return run().then(onFulfilled, onRejected);
        },
      };
      return api;
    },
  }),
}));

vi.mock('@/lib/google-places-import', () => ({
  searchPlaces: places.searchPlaces,
  getPlaceDetails: places.getPlaceDetails,
}));

vi.mock('@/lib/google-places', () => ({
  findRestaurantPlace: places.findRestaurantPlace,
}));

vi.mock('@/lib/restaurant-slug', () => ({
  allocateUniqueRestaurantSlug: places.allocateUniqueRestaurantSlug,
}));

function defaultResolver(query: Query): QueryResult {
  if (query.table === 'user_profiles' && query.select === 'role') {
    if (harness.roleError) return { data: null, error: harness.roleError };
    const role = harness.roles[query.eqId ?? ''] ?? 'member';
    return { data: { role }, error: null };
  }
  throw new Error(`unexpected admin query ${query.op} ${query.table} ${query.select ?? ''}`);
}

const RESTAURANT_ID = '50000000-0000-4000-8000-000000000001';
const ENROLL_ERROR = 'Authenticator setup is required before admin access.';
const CHALLENGE_ERROR = 'Authenticator verification is required before admin access.';
const AUTH_ERROR = 'Failed to check authenticator assurance.';

function setAal(currentLevel: string | null, nextLevel: string | null) {
  harness.aal = {
    data: { currentLevel, nextLevel, currentAuthenticationMethods: ['password'] },
    error: null,
  };
}

function expectRoleLookupOnly() {
  expect(harness.calls.every((query) => query.table === 'user_profiles' && query.select === 'role')).toBe(
    true,
  );
  expect(places.searchPlaces).not.toHaveBeenCalled();
  expect(places.getPlaceDetails).not.toHaveBeenCalled();
  expect(places.findRestaurantPlace).not.toHaveBeenCalled();
  expect(harness.aalArgs.every((args) => args.length === 0)).toBe(true);
}

type El = {
  type?: unknown;
  props?: {
    children?: El | El[] | string | null;
    users?: { email: string }[];
    auditEntries?: unknown[];
    mode?: string;
  };
};

function findElement(node: unknown, type: unknown): El | null {
  if (!node || typeof node !== 'object') return null;
  const element = node as El;
  if (element.type === type) return element;
  const children = element.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findElement(child, type);
      if (found) return found;
    }
  } else if (children && typeof children === 'object') {
    return findElement(children, type);
  }
  return null;
}

const placeDetails = {
  name: 'Cafe',
  address: '1 Main',
  neighborhood: null,
  lat: 33.2,
  lon: -96.6,
  phoneNumber: null,
  website: null,
  priceLevel: null,
  cuisineTags: ['cafe'],
  googlePlaceId: 'place-1',
  rating: null,
};

describe('admin AAL guard', () => {
  beforeEach(() => {
    harness.calls = [];
    harness.aalArgs = [];
    harness.user = { ok: true, userId: 'user-a', email: 'a@example.com' };
    harness.roles = { 'user-a': 'admin', 'user-b': 'admin' };
    harness.roleError = null;
    harness.aalThrows = false;
    harness.resolver = null;
    setAal('aal1', 'aal1');
    places.searchPlaces.mockReset();
    places.getPlaceDetails.mockReset();
    places.findRestaurantPlace.mockReset();
    places.allocateUniqueRestaurantSlug.mockReset();
    places.allocateUniqueRestaurantSlug.mockResolvedValue('test-kitchen');
    places.searchPlaces.mockResolvedValue([
      { placeId: 'place-1', name: 'Cafe', address: '1 Main' },
    ]);
    places.getPlaceDetails.mockResolvedValue(placeDetails);
    places.findRestaurantPlace.mockResolvedValue({ placeId: 'place-1', hasPhoto: false });
  });

  const actions: { name: string; call: () => Promise<unknown>; denied: (result: unknown) => void }[] = [
    {
      name: 'addRestaurant',
      call: () => {
        const form = new FormData();
        form.set('name', 'Test Kitchen');
        return addRestaurant(form);
      },
      denied: (result) => expect(result).toMatchObject({ ok: false }),
    },
    {
      name: 'generateMissingSlugs',
      call: () => generateMissingSlugs(),
      denied: (result) => expect(result).toMatchObject({ ok: false, updated: 0 }),
    },
    {
      name: 'deleteRestaurant',
      call: () => deleteRestaurant(RESTAURANT_ID),
      denied: (result) => expect(result).toMatchObject({ ok: false }),
    },
    {
      name: 'setRestaurantPin',
      call: () => setRestaurantPin(RESTAURANT_ID, '1234'),
      denied: (result) =>
        expect(result).toEqual({
          ok: false,
          error: 'Unable to update the partner PIN right now.',
        }),
    },
    {
      name: 'attachGoogleMetadataToLatestRestaurantByName',
      call: () => attachGoogleMetadataToLatestRestaurantByName('Test Kitchen', 'place-1'),
      denied: (result) => expect(result).toMatchObject({ ok: false }),
    },
    {
      name: 'searchRestaurantsFromGoogle',
      call: () => searchRestaurantsFromGoogle('Cafe'),
      denied: (result) => expect(result).toMatchObject({ ok: false }),
    },
    {
      name: 'getRestaurantDetailsFromGoogle',
      call: () => getRestaurantDetailsFromGoogle('place-1'),
      denied: (result) => expect(result).toBeNull(),
    },
    {
      name: 'enrichSingleRestaurant',
      call: () => enrichSingleRestaurant(RESTAURANT_ID),
      denied: (result) => expect(result).toMatchObject({ ok: false }),
    },
    {
      name: 'enrichAllRestaurants',
      call: () => enrichAllRestaurants(),
      denied: (result) => expect(result).toMatchObject({ ok: false, updated: 0, failed: 0 }),
    },
  ];

  it.each(actions)('rejects a direct AAL1 enroll call to $name', async (action) => {
    setAal('aal1', 'aal1');
    const result = await action.call();
    action.denied(result);
    if (
      action.name !== 'setRestaurantPin' &&
      result &&
      typeof result === 'object' &&
      'error' in result
    ) {
      expect(result.error).toBe(ENROLL_ERROR);
    }
    expectRoleLookupOnly();
  });

  it.each(actions)(
    'rejects a direct call to $name when a factor is enrolled but this session is still AAL1',
    async (action) => {
      setAal('aal1', 'aal2');
      const result = await action.call();
      action.denied(result);
      if (
        action.name !== 'setRestaurantPin' &&
        result &&
        typeof result === 'object' &&
        'error' in result
      ) {
        expect(result.error).toBe(CHALLENGE_ERROR);
      }
      expectRoleLookupOnly();
    },
  );

  it.each(actions)('fails closed when assurance lookup errors for $name', async (action) => {
    harness.aal = {
      data: { currentLevel: null, nextLevel: null, currentAuthenticationMethods: [] },
      error: { message: 'network' },
    };
    const result = await action.call();
    action.denied(result);
    if (
      action.name !== 'setRestaurantPin' &&
      result &&
      typeof result === 'object' &&
      'error' in result
    ) {
      expect(result.error).toBe(AUTH_ERROR);
    }
    expectRoleLookupOnly();
  });

  it('lets AAL2 admin calls succeed and re-checks a switched account', async () => {
    setAal('aal2', 'aal2');
    harness.resolver = (query) => {
      if (query.table === 'user_profiles' && query.select === 'role') return defaultResolver(query);
      if (query.table === 'markets') return { data: [{ id: 'market-1' }], error: null };
      if (query.table === 'restaurant_orgs') return { data: { id: 'org-1' }, error: null };
      if (query.table === 'restaurants' && query.op === 'select' && query.select === 'id, name, slug') {
        return { data: [], error: null };
      }
      if (query.table === 'restaurants' && query.op === 'select' && query.select === 'id, name, address') {
        return { data: [], error: null };
      }
      if (query.table === 'restaurants' && query.op === 'select') {
        return {
          data: {
            id: RESTAURANT_ID,
            org_id: 'org-1',
            name: 'Test Kitchen',
            slug: 'test-kitchen',
            address: '1 Main',
          },
          error: null,
        };
      }
      if (query.table === 'restaurants') return { data: { id: RESTAURANT_ID }, error: null };
      if (query.table === 'restaurant_offers') return { data: null, error: null };
      if (query.table === 'admin_audit_log') return { data: null, error: null };
      throw new Error(`unexpected ${query.op} ${query.table} ${query.select ?? ''}`);
    };

    const form = new FormData();
    form.set('name', 'Test Kitchen');
    await expect(addRestaurant(form)).resolves.toEqual({
      ok: true,
      partnerUrl: '/partner/test-kitchen',
    });
    await expect(generateMissingSlugs()).resolves.toEqual({ ok: true, updated: 0 });
    harness.resolver = (query) => {
      if (query.table === 'user_profiles') return defaultResolver(query);
      if (query.table === 'restaurants' && query.op === 'select' && query.select === 'id') {
        return { data: [{ id: 'other-restaurant' }], error: null };
      }
      if (query.table === 'restaurants' && query.op === 'select') {
        return { data: { id: RESTAURANT_ID, org_id: 'org-1' }, error: null };
      }
      if (query.table === 'restaurants' && query.op === 'delete') return { data: null, error: null };
      if (query.table === 'restaurant_offers') return { data: null, error: null };
      if (query.table === 'admin_audit_log') return { data: null, error: null };
      throw new Error(`unexpected ${query.op} ${query.table}`);
    };
    await expect(deleteRestaurant(RESTAURANT_ID)).resolves.toEqual({ ok: true });
    harness.resolver = (query) => {
      if (query.table === 'user_profiles') return defaultResolver(query);
      if (query.table === 'restaurants') return { data: { id: RESTAURANT_ID }, error: null };
      if (query.table === 'admin_audit_log') return { data: null, error: null };
      throw new Error(`unexpected ${query.op} ${query.table}`);
    };
    await expect(setRestaurantPin(RESTAURANT_ID, '1234')).resolves.toEqual({ ok: true });
    harness.resolver = (query) => {
      if (query.table === 'user_profiles') return defaultResolver(query);
      if (query.table === 'restaurants' && query.select === 'name, slug') {
        return { data: { name: 'Test Kitchen', slug: 'test-kitchen' }, error: null };
      }
      if (query.table === 'restaurants' && query.op === 'select') {
        return { data: { id: RESTAURANT_ID }, error: null };
      }
      if (query.table === 'restaurants') return { data: null, error: null };
      if (query.table === 'admin_audit_log') return { data: null, error: null };
      throw new Error(`unexpected ${query.op} ${query.table} ${query.select ?? ''}`);
    };
    await expect(
      attachGoogleMetadataToLatestRestaurantByName('Test Kitchen', 'place-1'),
    ).resolves.toEqual({ ok: true });
    await expect(searchRestaurantsFromGoogle('Cafe')).resolves.toEqual({
      ok: true,
      results: [{ placeId: 'place-1', name: 'Cafe', address: '1 Main' }],
    });
    await expect(getRestaurantDetailsFromGoogle('place-1')).resolves.toEqual(placeDetails);
    harness.resolver = (query) => {
      if (query.table === 'user_profiles') return defaultResolver(query);
      if (query.table === 'restaurants' && query.op === 'select') {
        return { data: { id: RESTAURANT_ID, name: 'Test Kitchen', address: '1 Main' }, error: null };
      }
      if (query.table === 'restaurants') return { data: null, error: null };
      if (query.table === 'admin_audit_log') return { data: null, error: null };
      throw new Error(`unexpected ${query.op} ${query.table}`);
    };
    await expect(enrichSingleRestaurant(RESTAURANT_ID)).resolves.toEqual({ ok: true });
    harness.resolver = (query) => {
      if (query.table === 'user_profiles') return defaultResolver(query);
      if (query.table === 'restaurants') return { data: [], error: null };
      if (query.table === 'admin_audit_log') return { data: null, error: null };
      throw new Error(`unexpected ${query.op} ${query.table}`);
    };
    await expect(enrichAllRestaurants()).resolves.toEqual({ ok: true, updated: 0, failed: 0 });

    places.searchPlaces.mockClear();
    harness.user = { ok: true, userId: 'user-b', email: 'b@example.com' };
    setAal('aal1', 'aal2');
    const switched = await searchRestaurantsFromGoogle('Cafe');
    expect(switched).toEqual({ ok: false, error: CHALLENGE_ERROR });
    expect(places.searchPlaces).not.toHaveBeenCalled();

    const first = await assertAdmin();
    expect(first).toMatchObject({ ok: false, code: 'mfa_challenge' });
    harness.user = { ok: true, userId: 'user-a', email: 'a@example.com' };
    setAal('aal2', 'aal2');
    const second = await assertAdmin();
    expect(second).toMatchObject({ ok: true, userId: 'user-a' });
    expect(harness.aalArgs.every((args) => args.length === 0)).toBe(true);
  });

  it('does not load user emails or audit entries at AAL1', async () => {
    setAal('aal1', 'aal1');
    const page = (await AdminPage()) as El;
    expect(findElement(page, AdminMfaGate)?.props?.mode).toBe('enroll');
    expect(findElement(page, AdminClient)).toBeNull();
    expectRoleLookupOnly();

    harness.calls = [];
    setAal('aal1', 'aal2');
    const challengePage = (await AdminPage()) as El;
    expect(findElement(challengePage, AdminMfaGate)?.props?.mode).toBe('challenge');
    expect(findElement(challengePage, AdminClient)).toBeNull();
    expect(harness.calls.some((query) => query.select?.includes('email'))).toBe(false);
    expect(harness.calls.some((query) => query.table === 'admin_audit_log')).toBe(false);
  });

  it('loads the dashboard only after AAL2 and redirects Auth failures', async () => {
    setAal('aal2', 'aal2');
    harness.resolver = (query) => {
      if (query.table === 'user_profiles' && query.select === 'role') return defaultResolver(query);
      if (query.table === 'user_profiles') {
        return {
          data: [
            {
              id: 'user-a',
              email: 'admin@example.com',
              full_name: 'Ada',
              username: 'ada',
              subscription_status: 'active',
            },
          ],
          error: null,
        };
      }
      if (query.table === 'restaurants') return { data: [], error: null };
      if (query.table === 'admin_audit_log') return { data: [], error: null };
      throw new Error(`unexpected ${query.op} ${query.table}`);
    };
    const page = (await AdminPage()) as El;
    expect(findElement(page, AdminClient)?.props?.users?.[0]?.email).toBe('admin@example.com');
    expect(harness.calls.some((query) => query.table === 'admin_audit_log')).toBe(true);

    harness.calls = [];
    harness.aal = {
      data: { currentLevel: null, nextLevel: null, currentAuthenticationMethods: [] },
      error: { message: 'auth down' },
    };
    await expect(AdminPage()).rejects.toThrow('REDIRECT:/challenges');
    expect(harness.calls.some((query) => query.select?.includes('email'))).toBe(false);
    expect(harness.calls.some((query) => query.table === 'admin_audit_log')).toBe(false);

    harness.aalThrows = true;
    await expect(AdminPage()).rejects.toThrow('REDIRECT:/challenges');

    harness.aalThrows = false;
    harness.user = { ok: false, error: 'You must be signed in.' };
    harness.calls = [];
    await expect(AdminPage()).rejects.toThrow('REDIRECT:/signin?redirectTo=/admin');
    expect(harness.calls).toEqual([]);
  });
});
