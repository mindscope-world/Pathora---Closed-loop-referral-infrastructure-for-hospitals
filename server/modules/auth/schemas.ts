import { z } from 'zod';
import { printableText } from '../../lib/validation';

const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address').max(254));

/** Minimum length follows current NIST guidance (length over composition rules). */
export const newPassword = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(128, 'Use at most 128 characters')
  .refine((p) => new Set(p).size >= 4, 'Password is too repetitive');

export const signupSchema = z.object({
  fullName: printableText(2, 120, 'Enter your full name'),
  organization: printableText(2, 160, 'Enter your organisation'),
  email,
  password: newPassword,
  pathway: z.string().trim().max(80).optional(),
});

export const loginSchema = z.object({
  email,
  // No strength rules here: existing passwords must be accepted as-is. Max keeps hashing cost bounded.
  password: z.string().min(1, 'Enter your password').max(128),
});
