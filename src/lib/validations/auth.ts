import { z } from 'zod';

/** Sign-up: legal attestation only (21+ is required on onboarding if cocktail experiences are selected). */
export const signUpSchema = z
  .object({
    email: z.string().min(1, 'Please enter your email.').email('Please enter a valid email.'),
    password: z.string().min(8, 'Use at least 8 characters.'),
    confirmPassword: z.string().min(1, 'Confirm your password.'),
    agreeToTerms: z.literal(true, {
      message: 'Please agree to the Terms and Privacy Policy.',
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match.",
    path: ['confirmPassword'],
  });

export type SignUpInput = z.infer<typeof signUpSchema>;
