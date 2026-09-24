import { z } from 'zod';

/** Sign-up collects an explicit 21+ confirmation and agreement to the current terms. */
export const signUpSchema = z
  .object({
    email: z.string().min(1, 'Please enter your email.').email('Please enter a valid email.'),
    password: z.string().min(8, 'Use at least 8 characters.'),
    confirmPassword: z.string().min(1, 'Confirm your password.'),
    confirmAge21: z.literal(true, {
      message: 'Please confirm you are 21 or older.',
    }),
    agreeToTerms: z.literal(true, {
      message: 'Please agree to the Terms and Privacy Policy.',
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match.",
    path: ['confirmPassword'],
  });

export type SignUpInput = z.infer<typeof signUpSchema>;
