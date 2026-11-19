import { z } from 'zod';

const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address').max(254));

/** Minimum length follows current NIST guidance (length over composition rules). */
const newPassword = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(128, 'Use at most 128 characters')
  .refine((p) => new Set(p).size >= 4, 'Password is too repetitive');

export const signupSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name').max(120),
  organization: z.string().trim().min(2, 'Enter your organisation').max(160),
  email,
  password: newPassword,
  pathway: z.string().trim().max(80).optional(),
});

export const loginSchema = z.object({
  email,
  // No strength rules here: existing passwords must be accepted as-is. Max keeps hashing cost bounded.
  password: z.string().min(1, 'Enter your password').max(128),
});
