import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { format } from 'date-fns';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileForm } from '@/components/forms/ProfileForm';
import { LEGAL_DOCUMENT_VERSION } from '@/lib/legal-attestation';
import { ATTESTATION_CONFIRM_MESSAGE } from '@/lib/legal-attestation';

const getUser = vi.hoisted(() => vi.fn());
const attestation = vi.hoisted(() => vi.fn());
const tables = vi.hoisted(() => ({
  current: {} as Record<string, { data: unknown; error: { message: string } | null }>,
}));
const updatePreferences = vi.hoisted(() => vi.fn());
const updateProfileStructured = vi.hoisted(() => vi.fn());
const updateAdventureReminderOptOut = vi.hoisted(() => vi.fn());
const recordLegalAttestation = vi.hoisted(() => vi.fn());
const checkUsername = vi.hoisted(() => vi.fn());
const createBillingPortalSession = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
);

vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirect(url),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser },
  }),
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () =>
          Promise.resolve(tables.current[table] ?? { data: null, error: null }),
      };
      return chain;
    },
  }),
}));

vi.mock('@/lib/legal-attestation-status', () => ({
  hasCurrentLegalAttestation: (...args: unknown[]) => attestation(...args),
}));

vi.mock('@/components/auth/account-changed-notice', () => ({
  useAccountChanged: () => 'ready',
  AccountChangedNotice: () => null,
}));

vi.mock('@/app/actions/check-username', () => ({
  checkUsername: (...args: unknown[]) => checkUsername(...args),
}));

vi.mock('@/app/actions/update-preferences', () => ({
  updatePreferences: (...args: unknown[]) => updatePreferences(...args),
}));

vi.mock('@/app/actions/update-profile-structured', () => ({
  updateProfileStructured: (...args: unknown[]) => updateProfileStructured(...args),
}));

vi.mock('@/app/actions/update-email-preferences', () => ({
  updateAdventureReminderOptOut: (...args: unknown[]) => updateAdventureReminderOptOut(...args),
}));

vi.mock('@/app/actions/legal-attestation', () => ({
  recordLegalAttestation: (...args: unknown[]) => recordLegalAttestation(...args),
}));

vi.mock('@/app/actions/stripe', () => ({
  createBillingPortalSession: (...args: unknown[]) => createBillingPortalSession(...args),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { AccountClient } from '@/components/account/AccountClient';
import { AccountShell } from '@/components/account/account-shell';
import AccountPage from './page';

const PERIOD_END = '2026-06-15T18:00:00.000Z';
const USER_ID = 'user-1';

const profileValues = {
  username: 'member',
  address: { street: '123 Main St', city: 'McKinney', state: 'TX', zip: '75071' },
};

const preferenceValues = {
  dietary_flags: [] as string[],
  excluded_cuisines: [] as [],
  distance_band: '15_mi',
  wants_cocktail_experience: false,
};

function clientInitial(overrides?: {
  subscriptionStatus?: string | null;
  currentPeriodEnd?: string | null;
  hasCurrentAttestation?: boolean;
  adventureRemindersOptedOut?: boolean;
  adventureRemindersUnavailable?: boolean;
  email?: string | null;
}) {
  return {
    userId: USER_ID,
    email: overrides && 'email' in overrides ? overrides.email! : 'member@example.com',
    fullName: 'Member Example',
    subscriptionStatus: overrides?.subscriptionStatus ?? 'active',
    currentPeriodEnd:
      overrides && 'currentPeriodEnd' in overrides ? overrides.currentPeriodEnd! : PERIOD_END,
    preferences: preferenceValues,
    profile: profileValues,
    adventureRemindersOptedOut: overrides?.adventureRemindersOptedOut ?? false,
    adventureRemindersUnavailable: overrides?.adventureRemindersUnavailable ?? false,
    hasCurrentAttestation: overrides?.hasCurrentAttestation ?? false,
  };
}

function activeProfile(overrides?: Record<string, unknown>) {
  return {
    id: USER_ID,
    email: 'member@example.com',
    role: 'member',
    full_name: 'Member Example',
    username: 'member',
    dietary_flags: [],
    distance_band: '15_mi',
    wants_cocktail_experience: false,
    address: null,
    address_street: '123 Main St',
    address_city: 'McKinney',
    address_state: 'TX',
    address_zip: '75071',
    subscription_status: 'active',
    current_period_end: PERIOD_END,
    ...overrides,
  };
}

afterEach(() => cleanup());

beforeEach(() => {
  getUser.mockReset();
  attestation.mockReset();
  redirect.mockClear();
  updatePreferences.mockReset();
  updateProfileStructured.mockReset();
  updateAdventureReminderOptOut.mockReset();
  recordLegalAttestation.mockReset();
  checkUsername.mockReset();
  createBillingPortalSession.mockReset();
  tables.current = {};
  checkUsername.mockResolvedValue({ ok: true, status: 'unchanged' });
  updatePreferences.mockResolvedValue({ ok: true });
  updateProfileStructured.mockResolvedValue({ ok: true });
  updateAdventureReminderOptOut.mockResolvedValue({ ok: true });
  recordLegalAttestation.mockResolvedValue({ ok: true });
  createBillingPortalSession.mockResolvedValue({ ok: false, error: 'No billing account found. Subscribe first to manage your plan.' });
  attestation.mockResolvedValue(false);
});

function linear(channel: number) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(rgb: readonly [number, number, number]) {
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
}

function contrast(foreground: readonly [number, number, number], background: readonly [number, number, number]) {
  const hi = Math.max(luminance(foreground), luminance(background));
  const lo = Math.min(luminance(foreground), luminance(background));
  return (hi + 0.05) / (lo + 0.05);
}

describe('account page shell', () => {
  it('sends a signed-out visitor to the existing sign-in redirect', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(AccountPage()).rejects.toThrow('REDIRECT:/signin?redirectTo=/account');
  });

  it('keeps the nextMemberRedirect hops for an unfinished or missing profile', async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    tables.current = {
      user_profiles: {
        data: activeProfile({
          subscription_status: 'inactive',
          username: null,
          address_street: null,
          address_city: null,
          address_state: null,
          address_zip: null,
        }),
        error: null,
      },
    };
    await expect(AccountPage()).rejects.toThrow('REDIRECT:/onboarding');

    tables.current = { user_profiles: { data: null, error: null } };
    await expect(AccountPage()).rejects.toThrow('REDIRECT:/onboarding');
  });

  it('lets an active member stay, including with an unfinished profile', async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    tables.current = {
      user_profiles: {
        data: activeProfile({ username: null, address_street: '' }),
        error: null,
      },
    };
    attestation.mockResolvedValue(true);
    const view = render(await AccountPage());
    expect(view.container.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Your account' })).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('paints the load error in the same shell with the same sentence', async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    tables.current = {
      user_profiles: { data: null, error: { message: 'db down' } },
    };
    render(await AccountPage());
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Your account' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(
      'Unable to load your profile right now. Please try again.',
    );
    expect(document.querySelector('.wb-account-band')).toBeTruthy();
    expect(document.querySelector('.wb-account-sheet')).toBeTruthy();
  });

  it('keeps the header offset and does not hide account content', () => {
    const layout = readFileSync(path.join(process.cwd(), 'src/app/account/layout.tsx'), 'utf8');
    expect(layout).toContain('pt-14 xl:pt-0');
    expect(layout).toContain('<Navbar />');
    expect(layout).toContain('<Footer />');
    expect(layout).toContain('<MobileNav />');
    const css = readFileSync(path.join(process.cwd(), 'src/app/styles/wanderbite-theme.css'), 'utf8');
    const start = css.indexOf('/* ---------- Account page');
    const block = css.slice(start);
    expect(start).toBeGreaterThan(css.indexOf('.wb-partner'));
    const motionAt = css.indexOf('.wb-account,\n  .wb-account *');
    expect(motionAt).toBeGreaterThan(0);
    const accountMotion = css.slice(motionAt - 80, motionAt + 420);
    expect(accountMotion).toContain('prefers-reduced-motion: reduce');
    expect(accountMotion).toContain('animation: none');
    expect(accountMotion).toContain('transition: none');
    expect(block).not.toContain('opacity: 0;');
    expect(block).not.toContain('opacity:0');
    expect(block).not.toContain('wb-reveal');
    expect(block).not.toMatch(/\n\.wb-reading[\s,{]/);
    expect(block).not.toMatch(/\n\.wb-hiw-cta[\s,{]/);
    expect(block).not.toMatch(/\n\.wb-partner-/);
    const lastMotion = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    expect(lastMotion).toContain('.wb-nav-menu');
    expect(block).toMatch(
      /\.wb-account input\[type="checkbox"\] \{[^}]*accent-color:\s*var\(--wb-violet\)/,
    );
    const night: [number, number, number] = [0x12, 0x0a, 0x24];
    const cream: [number, number, number] = [0xfa, 0xf6, 0xef];
    const white: [number, number, number] = [255, 255, 255];
    expect(contrast([255, 255, 255], night)).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0xdd, 0xd6, 0xfe], night)).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0x1f, 0x15, 0x30], cream)).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0x6b, 0x62, 0x75], white)).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0xbe, 0x18, 0x5d], white)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(white, [0x7c, 0x3a, 0xed])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(white, [0xdb, 0x27, 0x77])).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0x7f, 0x1d, 0x1d], [0xfe, 0xe2, 0xe2])).toBeGreaterThanOrEqual(4.5);
  });
});

describe('AccountClient sections', () => {
  function renderClient(
    overrides?: Parameters<typeof clientInitial>[0],
  ) {
    return render(
      <AccountShell>
        <AccountClient initial={clientInitial(overrides)} />
      </AccountShell>,
    );
  }

  it('has one h1 and the same section headings', async () => {
    renderClient();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Your account' })).toBeTruthy();
    expect(screen.getByText('Manage your profile, preferences, and subscription.')).toBeTruthy();
    for (const name of ['Profile', 'Preferences', 'Age and terms', 'Subscription', 'Account']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy();
    }
    expect(screen.getByRole('heading', { level: 3, name: "Any cuisines you'd rather skip?" })).toBeTruthy();
    expect(screen.getByText(/Tell us what you.re into/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign Out' })).toBeNull();
  });

  it('keeps field names, autocomplete, and input mode', async () => {
    const { container } = renderClient();
    await screen.findByText('Looks good');
    const username = screen.getByLabelText('Username');
    expect(username.getAttribute('name')).toBeNull();
    expect(username.getAttribute('autocomplete')).toBe('username');
    expect(screen.getByLabelText('Street').getAttribute('autocomplete')).toBe('street-address');
    expect(screen.getByLabelText('City').getAttribute('autocomplete')).toBe('address-level2');
    expect(screen.getByLabelText('State').getAttribute('autocomplete')).toBe('address-level1');
    const zip = screen.getByLabelText('ZIP');
    expect(zip.getAttribute('autocomplete')).toBe('postal-code');
    expect(zip.getAttribute('inputmode')).toBe('numeric');
    expect(screen.getByLabelText('Distance preference').getAttribute('name')).toBeNull();
    const reminder = screen.getByRole('checkbox', { name: /Adventure reminders/ });
    expect(reminder.getAttribute('type')).toBe('checkbox');
    expect(reminder.className).not.toContain('accent-primary');
    expect(reminder.closest('.wb-account')).toBeTruthy();
    for (const field of container.querySelectorAll('input, select, textarea')) {
      expect(field.getAttribute('name')).toBeNull();
      expect(field.getAttribute('tabindex')).not.toBe('-1');
    }
  });

  it('keeps the age-and-terms links and the confirmed sentence', () => {
    const open = renderClient({ hasCurrentAttestation: false });
    expect(screen.getByRole('link', { name: 'Terms' }).getAttribute('href')).toBe('/terms');
    expect(screen.getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')).toBe('/privacy');
    expect(screen.getByRole('link', { name: 'Challenge rules' }).getAttribute('href')).toBe('/rules');
    open.unmount();

    renderClient({ hasCurrentAttestation: true });
    const confirmed = screen.getByText(
      `You confirmed you are 21 or older and agreed to terms version ${LEGAL_DOCUMENT_VERSION}.`,
    );
    expect(confirmed.getAttribute('role')).toBe('status');
    expect(screen.queryByRole('link', { name: 'Terms' })).toBeNull();
  });

  it('keeps subscription status, the renew date, and the billing button', async () => {
    const renew = format(new Date(PERIOD_END), 'MMMM d, yyyy');
    const active = renderClient();
    expect(screen.getByText(`Status: Active · Renews ${renew}`)).toBeTruthy();
    expect(renew).toBe('June 15, 2026');
    const button = screen.getByRole('button', { name: 'Manage Subscription' });
    expect(button.getAttribute('href')).toBeNull();
    fireEvent.click(button);
    await waitFor(() => expect(createBillingPortalSession).toHaveBeenCalledTimes(1));
    expect(createBillingPortalSession.mock.calls[0]).toEqual([]);
    active.unmount();

    renderClient({ currentPeriodEnd: null });
    expect(screen.getByText('Status: Active')).toBeTruthy();
    expect(screen.queryByText(/Renews/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Manage Subscription' })).toBeTruthy();
  });

  it('shows the inactive subscription with the same billing button', () => {
    renderClient({ subscriptionStatus: 'inactive', currentPeriodEnd: null });
    expect(screen.getByText('Status: No active subscription')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Manage Subscription' })).toBeTruthy();
  });

  it('saves the profile with the same payload and announces the result', async () => {
    renderClient({ hasCurrentAttestation: true });
    await screen.findByText('Looks good');
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Allen' } });
    const form = screen.getByLabelText('City').closest('form');
    expect(form).toBeTruthy();
    fireEvent.submit(form!);
    await waitFor(() => expect(updateProfileStructured).toHaveBeenCalledTimes(1));
    expect(updateProfileStructured).toHaveBeenCalledWith(
      {
        username: 'member',
        address: { street: '123 Main St', city: 'Allen', state: 'TX', zip: '75071' },
      },
      USER_ID,
    );
    const saved = await screen.findByText('Saved ✓');
    expect(saved.getAttribute('role')).toBe('status');

    updateProfileStructured.mockResolvedValueOnce({
      ok: false,
      error: 'That username is already taken.',
    });
    fireEvent.submit(form!);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('That username is already taken.');
    expect(form!.getAttribute('aria-describedby')).toBe('profile-save-error');
    expect(screen.getByLabelText('Username').getAttribute('aria-describedby')).toContain(
      'profile-save-error',
    );
  });

  it('ties the ZIP error to the field without changing the sentence', async () => {
    renderClient({ hasCurrentAttestation: true });
    const zip = screen.getByLabelText('ZIP');
    fireEvent.change(zip, { target: { value: '12' } });
    fireEvent.blur(zip);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('ZIP must be 5 digits or ZIP+4 (e.g. 78701 or 78701-1234).');
    expect(zip.getAttribute('aria-describedby')).toBe('profile-zip-error');
    expect(zip.getAttribute('aria-invalid')).toBe('true');
  });

  it('saves preferences with the same payload and announces errors', async () => {
    renderClient({ hasCurrentAttestation: true });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Vegetarian' }));
    const form = screen.getByRole('checkbox', { name: 'Vegetarian' }).closest('form');
    fireEvent.submit(form!);
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(1));
    expect(updatePreferences).toHaveBeenCalledWith(
      {
        dietary_flags: ['vegetarian'],
        excluded_cuisines: [],
        distance_band: '15_mi',
        wants_cocktail_experience: false,
      },
      USER_ID,
    );
    const saved = await screen.findByText('Saved ✓');
    expect(saved.getAttribute('role')).toBe('status');

    updatePreferences.mockResolvedValueOnce({
      ok: false,
      error: 'Unable to save preferences right now. Please try again.',
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Vegan' }));
    fireEvent.submit(form!);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Unable to save preferences right now. Please try again.');
    expect(form!.getAttribute('aria-describedby')).toBe('preferences-save-error');
  });

  it('saves the adventure reminder opt-out and announces both outcomes', async () => {
    renderClient({ hasCurrentAttestation: true });
    const box = screen.getByRole('checkbox', { name: /Adventure reminders/ });
    expect((box as HTMLInputElement).checked).toBe(true);
    fireEvent.click(box);
    await waitFor(() =>
      expect(updateAdventureReminderOptOut).toHaveBeenCalledWith(true, USER_ID),
    );
    const on = screen.getByText('Adventure reminders are off.');
    expect(on.getAttribute('role')).toBe('status');
    expect(box.getAttribute('aria-describedby')).toBe('account-reminder-message');

    updateAdventureReminderOptOut.mockResolvedValueOnce({
      ok: false,
      error: 'Unable to save email preferences right now. Please try again.',
    });
    fireEvent.click(box);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Unable to save email preferences right now. Please try again.');
    expect(alert.getAttribute('role')).toBe('alert');
  });

  it('submits age and terms once with the same payload', async () => {
    renderClient();
    const form = screen.getByRole('button', { name: 'Confirm age and terms' }).closest('form');
    fireEvent.submit(form!);
    const invalid = await screen.findByRole('alert');
    expect(invalid.textContent).toBe(ATTESTATION_CONFIRM_MESSAGE);
    expect(form!.getAttribute('aria-describedby')).toBe('legal-attestation-error');
    expect(recordLegalAttestation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('I confirm I am 21 or older.'));
    fireEvent.click(screen.getByLabelText(/I agree to the/));
    fireEvent.submit(form!);
    await waitFor(() => expect(recordLegalAttestation).toHaveBeenCalledTimes(1));
    expect(recordLegalAttestation).toHaveBeenCalledWith(
      { presentedVersion: LEGAL_DOCUMENT_VERSION, age21: true, agreeToTerms: true },
      USER_ID,
    );
    const confirmed = screen.getByText(
      `You confirmed you are 21 or older and agreed to terms version ${LEGAL_DOCUMENT_VERSION}.`,
    );
    expect(confirmed.getAttribute('role')).toBe('status');
  });

  it('leaves the default profile error unmarked by the account describedby id', async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error('That username is already taken.');
    });
    render(
      <ProfileForm
        initialValues={profileValues}
        onSubmit={onSubmit}
        submitLabel="Continue"
        currentUserId={USER_ID}
      />,
    );
    const form = screen.getByLabelText('Username').closest('form');
    fireEvent.submit(form!);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('That username is already taken.');
    expect(alert.getAttribute('id')).toBeNull();
    expect(form!.getAttribute('aria-describedby')).toBeNull();
    expect(screen.getByLabelText('Username').getAttribute('aria-describedby')).toBeNull();
    expect(document.body.innerHTML).not.toContain('wb-account');
  });
});
