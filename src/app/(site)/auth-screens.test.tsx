import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PASSWORD_RESET_VALIDATION_MESSAGE } from '@/lib/password-reset';
import { SIGNUP_EARLY_ACCESS_MESSAGE } from '@/lib/checkout-copy';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  redirect: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      resend: vi.fn(),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
  }),
}));

import { SignInForm } from './signin/sign-in-form';
import SignUpPage from './signup/page';
import CheckEmailPage from './signup/check-email/page';
import ForgotPasswordPage from './forgot-password/page';
import { ResetPasswordForm } from './reset-password/reset-password-form';
import { ResetPasswordInvalid } from './reset-password/reset-password-invalid';

afterEach(() => {
  cleanup();
});

function headingText(): string {
  const headings = screen.getAllByRole('heading', { level: 1 });
  expect(headings).toHaveLength(1);
  return headings[0]?.textContent ?? '';
}

describe('sign-in form', () => {
  it('keeps one heading, labelled fields, and the same links', () => {
    render(<SignInForm redirectTo="" resetSuccess={false} sessionError={false} />);
    expect(headingText()).toBe('Welcome back.');
    const email = screen.getByLabelText('Email');
    const password = screen.getByLabelText('Password');
    expect(email.getAttribute('name')).toBe('email');
    expect(email.getAttribute('autocomplete')).toBe('email');
    expect(password.getAttribute('name')).toBe('password');
    expect(password.getAttribute('autocomplete')).toBe('current-password');
    expect(screen.getByRole('button', { name: 'Sign me in' })).toBeTruthy();
    const forgot = screen.getByRole('link', { name: 'Forgot it? Happens to the best of us' });
    expect(forgot.getAttribute('href')).toBe('/forgot-password');
    expect(password.compareDocumentPosition(forgot) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(forgot.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_PRECEDING).toBe(
      Node.DOCUMENT_POSITION_PRECEDING,
    );
    expect(screen.getByRole('link', { name: 'Create an account' }).getAttribute('href')).toBe('/signup');
    expect(email.closest('form')?.hasAttribute('hidden')).toBe(false);
  });

  it('announces field errors without changing the message', () => {
    render(<SignInForm redirectTo="" resetSuccess={false} sessionError={false} />);
    fireEvent.submit(screen.getByRole('button', { name: 'Sign me in' }).closest('form')!);
    const email = screen.getByLabelText('Email');
    const password = screen.getByLabelText('Password');
    expect(email.getAttribute('aria-describedby')).toBe('signin-email-error');
    expect(document.getElementById('signin-email-error')?.textContent).toBe('Enter your email.');
    expect(password.getAttribute('aria-describedby')).toBe('signin-password-error');
    expect(document.getElementById('signin-password-error')?.textContent).toBe('Enter your password.');
  });
});

describe('sign-up page', () => {
  it('keeps the early-access notice, fields, and switch link', () => {
    render(<SignUpPage />);
    expect(headingText()).toBe('Start your food adventure.');
    expect(screen.getByRole('status').textContent).toBe(SIGNUP_EARLY_ACCESS_MESSAGE);
    const email = screen.getByLabelText('Email');
    const password = screen.getByLabelText('Password');
    const confirm = screen.getByLabelText('Confirm password');
    expect(email.getAttribute('name')).toBe('email');
    expect(email.getAttribute('autocomplete')).toBe('email');
    expect(password.getAttribute('name')).toBe('password');
    expect(password.getAttribute('autocomplete')).toBe('new-password');
    expect(confirm.getAttribute('name')).toBe('confirmPassword');
    expect(confirm.getAttribute('autocomplete')).toBe('new-password');
    expect(screen.getByRole('checkbox', { name: 'I confirm I am 21 or older.' }).getAttribute('name')).toBe(
      'confirmAge21',
    );
    expect(screen.getByRole('button', { name: 'Create my account' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/signin');
    expect(screen.getByRole('link', { name: 'Terms of Service' }).getAttribute('href')).toBe('/terms');
    expect(screen.getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')).toBe('/privacy');
    expect(screen.getByRole('link', { name: 'Challenge rules' }).getAttribute('href')).toBe('/rules');
  });

  it('associates the same validation messages with each field', () => {
    render(<SignUpPage />);
    fireEvent.submit(screen.getByRole('button', { name: 'Create my account' }).closest('form')!);
    expect(screen.getByLabelText('Email').getAttribute('aria-describedby')).toBe('signup-email-error');
    expect(document.getElementById('signup-email-error')?.textContent).toBe('Please enter your email.');
    expect(screen.getByLabelText('Password').getAttribute('aria-describedby')).toBe('signup-password-error');
    expect(document.getElementById('signup-password-error')?.textContent).toBe('Use at least 8 characters.');
    expect(screen.getByLabelText('Confirm password').getAttribute('aria-describedby')).toBe(
      'signup-confirm-error',
    );
    expect(document.getElementById('signup-confirm-error')?.textContent).toBe('Confirm your password.');
    const age = screen.getByRole('checkbox', { name: 'I confirm I am 21 or older.' });
    expect(age.getAttribute('aria-describedby')).toBe('signup-age-error');
    expect(document.getElementById('signup-age-error')?.textContent).toBe(
      'Please confirm you are 21 or older.',
    );
    const terms = screen.getByRole('checkbox', { name: /I agree to the/ });
    expect(terms.getAttribute('aria-describedby')).toBe('signup-terms-error');
    expect(document.getElementById('signup-terms-error')?.textContent).toBe(
      'Please agree to the Terms and Privacy Policy.',
    );
  });
});

describe('check-email page', () => {
  it('keeps one heading and the same links', () => {
    render(<CheckEmailPage />);
    expect(headingText()).toBe('Check your email.');
    expect(screen.getByRole('link', { name: 'Use a different one' }).getAttribute('href')).toBe('/signup');
    expect(screen.getByRole('link', { name: 'Back to sign in' }).getAttribute('href')).toBe('/signin');
    expect(screen.getByRole('button', { name: "Didn't get it? Resend confirmation" })).toBeTruthy();
  });
});

describe('forgot-password page', () => {
  it('keeps the request copy and announces the same validation error', async () => {
    render(<ForgotPasswordPage />);
    expect(headingText()).toBe('Forgot it? Happens to the best of us.');
    const email = screen.getByLabelText('Email');
    expect(email.getAttribute('name')).toBe('email');
    expect(email.getAttribute('autocomplete')).toBe('email');
    expect(screen.getByRole('button', { name: 'Send Reset Link' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to sign in' }).getAttribute('href')).toBe('/signin');
    fireEvent.submit(email.closest('form')!);
    await waitFor(() => {
      expect(document.getElementById('forgot-password-error')?.textContent).toBe(
        PASSWORD_RESET_VALIDATION_MESSAGE,
      );
    });
    expect(screen.getByLabelText('Email').getAttribute('aria-describedby')).toBe('forgot-password-error');
  });
});

describe('reset-password form', () => {
  it('keeps the reset fields and announces the same mismatch error', async () => {
    render(<ResetPasswordForm />);
    expect(headingText()).toBe('Set new password');
    const password = screen.getByLabelText('New password');
    const confirm = screen.getByLabelText('Confirm password');
    expect(password.getAttribute('name')).toBe('password');
    expect(password.getAttribute('autocomplete')).toBe('new-password');
    expect(confirm.getAttribute('name')).toBe('confirmPassword');
    expect(confirm.getAttribute('autocomplete')).toBe('new-password');
    expect(screen.getByRole('button', { name: 'Update password' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to sign in' }).getAttribute('href')).toBe('/signin');
    fireEvent.change(password, { target: { value: 'abcdef' } });
    fireEvent.change(confirm, { target: { value: 'abcdeg' } });
    fireEvent.submit(password.closest('form')!);
    await waitFor(() => {
      expect(document.getElementById('reset-password-error')?.textContent).toBe('Passwords do not match.');
    });
    expect(password.getAttribute('aria-describedby')).toBe('reset-password-error');
    expect(confirm.getAttribute('aria-describedby')).toBe('reset-password-error');
  });

  it('keeps the invalid-link heading and request link', () => {
    render(<ResetPasswordInvalid />);
    expect(headingText()).toBe('Invalid or expired link');
    expect(screen.getByRole('link', { name: 'Request new reset link' }).getAttribute('href')).toBe(
      '/forgot-password',
    );
  });
});
