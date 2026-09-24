'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { recordLegalAttestation } from '@/app/actions/legal-attestation';
import { ACCOUNT_CHANGED_MESSAGE } from '@/lib/auth/account-changed';
import { getEmailConfirmCallbackUrl } from '@/lib/auth/safe-redirect';
import {
  LEGAL_DOCUMENT_VERSION,
  signupAttestationDecision,
} from '@/lib/legal-attestation';
import { signUpSchema } from '@/lib/validations/auth';

export type SignUpFieldErrors = {
  email?: string;
  password?: string;
  confirmPassword?: string;
  confirmAge21?: string;
  agreeToTerms?: string;
};

export type SignUpFormState = {
  error: string | null;
  fieldErrors: SignUpFieldErrors;
};

function checked(formData: FormData, name: string): boolean {
  const value = formData.get(name);
  return value === 'true' || value === 'on';
}

export async function signUpFromForm(
  _prev: SignUpFormState,
  formData: FormData,
): Promise<SignUpFormState> {
  const parsed = signUpSchema.safeParse({
    email: String(formData.get('email') ?? '').trim(),
    password: String(formData.get('password') ?? ''),
    confirmPassword: String(formData.get('confirmPassword') ?? ''),
    confirmAge21: checked(formData, 'confirmAge21'),
    agreeToTerms: checked(formData, 'agreeToTerms'),
  });
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    return {
      error: null,
      fieldErrors: {
        email: flat.email?.[0],
        password: flat.password?.[0],
        confirmPassword: flat.confirmPassword?.[0],
        confirmAge21: flat.confirmAge21?.[0],
        agreeToTerms: flat.agreeToTerms?.[0],
      },
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: getEmailConfirmCallbackUrl(),
    },
  });
  if (error) {
    return { error: error.message, fieldErrors: {} };
  }

  const decision = signupAttestationDecision(data.user?.id, data.session?.user?.id);
  if (decision === 'mismatch') {
    return { error: ACCOUNT_CHANGED_MESSAGE, fieldErrors: {} };
  }
  if (decision === 'record' && data.user) {
    const recorded = await recordLegalAttestation(
      {
        presentedVersion: LEGAL_DOCUMENT_VERSION,
        age21: true,
        agreeToTerms: true,
      },
      data.user.id,
    );
    if (!recorded.ok) {
      return { error: recorded.error, fieldErrors: {} };
    }
  }

  redirect(
    decision === 'no-session'
      ? '/signup/check-email?attestation=after-sign-in'
      : '/signup/check-email',
  );
}
