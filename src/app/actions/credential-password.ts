'use server';

import { redirect } from 'next/navigation';
import { sendPasswordResetEmail, type SendPasswordResetResult } from '@/app/actions/auth';
import { createClient } from '@/lib/supabase/server';

export async function sendPasswordResetFromForm(
  _prev: SendPasswordResetResult | null,
  formData: FormData,
): Promise<SendPasswordResetResult> {
  return sendPasswordResetEmail(String(formData.get('email') ?? ''));
}

export type UpdatePasswordState = { error: string | null };

export async function updatePasswordFromForm(
  _prev: UpdatePasswordState,
  formData: FormData,
): Promise<UpdatePasswordState> {
  const password = String(formData.get('password') ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');
  if (password.length < 6) {
    return { error: 'Password must be at least 6 characters.' };
  }
  if (password !== confirmPassword) {
    return { error: 'Passwords do not match.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error: 'This reset link may have expired. Request a new one from the login page.',
    };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: error.message };
  }
  await supabase.auth.signOut();
  redirect('/signin?reset=success');
}
