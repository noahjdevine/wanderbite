import { z } from 'zod';

/** Sign-up validation. Password: 6-character minimum only (no special/uppercase/number required). */
export const signUpSchema = z.object({
  email: z.string().min(1, 'Please enter your email.').email('Please enter a valid email.'),
  password: z.string().min(6, 'Password must be at least 6 characters.'),
  agreeToTerms: z.literal(true, {
    message: 'You must be 21+ and agree to the terms to use WanderBite.',
  }),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
