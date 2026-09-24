'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { recordLegalAttestation } from '@/app/actions/legal-attestation';
import { Button } from '@/components/ui/button';
import {
  ATTESTATION_CONFIRM_MESSAGE,
  LEGAL_DOCUMENT_VERSION,
} from '@/lib/legal-attestation';

export function LegalAttestationForm({
  renderedForUserId,
}: {
  renderedForUserId: string;
}) {
  const [age21, setAge21] = useState(false);
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!age21 || !agreeToTerms) {
      setError(ATTESTATION_CONFIRM_MESSAGE);
      return;
    }
    setSaving(true);
    try {
      const result = await recordLegalAttestation(
        {
          presentedVersion: LEGAL_DOCUMENT_VERSION,
          age21: true,
          agreeToTerms: true,
        },
        renderedForUserId,
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
    } catch {
      setError('Unable to save your confirmation right now. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        You confirmed you are 21 or older and agreed to terms version {LEGAL_DOCUMENT_VERSION}.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Terms and Privacy version {LEGAL_DOCUMENT_VERSION}. This confirmation is saved only when you
        submit it.
      </p>
      <div className="flex items-start gap-3">
        <input
          id={`age-21-${renderedForUserId}`}
          type="checkbox"
          checked={age21}
          onChange={(event) => setAge21(event.target.checked)}
          disabled={saving}
          className="mt-1 size-4 shrink-0 rounded border-input"
        />
        <label htmlFor={`age-21-${renderedForUserId}`} className="text-sm leading-snug">
          I confirm I am 21 or older.
        </label>
      </div>
      <div className="flex items-start gap-3">
        <input
          id={`terms-${renderedForUserId}`}
          type="checkbox"
          checked={agreeToTerms}
          onChange={(event) => setAgreeToTerms(event.target.checked)}
          disabled={saving}
          className="mt-1 size-4 shrink-0 rounded border-input"
        />
        <label htmlFor={`terms-${renderedForUserId}`} className="text-sm leading-snug text-muted-foreground">
          I agree to the{' '}
          <Link href="/terms" className="font-medium text-primary underline-offset-2 hover:underline">
            Terms
          </Link>
          ,{' '}
          <Link href="/privacy" className="font-medium text-primary underline-offset-2 hover:underline">
            Privacy Policy
          </Link>
          , and{' '}
          <Link href="/rules" className="font-medium text-primary underline-offset-2 hover:underline">
            Challenge rules
          </Link>
          .
        </label>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={saving}>
        {saving ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
            Saving…
          </>
        ) : (
          'Confirm age and terms'
        )}
      </Button>
    </form>
  );
}
