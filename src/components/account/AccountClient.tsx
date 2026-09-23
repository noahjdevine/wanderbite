'use client';

import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { PreferencesForm, type PreferencesValues } from '@/components/forms/PreferencesForm';
import { ProfileForm, type ProfileValues } from '@/components/forms/ProfileForm';
import { updatePreferences } from '@/app/actions/update-preferences';
import { updateAdventureReminderOptOut } from '@/app/actions/update-email-preferences';
import { updateProfileStructured } from '@/app/actions/update-profile-structured';
import { ManageSubscriptionButton } from '@/app/(site)/billing/manage-subscription-button';
import {
  AccountChangedNotice,
  useAccountChanged,
} from '@/components/auth/account-changed-notice';

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
    adventureRemindersOptedOut: boolean;
    adventureRemindersUnavailable: boolean;
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
  const accountState = useAccountChanged(initial.userId);
  const [remindersOptedOut, setRemindersOptedOut] = useState(initial.adventureRemindersOptedOut);
  const [reminderSaving, setReminderSaving] = useState(false);
  const [reminderMessage, setReminderMessage] = useState<string | null>(
    initial.adventureRemindersUnavailable
      ? 'Mail preferences are unavailable right now.'
      : null,
  );

  async function savePreferences(values: PreferencesValues) {
    const res = await updatePreferences(values, initial.userId);
    if (!res.ok) throw new Error(res.error);
  }

  async function saveProfile(values: ProfileValues) {
    const res = await updateProfileStructured(values, initial.userId);
    if (!res.ok) throw new Error(res.error);
  }

  if (accountState === 'pending') return null;
  if (accountState === 'changed') return <AccountChangedNotice />;

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
          <ManageSubscriptionButton />
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
          <label className="flex items-start gap-3 pt-2 text-sm">
            <input
              type="checkbox"
              className="mt-1 size-4 accent-primary"
              checked={!remindersOptedOut}
              disabled={initial.adventureRemindersUnavailable || reminderSaving}
              onChange={(event) => {
                const optedOut = !event.target.checked;
                setReminderSaving(true);
                setReminderMessage(null);
                void updateAdventureReminderOptOut(optedOut, initial.userId)
                  .then((res) => {
                    if (!res.ok) {
                      setReminderMessage(res.error);
                      return;
                    }
                    setRemindersOptedOut(optedOut);
                    setReminderMessage(
                      optedOut
                        ? 'Adventure reminders are off.'
                        : 'Adventure reminders are on.',
                    );
                  })
                  .catch(() => {
                    setReminderMessage('Unable to save email preferences right now. Please try again.');
                  })
                  .finally(() => setReminderSaving(false));
              }}
            />
            <span>
              <span className="font-medium text-foreground">Adventure reminders</span>
              <span className="mt-1 block text-muted-foreground">
                Email when monthly picks are still unredeemed. Subscription receipts and
                account security messages stay on.
              </span>
            </span>
          </label>
          {reminderMessage ? (
            <p className="text-xs text-muted-foreground">{reminderMessage}</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

