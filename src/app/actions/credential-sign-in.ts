'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import {
  resolveSignInDestination,
  signInFieldErrors,
  type SignInProfileRow,
} from '@/lib/auth/sign-in-destination';

export type SignInFormState = {
  error: string | null;
  emailError: string | null;
  passwordError: string | null;
};

const INITIAL_ERROR = 'Something went wrong. Please try again.';

export async function signInFromForm(
  _prev: SignInFormState,
  formData: FormData,
): Promise<SignInFormState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const redirectRaw = formData.get('redirectTo');
  const redirectTo = typeof redirectRaw === 'string' ? redirectRaw : null;
  const fieldErrors = signInFieldErrors(email, password);
  if (fieldErrors) {
    return {
      error: null,
      emailError: fieldErrors.email ?? null,
      passwordError: fieldErrors.password ?? null,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) {
    return { error: error.message, emailError: null, passwordError: null };
  }
  if (!data.user) {
    return { error: INITIAL_ERROR, emailError: null, passwordError: null };
  }

  const explicit = redirectTo?.trim() ? redirectTo : null;
  if (explicit) {
    const destination = resolveSignInDestination({
      redirectTo: explicit,
      profileError: false,
      profile: null,
    });
    if (!destination.ok) {
      return { error: destination.error, emailError: null, passwordError: null };
    }
    redirect(destination.path);
  }

  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select(
      'id, role, subscription_status, username, address_street, address_city, address_state, address_zip',
    )
    .eq('id', data.user.id)
    .maybeSingle();

  const destination = resolveSignInDestination({
    redirectTo: null,
    profileError: Boolean(profileError),
    profile: (profile ?? null) as SignInProfileRow,
  });
  if (!destination.ok) {
    return { error: destination.error, emailError: null, passwordError: null };
  }
  redirect(destination.path);
}
