'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
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
import { updatePreferences } from '@/app/actions/update-preferences';
import { updateProfileStructured } from '@/app/actions/update-profile-structured';
import { CLUB_PLAN_FEATURES } from '@/lib/club-plan-content';

export type OnboardingInitial = {
  step: WizardStep;
  userId: string;
  email: string | null;
  subscriptionStatus: string | null;
  preferences: PreferencesValues;
  profile: ProfileValues;
};

export function OnboardingWizard({ initial }: { initial: OnboardingInitial }) {
  const [step, setStep] = useState<WizardStep>(initial.step);
  const [prefs, setPrefs] = useState<PreferencesValues>(initial.preferences);
  const [profile, setProfile] = useState<ProfileValues>(initial.profile);

  const completed = useMemo(
    () => ({
      1: step > 1,
      2: step > 2,
      3: false,
    }),
    [step]
  );

  async function savePrefs(values: PreferencesValues) {
    const res = await updatePreferences(values);
    if (!res.ok) throw new Error(res.error);
    setPrefs(values);
    setStep(2);
  }

  async function saveProfile(values: ProfileValues) {
    const res = await updateProfileStructured(values);
    if (!res.ok) throw new Error(res.error);
    setProfile(values);
    setStep(3);
  }

  return (
    <main className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto flex w-full max-w-xl flex-col items-center">
        <div className="w-full rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
          <ProgressIndicator currentStep={step} completed={completed} />

          <div className="mt-8">
            {step === 1 ? (
              <>
                <h1 className="text-2xl font-bold tracking-tight">Tell us what you love</h1>
                <p className="mt-2 text-muted-foreground">
                  We’ll use this to curate your monthly challenges.
                </p>
                <div className="mt-6">
                  <PreferencesForm
                    initialValues={prefs}
                    onSubmit={savePrefs}
                    submitLabel="Continue"
                  />
                </div>
                <p className="mt-6 text-center text-sm text-muted-foreground">
                  Already have an account?{' '}
                  <Link href="/signin" className="font-medium text-primary underline-offset-2 hover:underline">
                    Sign in →
                  </Link>
                </p>
              </>
            ) : null}

            {step === 2 ? (
              <>
                <h1 className="text-2xl font-bold tracking-tight">Make it personal</h1>
                <p className="mt-2 text-muted-foreground">
                  A username and a structured address help us personalize your experience.
                </p>
                <div className="mt-6">
                  <ProfileForm
                    initialValues={profile}
                    onSubmit={saveProfile}
                    submitLabel="Continue"
                    currentUserId={initial.userId}
                  />
                </div>
                <div className="mt-6 flex justify-between">
                  <button
                    type="button"
                    className="text-sm font-medium text-muted-foreground hover:text-foreground"
                    onClick={() => setStep(1)}
                  >
                    ← Back
                  </button>
                </div>
              </>
            ) : null}

            {step === 3 ? (
              <div className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
                <h1 className="text-2xl font-bold tracking-tight">Your profile is saved</h1>
                <p className="mt-2 text-muted-foreground">
                  Paid membership checkout is paused. We will not start Stripe from onboarding while
                  checkout is frozen.
                </p>

                <Card className="mt-6 border-2 border-primary/15 shadow-md">
                  <CardHeader className="space-y-1 pb-2 text-center">
                    <CardTitle className="text-xl sm:text-2xl">Wanderbite Club</CardTitle>
                    <CardDescription className="text-base">
                      One plan. Two adventures every month.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5 pt-2">
                    <div className="text-center">
                      <p className="text-3xl font-bold tracking-tight text-primary sm:text-4xl">
                        $15
                        <span className="text-base font-normal text-muted-foreground sm:text-lg">
                          /month
                        </span>
                      </p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Includes 2 curated adventures per month ($20+ value). Coming soon.
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

                    <div className="space-y-2 rounded-lg border border-border/50 bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
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
                  </CardContent>
                  <CardFooter className="flex flex-col gap-3 pt-2">
                    <LaunchHoldNotice />
                    <p className="text-center text-xs text-muted-foreground">
                      Prefer to browse first?{' '}
                      <Link href="/pricing" className="font-medium text-primary underline-offset-2 hover:underline">
                        View pricing
                      </Link>
                    </p>
                    <button
                      type="button"
                      className="w-full text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                      onClick={() => setStep(2)}
                    >
                      ← Back to profile
                    </button>
                  </CardFooter>
                </Card>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}

