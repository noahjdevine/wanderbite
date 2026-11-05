import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddressFields } from '@/components/forms/AddressFields';
import { LegalAttestationForm } from '@/components/legal/legal-attestation-form';
import { PreferencesForm } from '@/components/forms/PreferencesForm';
import { ProfileForm } from '@/components/forms/ProfileForm';
import { OnboardingWizard, type OnboardingInitial } from '@/components/onboarding/OnboardingWizard';
import { ATTESTATION_CONFIRM_MESSAGE, LEGAL_DOCUMENT_VERSION } from '@/lib/legal-attestation';

const push = vi.hoisted(() => vi.fn());
const updatePreferences = vi.hoisted(() => vi.fn());
const updateProfileStructured = vi.hoisted(() => vi.fn());
const checkUsername = vi.hoisted(() => vi.fn());
const recordLegalAttestation = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

vi.mock('@/components/auth/account-changed-notice', () => ({
  useAccountChanged: () => 'ready',
  AccountChangedNotice: () => null,
}));

vi.mock('@/app/actions/update-preferences', () => ({
  updatePreferences: (...args: unknown[]) => updatePreferences(...args),
}));

vi.mock('@/app/actions/update-profile-structured', () => ({
  updateProfileStructured: (...args: unknown[]) => updateProfileStructured(...args),
}));

vi.mock('@/app/actions/check-username', () => ({
  checkUsername: (...args: unknown[]) => checkUsername(...args),
}));

vi.mock('@/app/actions/legal-attestation', () => ({
  recordLegalAttestation: (...args: unknown[]) => recordLegalAttestation(...args),
}));

const USER_ID = 'user-1';

const prefs = {
  dietary_flags: [] as string[],
  excluded_cuisines: [],
  distance_band: '15_mi',
  wants_cocktail_experience: false,
};

const emptyProfile = {
  username: '',
  address: { street: '', city: '', state: '', zip: '' },
};

const mckinney = {
  username: 'member',
  address: { street: '123 Main St', city: 'McKinney', state: 'TX', zip: '75071' },
};

function initial(
  step: 1 | 2 | 3,
  overrides?: Partial<OnboardingInitial>,
): OnboardingInitial {
  return {
    step,
    userId: USER_ID,
    email: 'member@example.com',
    subscriptionStatus: null,
    hasCurrentAttestation: false,
    preferences: prefs,
    profile: mckinney,
    ...overrides,
  };
}

beforeEach(() => {
  push.mockReset();
  updatePreferences.mockReset();
  updateProfileStructured.mockReset();
  checkUsername.mockReset();
  recordLegalAttestation.mockReset();
  checkUsername.mockResolvedValue({ ok: true, status: 'unchanged' });
  updatePreferences.mockResolvedValue({ ok: true });
  updateProfileStructured.mockResolvedValue({ ok: true });
  recordLegalAttestation.mockResolvedValue({ ok: true });
});

afterEach(() => cleanup());

describe('onboarding Golden Hour shell', () => {
  it('keeps one h1, the step text, and the current step on every step', () => {
    const cases: { step: 1 | 2 | 3; heading: string; status?: string | null }[] = [
      { step: 1, heading: 'Tell us what you love' },
      { step: 2, heading: 'Make it personal' },
      { step: 3, heading: 'Your profile is saved' },
      { step: 3, heading: 'Your membership is active', status: 'active' },
    ];
    for (const item of cases) {
      const view = render(
        <OnboardingWizard
          initial={initial(item.step, { subscriptionStatus: item.status ?? null })}
        />,
      );
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 1, name: item.heading })).toBeTruthy();
      const count = screen.getByText(`Step ${item.step} of 3`);
      expect(count.getAttribute('aria-live')).toBe('polite');
      const current = view.container.querySelector('[aria-current="step"]');
      expect(current).toBeTruthy();
      expect(current?.textContent).toContain(String(item.step));
      view.unmount();
    }
  });

  it('keeps field autocomplete and leaves name unset', async () => {
    const step1 = render(<OnboardingWizard initial={initial(1)} />);
    expect(screen.getByLabelText('Distance preference').getAttribute('name')).toBeNull();
    expect(screen.getByRole('link', { name: 'Sign in →' }).getAttribute('href')).toBe('/signin');
    for (const field of step1.container.querySelectorAll('input, select, textarea')) {
      expect(field.getAttribute('name')).toBeNull();
      expect(field.getAttribute('tabindex')).not.toBe('-1');
    }
    step1.unmount();

    render(<OnboardingWizard initial={initial(2)} />);
    await screen.findByText('Looks good');
    expect(screen.getByLabelText('Username').getAttribute('autocomplete')).toBe('username');
    expect(screen.getByLabelText('Street').getAttribute('autocomplete')).toBe('street-address');
    expect(screen.getByLabelText('City').getAttribute('autocomplete')).toBe('address-level2');
    expect(screen.getByLabelText('State').getAttribute('autocomplete')).toBe('address-level1');
    const zip = screen.getByLabelText('ZIP');
    expect(zip.getAttribute('autocomplete')).toBe('postal-code');
    expect(zip.getAttribute('inputmode')).toBe('numeric');
  });

  it('saves preferences once and then goes back to the same step', async () => {
    render(<OnboardingWizard initial={initial(1)} />);
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
    expect(screen.getByRole('heading', { level: 1, name: 'Make it personal' })).toBeTruthy();
    expect(screen.getByText('Step 2 of 3')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '← Back' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Tell us what you love' })).toBeTruthy();
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
    expect(updatePreferences).toHaveBeenCalledTimes(1);
  });

  it('announces a preference save error on the same action', async () => {
    updatePreferences.mockResolvedValueOnce({
      ok: false,
      error: 'Unable to save preferences right now. Please try again.',
    });
    render(<OnboardingWizard initial={initial(1)} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Vegan' }));
    const form = screen.getByRole('checkbox', { name: 'Vegan' }).closest('form');
    fireEvent.submit(form!);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Unable to save preferences right now. Please try again.');
    expect(form!.getAttribute('aria-describedby')).toBe('preferences-save-error');
    expect(screen.getByRole('heading', { level: 1, name: 'Tell us what you love' })).toBeTruthy();
  });

  it('saves the profile with the same payload and returns to it', async () => {
    render(<OnboardingWizard initial={initial(2)} />);
    await screen.findByText('Looks good');
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Allen' } });
    const form = screen.getByLabelText('City').closest('form');
    fireEvent.submit(form!);
    await waitFor(() => expect(updateProfileStructured).toHaveBeenCalledTimes(1));
    expect(updateProfileStructured).toHaveBeenCalledWith(
      {
        username: 'member',
        address: { street: '123 Main St', city: 'Allen', state: 'TX', zip: '75071' },
      },
      USER_ID,
    );
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1, name: 'Your profile is saved' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '← Back to profile' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Make it personal' })).toBeTruthy();
    expect(updateProfileStructured).toHaveBeenCalledTimes(1);
  });

  it('sends an already-active member to challenges after the profile save', async () => {
    render(<OnboardingWizard initial={initial(2, { subscriptionStatus: 'active' })} />);
    await screen.findByText('Looks good');
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Allen' } });
    fireEvent.submit(screen.getByLabelText('City').closest('form')!);
    await waitFor(() => expect(updateProfileStructured).toHaveBeenCalledTimes(1));
    expect(push).toHaveBeenCalledWith('/challenges');
    expect(screen.queryByText('Your profile is saved')).toBeNull();
  });

  it('ties the ZIP and username errors to the fields without changing the sentences', async () => {
    checkUsername.mockImplementation(async (name: string) => {
      if (name === 'ab') return { ok: true, status: 'too_short' as const };
      return { ok: true, status: 'unchanged' as const };
    });
    render(<OnboardingWizard initial={initial(2)} />);
    const zip = screen.getByLabelText('ZIP');
    fireEvent.change(zip, { target: { value: '12' } });
    fireEvent.blur(zip);
    const zipAlert = await screen.findByRole('alert');
    expect(zipAlert.textContent).toBe('ZIP must be 5 digits or ZIP+4 (e.g. 78701 or 78701-1234).');
    expect(zip.getAttribute('aria-describedby')).toBe('profile-zip-error');
    expect(zip.getAttribute('aria-invalid')).toBe('true');

    const username = screen.getByLabelText('Username');
    fireEvent.change(username, { target: { value: 'ab' } });
    fireEvent.blur(username);
    const nameAlert = await screen.findByText('Use at least 3 characters');
    expect(nameAlert.closest('[role="alert"]')).toBeTruthy();
    expect(username.getAttribute('aria-describedby')).toContain('profile-username-hint');
    expect(username.getAttribute('aria-invalid')).toBe('true');
  });

  it('keeps the paused plan, the $15 copy, and the same links with checkout unset', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src/components/onboarding/OnboardingWizard.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/createCheckoutSession/);
    expect(source).not.toContain('Checkout is unavailable.');
    expect(source).toContain('LaunchHoldNotice');

    const view = render(<OnboardingWizard initial={initial(3)} />);
    expect(screen.getAllByText(/Paid membership checkout is paused/).length).toBeGreaterThan(0);
    expect(screen.getByText('Launching soon')).toBeTruthy();
    expect(screen.getAllByText(/\$15/).length).toBeGreaterThan(0);
    expect(screen.getByText('/month')).toBeTruthy();
    for (const link of screen.getAllByRole('link', { name: 'Terms' })) {
      expect(link.getAttribute('href')).toBe('/terms');
    }
    for (const link of screen.getAllByRole('link', { name: 'Privacy' })) {
      expect(link.getAttribute('href')).toBe('/privacy');
    }
    for (const link of screen.getAllByRole('link', { name: 'Challenge rules' })) {
      expect(link.getAttribute('href')).toBe('/rules');
    }
    expect(screen.getByRole('link', { name: 'View pricing' }).getAttribute('href')).toBe('/pricing');
    expect(view.container.querySelector('a[href*="checkout"]')).toBeNull();
    expect(view.container.querySelector('button[disabled]')).toBeNull();
  });

  it('shows the area hold for an address outside the launch city', () => {
    render(
      <OnboardingWizard
        initial={initial(3, {
          profile: {
            username: 'member',
            address: { street: '1 Congress Ave', city: 'Austin', state: 'TX', zip: '78701' },
          },
        })}
      />,
    );
    expect(screen.getByText('Not available in your area yet')).toBeTruthy();
    expect(screen.queryByText('Launching soon')).toBeNull();
    expect(screen.getByText(/not available at this address yet/)).toBeTruthy();
  });

  it('submits age and terms once with the same payload', async () => {
    render(<OnboardingWizard initial={initial(3)} />);
    const button = screen.getByRole('button', { name: 'Confirm age and terms' });
    const form = button.closest('form');
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
  });

  it('keeps the confirmed attestation sentence when it is already saved', () => {
    render(<OnboardingWizard initial={initial(3, { hasCurrentAttestation: true })} />);
    const confirmed = screen.getByText(
      `You confirmed you are 21 or older and agreed to terms version ${LEGAL_DOCUMENT_VERSION}.`,
    );
    expect(confirmed.getAttribute('role')).toBe('status');
    expect(screen.queryByRole('button', { name: 'Confirm age and terms' })).toBeNull();
  });

  it('leaves the default form markup unmarked and matches account tone to onboarding tone', () => {
    const props = {
      initialValues: emptyProfile,
      onSubmit: () => undefined,
      submitLabel: 'Continue',
      currentUserId: USER_ID,
    };
    const plain = render(<ProfileForm {...props} />);
    expect(plain.container.innerHTML).not.toContain('wb-onboarding');
    expect(plain.container.innerHTML).not.toContain('profile-username-hint');
    plain.unmount();

    const account = render(<ProfileForm {...props} tone="account" />);
    const onboarding = render(<ProfileForm {...props} tone="onboarding" />);
    expect(onboarding.container.innerHTML).toBe(account.container.innerHTML);
    expect(onboarding.container.innerHTML).not.toContain('wb-onboarding');
    expect(onboarding.container.innerHTML).not.toContain('wb-account');
    expect(onboarding.container.querySelector('#profile-username')?.getAttribute('aria-describedby')).toBe(
      'profile-username-hint',
    );
    account.unmount();
    onboarding.unmount();

    const prefProps = {
      initialValues: prefs,
      onSubmit: () => undefined,
      submitLabel: 'Continue',
    };
    const prefAccount = render(<PreferencesForm {...prefProps} tone="account" />);
    const prefOnboarding = render(<PreferencesForm {...prefProps} tone="onboarding" />);
    const prefPlain = render(<PreferencesForm {...prefProps} />);
    expect(prefOnboarding.container.innerHTML).toBe(prefAccount.container.innerHTML);
    expect(prefOnboarding.container.innerHTML).toBe(prefPlain.container.innerHTML);
    prefAccount.unmount();
    prefOnboarding.unmount();
    prefPlain.unmount();

    const legalAccount = render(<LegalAttestationForm renderedForUserId={USER_ID} tone="account" />);
    const legalOnboarding = render(
      <LegalAttestationForm renderedForUserId={USER_ID} tone="onboarding" />,
    );
    const legalPlain = render(<LegalAttestationForm renderedForUserId={USER_ID} />);
    expect(legalOnboarding.container.innerHTML).toBe(legalAccount.container.innerHTML);
    expect(legalOnboarding.container.innerHTML).toBe(legalPlain.container.innerHTML);
    legalAccount.unmount();
    legalOnboarding.unmount();
    legalPlain.unmount();

    const address = render(
      <AddressFields value={emptyProfile.address} onChange={() => undefined} />,
    );
    expect(address.container.innerHTML).not.toContain('wb-onboarding');
    expect(address.container.innerHTML).not.toContain('aria-describedby');
  });
});

describe('onboarding frame css', () => {
  it('uses Golden Hour tokens, a reduced-motion stop, and no site chrome', () => {
    const layout = readFileSync(path.join(process.cwd(), 'src/app/onboarding/layout.tsx'), 'utf8');
    expect(layout).toContain('wb-onboarding');
    expect(layout).not.toContain('Navbar');
    expect(layout).not.toContain('Footer');
    expect(layout).not.toContain('MobileNav');
    expect(layout).toContain('href="/"');
    expect(layout).toContain('aria-label="Wanderbite home"');

    const css = readFileSync(path.join(process.cwd(), 'src/app/styles/wanderbite-theme.css'), 'utf8');
    const start = css.indexOf('/* ---------- Onboarding wizard');
    expect(start).toBeGreaterThan(css.indexOf('/* ---------- Account page'));
    const block = css.slice(start);
    expect(block).not.toContain('opacity: 0;');
    expect(block).not.toContain('opacity:0');
    expect(block).not.toContain('wb-reveal');
    expect(block).toContain('linear-gradient(135deg, var(--wb-violet) 0%, var(--wb-pink) 100%)');
    expect(block).not.toContain('var(--wb-cta-gradient)');
    const motionAt = css.indexOf('.wb-onboarding,\n  .wb-onboarding *');
    expect(motionAt).toBeGreaterThan(0);
    expect(motionAt).toBeLessThan(css.lastIndexOf('.wb-nav-menu'));
    const motion = css.slice(motionAt - 80, motionAt + 360);
    expect(motion).toContain('prefers-reduced-motion: reduce');
    expect(motion).toContain('animation: none');
    expect(motion).toContain('transition: none');

    const night: [number, number, number] = [0x12, 0x0a, 0x24];
    const cream: [number, number, number] = [0xfa, 0xf6, 0xef];
    const white: [number, number, number] = [255, 255, 255];
    expect(contrast(white, night)).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0xdd, 0xd6, 0xfe], night)).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0x1f, 0x15, 0x30], cream)).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0x6b, 0x62, 0x75], white)).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0xbe, 0x18, 0x5d], white)).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0x2a, 0x14, 0x42], cream)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(white, [0x7c, 0x3a, 0xed])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(white, [0xdb, 0x27, 0x77])).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0x7f, 0x1d, 0x1d], [0xfe, 0xe2, 0xe2])).toBeGreaterThanOrEqual(4.5);
    expect(contrast([0x14, 0x53, 0x2d], white)).toBeGreaterThanOrEqual(4.5);
  });
});

function linear(channel: number) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(rgb: readonly [number, number, number]) {
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
}

function contrast(
  foreground: readonly [number, number, number],
  background: readonly [number, number, number],
) {
  const hi = Math.max(luminance(foreground), luminance(background));
  const lo = Math.min(luminance(foreground), luminance(background));
  return (hi + 0.05) / (lo + 0.05);
}
