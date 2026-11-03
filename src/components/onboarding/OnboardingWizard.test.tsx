import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnboardingWizard, type OnboardingInitial } from '@/components/onboarding/OnboardingWizard';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/components/auth/account-changed-notice', () => ({
  useAccountChanged: () => 'ready',
  AccountChangedNotice: () => null,
}));

vi.mock('@/app/actions/update-preferences', () => ({
  updatePreferences: vi.fn(),
}));

vi.mock('@/app/actions/update-profile-structured', () => ({
  updateProfileStructured: vi.fn(),
}));

vi.mock('@/components/legal/legal-attestation-form', () => ({
  LegalAttestationForm: () => null,
}));

const PAUSED = 'Paid membership checkout is paused';

function initial(subscriptionStatus: string | null): OnboardingInitial {
  return {
    step: 3,
    userId: 'user-1',
    email: 'test@wanderbite.com',
    subscriptionStatus,
    hasCurrentAttestation: true,
    preferences: {
      dietary_flags: [],
      excluded_cuisines: [],
      distance_band: '15_mi',
      wants_cocktail_experience: false,
    },
    profile: {
      username: 'member',
      address: {
        street: '123 Main St',
        city: 'McKinney',
        state: 'TX',
        zip: '75071',
      },
    },
  };
}

describe('OnboardingWizard plan step', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
  });

  async function render(subscriptionStatus: string | null) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<OnboardingWizard initial={initial(subscriptionStatus)} />);
    });
    return container.textContent ?? '';
  }

  it('does not show the paused checkout card to an active member', async () => {
    const text = await render('active');
    expect(text).not.toContain(PAUSED);
    expect(text).toContain('Your membership is active');
  });

  it('still shows the paused checkout card for an inactive eligible address', async () => {
    const text = await render('inactive');
    expect(text).toContain(PAUSED);
  });
});