'use client';

import { useState } from 'react';
import {
  getGoogleReviewHandoffForRedemption,
  saveJournalReflection,
  type JournalReflection,
} from '@/app/actions/journal-reflections';
import { Button } from '@/components/ui/button';
import {
  REFLECTION_LIMITS,
  RETURN_INTERESTS,
  validateReflectionFields,
  type ReflectionTextField,
  type ReturnInterest,
} from '@/lib/notes/reflection';

/**
 * Private journal reflection and a Google review handoff.
 * The note page renders this only when `journalReflectionsEnabled()` is true.
 * `enabled={false}` still renders nothing, including when a reflection object
 * was passed in. Save does not publish, does not set `bite_note_id`, and does
 * not append the draft to the Google URL.
 */

export type JournalReflectionSectionProps = {
  enabled: boolean;
  redemptionId: string;
  initialReflection: JournalReflection | null;
};

type FormFields = {
  favorite_bite: string;
  atmosphere: string;
  return_interest: '' | ReturnInterest;
  companion_label: string;
  unpublished_review_draft: string;
};

type FieldName = ReflectionTextField | 'return_interest';

type ShownError = {
  field: FieldName | null;
  message: string;
};

const FIELD_LABEL: Record<FieldName, string> = {
  favorite_bite: 'Favorite bite',
  atmosphere: 'Atmosphere',
  return_interest: 'Would you go back?',
  companion_label: 'Who you went with',
  unpublished_review_draft: 'Review draft',
};

function fieldsFrom(reflection: JournalReflection | null): FormFields {
  return {
    favorite_bite: reflection?.favorite_bite ?? '',
    atmosphere: reflection?.atmosphere ?? '',
    return_interest: reflection?.return_interest ?? '',
    companion_label: reflection?.companion_label ?? '',
    unpublished_review_draft: reflection?.unpublished_review_draft ?? '',
  };
}

function isReturnInterest(value: string): value is ReturnInterest {
  return (RETURN_INTERESTS as readonly string[]).includes(value);
}

function isTextField(field: string | undefined): field is ReflectionTextField {
  return (
    field === 'favorite_bite' ||
    field === 'atmosphere' ||
    field === 'companion_label' ||
    field === 'unpublished_review_draft'
  );
}

function reflectionError(result: { code: string; field?: string }): ShownError {
  if (result.code === 'too_long' && isTextField(result.field)) {
    return {
      field: result.field,
      message: `${FIELD_LABEL[result.field]} must be ${REFLECTION_LIMITS[result.field]} characters or less.`,
    };
  }
  if (result.code === 'invalid_text' && isTextField(result.field)) {
    return {
      field: result.field,
      message: `${FIELD_LABEL[result.field]} cannot include line breaks or control characters.`,
    };
  }
  if (result.code === 'invalid_return_interest') {
    return { field: 'return_interest', message: 'Choose yes, maybe, or no.' };
  }
  if (result.code === 'invalid_input') {
    return { field: null, message: 'That reflection could not be saved.' };
  }
  if (result.code === 'unauthorized') {
    return { field: null, message: 'Sign in to save a private reflection.' };
  }
  if (result.code === 'not_found') {
    return { field: null, message: 'That visit was not found.' };
  }
  if (result.code === 'forbidden') {
    return { field: null, message: 'You can save a private reflection only for your own visit.' };
  }
  if (result.code === 'disabled') {
    return { field: null, message: 'Private reflections are turned off.' };
  }
  return { field: null, message: 'The reflection could not be saved. Try again.' };
}

function handoffErrorMessage(code: string): string {
  switch (code) {
    case 'missing_destination':
      return 'This restaurant does not have a Google review link yet.';
    case 'invalid_place_id':
      return 'This restaurant does not have a usable Google place id, so a review link cannot be opened.';
    case 'invalid_url':
    case 'insecure_url':
    case 'disallowed_host':
      return 'A Google review link is not available for this restaurant.';
    case 'unauthorized':
      return 'Sign in to open a Google review link.';
    case 'not_found':
      return 'That visit was not found.';
    case 'forbidden':
      return 'You can open a Google review link only for your own visit.';
    case 'disabled':
      return 'Google review links are turned off.';
    default:
      return 'The Google review link could not be loaded. Try again.';
  }
}

function handoffTarget(url: string): { href: string; host: string } | null {
  if (!url.startsWith('https://')) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    return { href: url, host: parsed.host };
  } catch {
    return null;
  }
}

export function JournalReflectionSection({
  enabled,
  redemptionId,
  initialReflection,
}: JournalReflectionSectionProps) {
  const [fields, setFields] = useState<FormFields>(() => fieldsFrom(initialReflection));
  const [error, setError] = useState<ShownError | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null);
  const [handoffProblem, setHandoffProblem] = useState<string | null>(null);
  const [handoffPending, setHandoffPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFallback, setCopyFallback] = useState(false);

  if (!enabled) return null;

  const headingId = `private-reflection-${redemptionId}`;
  const handoff = handoffUrl ? handoffTarget(handoffUrl) : null;

  function setText(field: ReflectionTextField, value: string) {
    setSaved(false);
    setFields((current) => ({ ...current, [field]: value }));
  }

  async function onSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      favorite_bite: fields.favorite_bite,
      atmosphere: fields.atmosphere,
      return_interest: fields.return_interest === '' ? null : fields.return_interest,
      companion_label: fields.companion_label,
      unpublished_review_draft: fields.unpublished_review_draft,
    };
    const validated = validateReflectionFields(payload);
    if (!validated.ok) {
      setSaved(false);
      setError(reflectionError(validated));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await saveJournalReflection(redemptionId, payload);
      if (!result.ok) {
        setSaved(false);
        setError(reflectionError(result));
        return;
      }
      setFields({
        favorite_bite: validated.fields.favorite_bite ?? '',
        atmosphere: validated.fields.atmosphere ?? '',
        return_interest: validated.fields.return_interest ?? '',
        companion_label: validated.fields.companion_label ?? '',
        unpublished_review_draft: validated.fields.unpublished_review_draft ?? '',
      });
      setSaved(true);
    } catch {
      setSaved(false);
      setError({ field: null, message: 'The reflection could not be saved. Try again.' });
    } finally {
      setSaving(false);
    }
  }

  async function onHandoff() {
    setHandoffPending(true);
    setHandoffProblem(null);
    setHandoffUrl(null);
    setCopied(false);
    setCopyFallback(false);
    try {
      const result = await getGoogleReviewHandoffForRedemption(redemptionId);
      if (!result.ok) {
        setHandoffProblem(handoffErrorMessage(result.code));
        return;
      }
      if (!handoffTarget(result.url)) {
        setHandoffProblem(handoffErrorMessage('invalid_url'));
        return;
      }
      setHandoffUrl(result.url);
    } catch {
      setHandoffProblem(handoffErrorMessage('read_failed'));
    } finally {
      setHandoffPending(false);
    }
  }

  async function onCopy() {
    if (!handoff) return;
    try {
      if (!navigator.clipboard?.writeText) {
        setCopied(false);
        setCopyFallback(true);
        return;
      }
      await navigator.clipboard.writeText(handoff.href);
      setCopied(true);
      setCopyFallback(false);
    } catch {
      setCopied(false);
      setCopyFallback(true);
    }
  }

  function fieldError(field: FieldName): string | null {
    return error?.field === field ? error.message : null;
  }

  return (
    <section
      aria-labelledby={headingId}
      data-journal-reflection="private"
      className="mx-auto mt-10 max-w-2xl space-y-5 rounded-md border border-dashed border-input p-4"
    >
      <header className="space-y-1">
        <h2 id={headingId} className="text-lg font-semibold tracking-tight">
          Private reflection
        </h2>
        <p className="text-sm text-muted-foreground">
          Stays off your public note until you publish. Saving here keeps it in your Journal and does
          not post it on WanderBite.
        </p>
      </header>

      <form onSubmit={(event) => void onSave(event)} className="space-y-4" noValidate>
        <TextField
          id={`favorite-bite-${redemptionId}`}
          label={FIELD_LABEL.favorite_bite}
          value={fields.favorite_bite}
          cap={REFLECTION_LIMITS.favorite_bite}
          rows={2}
          error={fieldError('favorite_bite')}
          onChange={(value) => setText('favorite_bite', value)}
        />
        <TextField
          id={`atmosphere-${redemptionId}`}
          label={FIELD_LABEL.atmosphere}
          value={fields.atmosphere}
          cap={REFLECTION_LIMITS.atmosphere}
          rows={3}
          error={fieldError('atmosphere')}
          onChange={(value) => setText('atmosphere', value)}
        />
        <div className="space-y-1">
          <label htmlFor={`return-interest-${redemptionId}`} className="text-sm font-medium">
            {FIELD_LABEL.return_interest}
          </label>
          <select
            id={`return-interest-${redemptionId}`}
            value={fields.return_interest}
            aria-invalid={fieldError('return_interest') ? true : undefined}
            aria-describedby={
              fieldError('return_interest') ? `return-interest-error-${redemptionId}` : undefined
            }
            onChange={(event) => {
              const value = event.target.value;
              if (value !== '' && !isReturnInterest(value)) return;
              setSaved(false);
              setFields((current) => ({ ...current, return_interest: value }));
            }}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            <option value="">No answer</option>
            <option value="yes">Yes</option>
            <option value="maybe">Maybe</option>
            <option value="no">No</option>
          </select>
          {fieldError('return_interest') ? (
            <p id={`return-interest-error-${redemptionId}`} role="alert" className="text-sm text-destructive">
              {fieldError('return_interest')}
            </p>
          ) : null}
        </div>
        <TextField
          id={`companion-${redemptionId}`}
          label={FIELD_LABEL.companion_label}
          value={fields.companion_label}
          cap={REFLECTION_LIMITS.companion_label}
          rows={2}
          hint="A name or label you type. It is not linked to another member."
          error={fieldError('companion_label')}
          onChange={(value) => setText('companion_label', value)}
        />
        <TextField
          id={`review-draft-${redemptionId}`}
          label={FIELD_LABEL.unpublished_review_draft}
          value={fields.unpublished_review_draft}
          cap={REFLECTION_LIMITS.unpublished_review_draft}
          rows={5}
          hint="Stays in your Journal. It is not added to the Google link or your public note."
          error={fieldError('unpublished_review_draft')}
          onChange={(value) => setText('unpublished_review_draft', value)}
        />

        {error && error.field === null ? (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="text-sm text-muted-foreground">
            Saved. Only you can see this private reflection.
          </p>
        ) : null}

        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save reflection'}
        </Button>
      </form>

      <div className="space-y-3 border-t border-input pt-4" data-google-handoff="">
        <h3 className="text-sm font-medium">Google review</h3>
        <p className="text-sm text-muted-foreground">
          The link opens the Google review or Maps page. Opening it does not publish anything on
          WanderBite.
        </p>
        <Button type="button" variant="outline" disabled={handoffPending} onClick={() => void onHandoff()}>
          {handoffPending ? 'Getting link…' : 'Get Google review link'}
        </Button>
        {handoffProblem ? (
          <p role="alert" className="text-sm text-muted-foreground">
            {handoffProblem}
          </p>
        ) : null}
        {handoff ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Opens {handoff.host}. Copy writes only this link.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void onCopy()}>
                {copied ? 'Copied' : 'Copy link'}
              </Button>
              <Button asChild variant="outline">
                <a href={handoff.href} target="_blank" rel="noopener noreferrer">
                  Open Google review
                </a>
              </Button>
            </div>
            {copyFallback ? (
              <input
                readOnly
                value={handoff.href}
                aria-label="Google review link"
                onFocus={(event) => event.currentTarget.select()}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function TextField({
  id,
  label,
  value,
  cap,
  rows,
  hint,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  cap: number;
  rows: number;
  hint?: string;
  error: string | null;
  onChange: (value: string) => void;
}) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <textarea
        id={id}
        value={value}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      />
      <p className={`text-right text-xs ${value.length > cap ? 'text-destructive' : 'text-muted-foreground'}`}>
        {value.length}/{cap}
      </p>
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
