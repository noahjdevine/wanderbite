import { hasStructuredAddress } from '@/lib/launch-market';

export type MemberProfileGate = {
  role: string | null;
  subscriptionStatus: string | null;
  hasProfile: boolean;
  profileComplete: boolean;
};

export type MemberAddress = {
  username: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
};

export function isAdminRole(role: string | null | undefined): boolean {
  return role === 'admin';
}

export function profileGate(row: ({
  role?: string | null;
  subscription_status?: string | null;
} & MemberAddress) | null): MemberProfileGate {
  if (!row) {
    return {
      role: null,
      subscriptionStatus: null,
      hasProfile: false,
      profileComplete: false,
    };
  }
  const profileComplete =
    Boolean(row.username?.trim()) &&
    hasStructuredAddress({
      street: row.address_street,
      city: row.address_city,
      state: row.address_state,
      zip: row.address_zip,
    });
  return {
    role: row.role ?? null,
    subscriptionStatus: row.subscription_status ?? null,
    hasProfile: true,
    profileComplete,
  };
}

/** Sign-in with no explicit redirectTo. Incomplete admins skip Challenges. */
export function ordinarySignInPath(profile: MemberProfileGate): string {
  if (!profile.hasProfile) return '/onboarding';
  if (isAdminRole(profile.role) && !profile.profileComplete) return '/account';
  if (profile.subscriptionStatus === 'active') return '/challenges';
  return '/pricing';
}

/** null means render the page. Admin is checked before the active-subscription hop. */
export function nextMemberRedirect(
  path: string,
  profile: MemberProfileGate,
): string | null {
  if (path === '/profile') return '/account';

  if (path === '/onboarding') {
    if (profile.hasProfile && isAdminRole(profile.role)) return '/account';
    if (profile.hasProfile && profile.subscriptionStatus === 'active') return '/challenges';
    return null;
  }

  if (path === '/account') {
    if (!profile.hasProfile) return '/onboarding';
    if (isAdminRole(profile.role)) return null;
    if (!profile.profileComplete) return '/onboarding';
    return null;
  }

  if (path === '/challenges') {
    if (!profile.hasProfile) return '/onboarding';
    if (profile.subscriptionStatus !== 'active') return '/pricing';
    if (!profile.profileComplete) return '/onboarding';
    return null;
  }

  return null;
}

/** Follow redirects until a page renders. Throws if a path repeats. */
export function settleMemberPath(start: string, profile: MemberProfileGate): string {
  const seen = new Set<string>();
  let path = start;
  for (let hop = 0; hop < 6; hop++) {
    if (seen.has(path)) {
      throw new Error(`redirect loop at ${path}`);
    }
    seen.add(path);
    const next = nextMemberRedirect(path, profile);
    if (!next) return path;
    path = next;
  }
  throw new Error(`redirect did not settle from ${start}`);
}
