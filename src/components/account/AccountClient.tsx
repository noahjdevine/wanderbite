'use client';

import { useMemo } from 'react';
import { format } from 'date-fns';
import { PreferencesForm, type PreferencesValues } from '@/components/forms/PreferencesForm';
import { ProfileForm, type ProfileValues } from '@/components/forms/ProfileForm';
import { updatePreferences } from '@/app/actions/update-preferences';
import { updateProfileStructured } from '@/app/actions/update-profile-structured';
import { ManageSubscriptionButton } from '@/app/(site)/billing/manage-subscription-button';

export function AccountClient({
  initial,
}: {
  initial: {
    userId: string;
    email: string | null;
    fullName: string | null;
    subscriptionStatus: string | null;
    currentPeriodEnd: string | null;
    preferences: PreferencesValues;
    profile: ProfileValues;
  };
}) {
  const billingLabel = useMemo(() => {
    if (!initial.currentPeriodEnd) return null;
    try {
      return format(new Date(initial.currentPeriodEnd), 'MMMM d, yyyy');
    } catch {
      return null;
    }
  }, [initial.currentPeriodEnd]);

  const isActive = initial.subscriptionStatus === 'active';

  async function savePreferences(values: PreferencesValues) {
    const res = await updatePreferences(values);
    if (!res.ok) throw new Error(res.error);
  }

  async function saveProfile(values: ProfileValues) {
    const res = await updateProfileStructured(values);
    if (!res.ok) throw new Error(res.error);
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold tracking-tight">Profile</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Username and address for a smoother experience.
        </p>
        <div className="mt-6">
          <ProfileForm
            initialValues={initial.profile}
            onSubmit={saveProfile}
            submitLabel="Save changes"
            currentUserId={initial.userId}
          />
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold tracking-tight">Preferences</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Tell us what you’re into. We’ll curate around it.
        </p>
        <div className="mt-6">
          <PreferencesForm
            initialValues={initial.preferences}
            onSubmit={savePreferences}
            submitLabel="Save changes"
          />
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold tracking-tight">Subscription</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {isActive
            ? `Status: Active${billingLabel ? ` · Renews ${billingLabel}` : ''}`
            : 'Status: No active subscription'}
        </p>
        <div className="mt-6">
          <ManageSubscriptionButton userId={initial.userId} />
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold tracking-tight">Account</h2>
        <div className="mt-4 space-y-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground">Email</span>
            <span className="font-medium text-foreground">{initial.email ?? '—'}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Email change can be added here once enabled in Supabase Auth settings.
          </p>
        </div>
      </section>
    </div>
  );
}

