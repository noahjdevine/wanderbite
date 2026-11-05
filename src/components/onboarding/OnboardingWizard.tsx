'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { ProgressIndicator, type WizardStep } from '@/components/onboarding/ProgressIndicator';
import { PreferencesForm, type PreferencesValues } from '@/components/forms/PreferencesForm';
import { ProfileForm, type ProfileValues } from '@/components/forms/ProfileForm';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { LaunchHoldNotice } from '@/components/launch-hold-notice';
import { AreaHoldNotice } from '@/components/area-hold-notice';
import { updatePreferences } from '@/app/actions/update-preferences';
import { updateProfileStructured } from '@/app/actions/update-profile-structured';
import {
  AccountChangedNotice,
  useAccountChanged,
} from '@/components/auth/account-changed-notice';
import { CLUB_PLAN_FEATURES } from '@/lib/club-plan-content';
import { launchAreaState } from '@/lib/launch-market';
import { LegalAttestationForm } from '@/components/legal/legal-attestation-form';
import { LEGAL_DOCUMENT_VERSION } from '@/lib/legal-attestation';

export type OnboardingInitial = {
  step: WizardStep;
  userId: string;
  email: string | null;
  subscriptionStatus: string | null;
  preferences: PreferencesValues;
  profile: ProfileValues;
  hasCurrentAttestation: boolean;
};

function stepCopy(
  step: WizardStep,
  subscriptionStatus: string | null,
  ineligible: boolean,
): { title: string; lede: string } {
  if (step === 1) {
    return {
      title: 'Tell us what you love',
      lede: 'We’ll use this to curate your monthly challenges.',
    };
  }
  if (step === 2) {
    return {
      title: 'Make it personal',
      lede: 'A username and a structured address help us personalize your experience.',
    };
  }
  if (subscriptionStatus === 'active') {
    return {
      title: 'Your membership is active',
      lede: 'Your profile is saved. Continue to your challenges.',
    };
  }
  return {
    title: 'Your profile is saved',
    lede: ineligible
      ? 'We saved your profile. Wanderbite is not available at this address yet.'
      : 'Paid membership checkout is paused. We will not start Stripe from onboarding while checkout is frozen.',
  };
}

export function OnboardingWizard({ initial }: { initial: OnboardingInitial }) {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>(initial.step);
  const [prefs, setPrefs] = useState<PreferencesValues>(initial.preferences);
  const [profile, setProfile] = useState<ProfileValues>(initial.profile);
  const [attested, setAttested] = useState(initial.hasCurrentAttestation);

  const completed = useMemo(
    () => ({
      1: step > 1,
      2: step > 2,
      3: false,
    }),
    [step]
  );

  const accountState = useAccountChanged(initial.userId);

  async function savePrefs(values: PreferencesValues) {
    const res = await updatePreferences(values, initial.userId);
    if (!res.ok) throw new Error(res.error);
    setPrefs(values);
    setStep(2);
  }

  async function saveProfile(values: ProfileValues) {
    const res = await updateProfileStructured(values, initial.userId);
    if (!res.ok) throw new Error(res.error);
    setProfile(values);
    if (initial.subscriptionStatus === 'active') {
      router.push('/challenges');
      return;
    }
    setStep(3);
  }

  const area = launchAreaState({
    street: profile.address.street,
    city: profile.address.city,
    state: profile.address.state,
    zip: profile.address.zip,
  });
  const ineligible = area === 'ineligible';

  if (accountState === 'pending') {
    return <main />;
  }

  if (accountState === 'changed') {
    return (
      <main className="wb-onboarding-sheet">
        <div className="wb-onboarding-body">
          <AccountChangedNotice />
        </div>
      </main>
    );
  }

  const copy = stepCopy(step, initial.subscriptionStatus, ineligible);

  return (
    <main>
      <header className="wb-onboarding-band">
        <div className="wb-onboarding-wrap">
          <p className="wb-onboarding-count" aria-live="polite">
            Step {step} of 3
          </p>
          <h1>{copy.title}</h1>
          <p className="wb-onboarding-lede">{copy.lede}</p>
          <ProgressIndicator currentStep={step} completed={completed} />
        </div>
      </header>
      <div className="wb-onboarding-sheet">
        <div className="wb-onboarding-body">
          <div key={step} className="wb-onboarding-card wb-onboarding-panel">
            {step === 1 ? (
              <>
                <PreferencesForm
                  initialValues={prefs}
                  onSubmit={savePrefs}
                  submitLabel="Continue"
                  tone="onboarding"
                />
                <p className="wb-onboarding-aside">
                  Already have an account?{' '}
                  <Link href="/signin" className="font-medium text-primary underline-offset-2 hover:underline">
                    Sign in →
                  </Link>
                </p>
              </>
            ) : null}

            {step === 2 ? (
              <>
                <ProfileForm
                  initialValues={profile}
                  onSubmit={saveProfile}
                  submitLabel="Continue"
                  currentUserId={initial.userId}
                  tone="onboarding"
                />
                <div className="wb-onboarding-back-row">
                  <button type="button" className="wb-onboarding-back" onClick={() => setStep(1)}>
                    ← Back
                  </button>
                </div>
              </>
            ) : null}

            {step === 3 && initial.subscriptionStatus === 'active' ? (
              <Link href="/challenges" className="wb-onboarding-primary">
                Continue to your challenges
              </Link>
            ) : step === 3 ? (
              <Card className="wb-onboarding-plan">
                <CardHeader className="space-y-1 pb-2 text-center">
                  <CardTitle className="text-xl sm:text-2xl">Wanderbite Club</CardTitle>
                  <CardDescription className="text-base">
                    One plan. Two adventures every month in McKinney, Texas.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5 pt-2">
                  <div className="text-center">
                    <p className="wb-onboarding-price">
                      $15
                      <span>/month</span>
                    </p>
                    <p className="wb-onboarding-note">
                      Includes 2 curated adventures per month. Coming soon.
                    </p>
                  </div>

                  <ul className="space-y-2.5">
                    {CLUB_PLAN_FEATURES.map((feature) => (
                      <li key={feature} className="flex items-start gap-3 text-sm">
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <Check className="size-3" aria-hidden />
                        </span>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="wb-onboarding-fine">
                    <p>
                      Plan (when checkout reopens): $15/month (billed monthly). Auto-renews until
                      canceled. Includes 2 challenges/month and 1 swap/month. Cancel anytime from
                      your account; cancellation takes effect at the end of the billing period.
                    </p>
                    <p>
                      By creating an account, you agree to our{' '}
                      <Link href="/terms" className="underline underline-offset-2 hover:text-foreground">
                        Terms
                      </Link>
                      ,{' '}
                      <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
                        Privacy
                      </Link>
                      , and{' '}
                      <Link href="/rules" className="underline underline-offset-2 hover:text-foreground">
                        Challenge rules
                      </Link>
                      .
                    </p>
                  </div>
                  <div className="wb-onboarding-attest">
                    {attested ? (
                      <p className="text-sm text-muted-foreground" role="status">
                        You confirmed you are 21 or older and agreed to terms version{' '}
                        {LEGAL_DOCUMENT_VERSION}.
                      </p>
                    ) : (
                      <LegalAttestationForm
                        renderedForUserId={initial.userId}
                        tone="onboarding"
                        onSaved={() => setAttested(true)}
                      />
                    )}
                  </div>
                </CardContent>
                <CardFooter className="flex flex-col gap-3 pt-2">
                  {attested ? (
                    <Link href="/challenges" className="wb-onboarding-primary">
                      Start exploring
                    </Link>
                  ) : null}
                  {ineligible ? <AreaHoldNotice /> : <LaunchHoldNotice />}
                  <p className="wb-onboarding-aside">
                    Prefer to browse first?{' '}
                    <Link href="/pricing" className="font-medium text-primary underline-offset-2 hover:underline">
                      View pricing
                    </Link>
                  </p>
                  <button
                    type="button"
                    className="wb-onboarding-back wb-onboarding-back-wide"
                    onClick={() => setStep(2)}
                  >
                    ← Back to profile
                  </button>
                </CardFooter>
              </Card>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
