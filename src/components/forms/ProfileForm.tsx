'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { checkUsername } from '@/app/actions/check-username';
import { cn } from '@/lib/utils';
import {
  AddressFields,
  isAutofillAnimation,
  readAddressFields,
  type AddressValues,
} from '@/components/forms/AddressFields';

export type ProfileValues = {
  username: string;
  address: AddressValues;
};

type UsernameState =
  | { status: 'idle' }
  | { status: 'checking' }
  | {
      status:
        | 'available'
        | 'taken'
        | 'invalid'
        | 'too_short'
        | 'too_long'
        | 'unchanged'
        | 'error';
      message?: string;
    };

function usernameMessage(s: UsernameState): string | null {
  if (s.status === 'idle' || s.status === 'checking') return null;
  if (s.status === 'available') return 'Available';
  if (s.status === 'unchanged') return 'Looks good';
  if (s.status === 'too_short') return 'Use at least 3 characters';
  if (s.status === 'too_long') return 'Use 20 characters or fewer';
  if (s.status === 'invalid') return 'Use letters, numbers, and underscores only';
  if (s.status === 'taken') return 'That username is taken';
  if (s.status === 'error') return s.message ?? 'Could not check username';
  return null;
}

function usernameOk(s: UsernameState): boolean {
  return s.status === 'available' || s.status === 'unchanged';
}

function validZip(zip: string): boolean {
  const t = zip.trim();
  return /^\d{5}(-\d{4})?$/.test(t);
}

export function ProfileForm({
  initialValues,
  onSubmit,
  submitLabel,
  currentUserId: _currentUserId,
  isDirty,
}: {
  initialValues: ProfileValues;
  onSubmit: (values: ProfileValues) => Promise<void> | void;
  submitLabel: string;
  currentUserId: string;
  isDirty?: boolean;
}) {
  const [values, setValues] = useState<ProfileValues>(initialValues);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [touchedUsername, setTouchedUsername] = useState(false);
  const [touchedZip, setTouchedZip] = useState(false);
  const [usernameState, setUsernameState] = useState<UsernameState>({ status: 'idle' });
  const debounceRef = useRef<number | null>(null);
  const lastCheckedUsernameRef = useRef<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const dirty = useMemo(() => {
    if (typeof isDirty === 'boolean') return isDirty;
    return JSON.stringify(values) !== JSON.stringify(initialValues);
  }, [initialValues, isDirty, values]);

  const zipOk = values.address.zip.trim().length === 0 ? false : validZip(values.address.zip);
  const showZipError = touchedZip && values.address.zip.trim().length > 0 && !zipOk;

  const queueUsernameAvailabilityCheck = useCallback(
    (username: string, opts?: { skipIfUnchanged?: boolean }) => {
      const u = username.trim();
      if (opts?.skipIfUnchanged && u === lastCheckedUsernameRef.current) {
        return;
      }
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      if (!u) {
        lastCheckedUsernameRef.current = null;
        setUsernameState({ status: 'too_short' });
        return;
      }
      setUsernameState({ status: 'checking' });
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null;
        checkUsername(u)
          .then((res) => {
            if (!res.ok) {
              setUsernameState({ status: 'error', message: res.error });
              return;
            }
            lastCheckedUsernameRef.current = u;
            setUsernameState({ status: res.status });
          })
          .catch(() => setUsernameState({ status: 'error', message: 'Could not check username' }));
      }, 500);
    },
    [],
  );

  useEffect(() => {
    const u = values.username.trim();
    if (!u || u === lastCheckedUsernameRef.current) return;
    const timer = window.setTimeout(() => {
      queueUsernameAvailabilityCheck(u, { skipIfUnchanged: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [queueUsernameAvailabilityCheck, values.username]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, []);

  const applyAutofill = useCallback(() => {
    const form = formRef.current;
    if (!form) return;
    const domAddress = readAddressFields(form);
    const username = form.querySelector<HTMLInputElement>('#profile-username')?.value ?? '';
    setValues((prev) => {
      const next = {
        username: username.trim() ? username : prev.username,
        address: {
          street: domAddress.street.trim() ? domAddress.street : prev.address.street,
          city: domAddress.city.trim() ? domAddress.city : prev.address.city,
          state: domAddress.state.trim() ? domAddress.state : prev.address.state,
          zip: domAddress.zip.trim() ? domAddress.zip : prev.address.zip,
        },
      };
      if (JSON.stringify(next) === JSON.stringify(prev)) return prev;
      return next;
    });
  }, []);

  useEffect(() => {
    applyAutofill();
  }, [applyAutofill]);

  const usernameHint = usernameMessage(usernameState);
  const usernameGood = usernameOk(usernameState);

  const canSubmit =
    dirty &&
    values.username.trim().length >= 3 &&
    usernameGood &&
    values.address.street.trim().length > 0 &&
    values.address.city.trim().length > 0 &&
    values.address.state.trim().length === 2 &&
    zipOk;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setTouchedZip(true);

    setSaving(true);
    try {
      await onSubmit(values);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      onAnimationStart={(event) => {
        if (!isAutofillAnimation(event)) return;
        applyAutofill();
      }}
      className="space-y-6"
    >
      <div className="space-y-2">
        <label htmlFor="profile-username" className="text-sm font-medium">
          Username
        </label>
        <input
          id="profile-username"
          type="text"
          value={values.username}
          onChange={(e) => {
            const next = e.target.value;
            setValues((p) => ({ ...p, username: next }));
            if (!touchedUsername) setTouchedUsername(true);
          }}
          onBlur={() => {
            setTouchedUsername(true);
            queueUsernameAvailabilityCheck(values.username, { skipIfUnchanged: true });
          }}
          placeholder="e.g. foodie_jane"
          autoComplete="username"
          disabled={saving}
          className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-base sm:text-sm placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
        />
        <div className="flex items-center gap-2 text-xs">
          {usernameState.status === 'checking' ? (
            <>
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />
              <span className="text-muted-foreground">Checking…</span>
            </>
          ) : usernameHint ? (
            <>
              {usernameGood ? (
                <CheckCircle2 className="size-4 text-primary" aria-hidden />
              ) : (
                <XCircle className="size-4 text-destructive" aria-hidden />
              )}
              <span className={cn(usernameGood ? 'text-primary' : 'text-destructive')}>
                {usernameHint}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">3–20 characters. Letters, numbers, underscores.</span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Address</p>
        <AddressFields
          value={values.address}
          onChange={(addr) => setValues((p) => ({ ...p, address: addr }))}
          onZipBlur={() => setTouchedZip(true)}
          disabled={saving}
        />
        {showZipError ? (
          <p className="text-sm text-destructive">ZIP must be 5 digits or ZIP+4 (e.g. 78701 or 78701-1234).</p>
        ) : null}
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="text-sm text-primary" role="status">
          Saved ✓
        </p>
      ) : null}

      <button
        type="submit"
        disabled={saving || !canSubmit}
        className={cn(
          'inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-base font-semibold text-primary-foreground shadow-sm transition-opacity',
          saving || !canSubmit ? 'opacity-60' : 'hover:opacity-95'
        )}
      >
        {saving ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}

