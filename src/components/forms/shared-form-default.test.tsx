import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddressFields } from '@/components/forms/AddressFields';
import { CuisineExclusionGrid } from '@/components/forms/CuisineExclusionGrid';
import { LegalAttestationForm } from '@/components/legal/legal-attestation-form';
import { PreferencesForm } from '@/components/forms/PreferencesForm';
import { ProfileForm } from '@/components/forms/ProfileForm';
import { OnboardingWizard, type OnboardingInitial } from '@/components/onboarding/OnboardingWizard';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/app/actions/check-username', () => ({
  checkUsername: vi.fn(async () => ({ ok: true, status: 'unchanged' as const })),
}));

vi.mock('@/app/actions/update-preferences', () => ({
  updatePreferences: vi.fn(),
}));

vi.mock('@/app/actions/update-profile-structured', () => ({
  updateProfileStructured: vi.fn(),
}));

vi.mock('@/app/actions/legal-attestation', () => ({
  recordLegalAttestation: vi.fn(),
}));

vi.mock('@/components/auth/account-changed-notice', () => ({
  useAccountChanged: () => 'ready',
  AccountChangedNotice: () => null,
}));

const prefs = {
  dietary_flags: [] as string[],
  excluded_cuisines: [],
  distance_band: '15_mi',
  wants_cocktail_experience: false,
};

const profile = {
  username: '',
  address: { street: '', city: '', state: '', zip: '' },
};

function onboarding(step: 1 | 2 | 3, subscriptionStatus: string | null): OnboardingInitial {
  return {
    step,
    userId: 'user-1',
    email: 'member@example.com',
    subscriptionStatus,
    hasCurrentAttestation: false,
    preferences: prefs,
    profile: {
      username: 'member',
      address: { street: '123 Main St', city: 'McKinney', state: 'TX', zip: '75071' },
    },
  };
}

afterEach(() => cleanup());

describe('shared form default output', () => {
  it('renders PreferencesForm without a tone the same way onboarding does', () => {
    const { container } = render(
      <PreferencesForm initialValues={prefs} onSubmit={() => undefined} submitLabel="Continue" />,
    );
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('renders ProfileForm without a tone the same way onboarding does', () => {
    const { container } = render(
      <ProfileForm
        initialValues={profile}
        onSubmit={() => undefined}
        submitLabel="Continue"
        currentUserId="user-1"
      />,
    );
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('renders AddressFields and CuisineExclusionGrid without extra props', () => {
    const address = render(
      <AddressFields
        value={profile.address}
        onChange={() => undefined}
      />,
    );
    expect(address.container.innerHTML).toMatchSnapshot();
    address.unmount();

    const cuisine = render(
      <CuisineExclusionGrid value={[]} onChange={() => undefined} />,
    );
    expect(cuisine.container.innerHTML).toMatchSnapshot();
  });

  it('renders LegalAttestationForm without a tone', () => {
    const { container } = render(<LegalAttestationForm renderedForUserId="user-1" />);
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('renders each onboarding step without account tone classes', () => {
    const steps = [
      onboarding(1, null),
      onboarding(2, null),
      onboarding(3, 'active'),
      onboarding(3, null),
    ];
    const html = steps.map((initial) => {
      const view = render(<OnboardingWizard initial={initial} />);
      const markup = view.container.innerHTML;
      view.unmount();
      return markup;
    });
    expect(html.join('\n<!-- step -->\n')).toMatchSnapshot();
    expect(html.join('\n')).not.toContain('wb-account');
    expect(html.join('\n')).toContain('wb-onboarding-band');
    expect(html.join('\n')).toContain('Step 1 of 3');
  });
});
