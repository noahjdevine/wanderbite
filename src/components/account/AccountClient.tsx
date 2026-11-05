'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
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
import { LegalAttestationForm } from '@/components/legal/legal-attestation-form';
import { LEGAL_DOCUMENT_VERSION } from '@/lib/legal-attestation';

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
    hasCurrentAttestation: boolean;
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
  const [reminderLive, setReminderLive] = useState<'status' | 'alert'>(
    initial.adventureRemindersUnavailable ? 'alert' : 'status',
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
    <div className="wb-account-stack">
      <section className="wb-account-card">
        <h2>Profile</h2>
        <p className="wb-account-copy">
          Username and address for a smoother experience.
        </p>
        <div className="wb-account-block">
          <ProfileForm
            initialValues={initial.profile}
            onSubmit={saveProfile}
            submitLabel="Save changes"
            currentUserId={initial.userId}
            tone="account"
          />
        </div>
      </section>

      <section className="wb-account-card">
        <h2>Preferences</h2>
        <p className="wb-account-copy">
          Tell us what you’re into. We’ll curate around it.
        </p>
        <div className="wb-account-block">
          <PreferencesForm
            initialValues={initial.preferences}
            onSubmit={savePreferences}
            submitLabel="Save changes"
            tone="account"
          />
        </div>
      </section>

      <section className="wb-account-card">
        <h2>Age and terms</h2>
        <p className="wb-account-copy">
          Purchase asks for this confirmation. You can keep using Wanderbite either way.
        </p>
        <div className="wb-account-block">
          {initial.hasCurrentAttestation ? (
            <p className="wb-account-status" role="status">
              You confirmed you are 21 or older and agreed to terms version {LEGAL_DOCUMENT_VERSION}.
            </p>
          ) : (
            <LegalAttestationForm renderedForUserId={initial.userId} tone="account" />
          )}
        </div>
      </section>

      <section className="wb-account-card">
        <h2>Subscription</h2>
        <p className="wb-account-copy">
          {isActive
            ? `Status: Active${billingLabel ? ` · Renews ${billingLabel}` : ''}`
            : 'Status: No active subscription'}
        </p>
        <div className="wb-account-block">
          <ManageSubscriptionButton />
        </div>
      </section>

      <section className="wb-account-card">
        <h2>Account</h2>
        <div className="wb-account-block wb-account-meta-list">
          <div className="wb-account-meta">
            <span>Email</span>
            <span>{initial.email ?? '—'}</span>
          </div>
          <p className="wb-account-fine">
            To change your email, <Link href="/contact">contact us</Link>.
          </p>
          <label className="wb-account-reminder">
            <input
              type="checkbox"
              checked={!remindersOptedOut}
              disabled={initial.adventureRemindersUnavailable || reminderSaving}
              aria-describedby={reminderMessage ? 'account-reminder-message' : undefined}
              onChange={(event) => {
                const optedOut = !event.target.checked;
                setReminderSaving(true);
                setReminderMessage(null);
                void updateAdventureReminderOptOut(optedOut, initial.userId)
                  .then((res) => {
                    if (!res.ok) {
                      setReminderLive('alert');
                      setReminderMessage(res.error);
                      return;
                    }
                    setRemindersOptedOut(optedOut);
                    setReminderLive('status');
                    setReminderMessage(
                      optedOut
                        ? 'Adventure reminders are off.'
                        : 'Adventure reminders are on.',
                    );
                  })
                  .catch(() => {
                    setReminderLive('alert');
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
            <p
              id="account-reminder-message"
              className={reminderLive === 'alert' ? 'wb-account-error' : 'wb-account-status'}
              role={reminderLive}
            >
              {reminderMessage}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

