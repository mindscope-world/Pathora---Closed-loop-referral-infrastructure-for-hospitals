import { ApiError } from '../../lib/api';

/** Turns an API failure into text safe to show on a sign-in / sign-up form. */
export function describeAuthError(err: unknown): { message: string; fields: Record<string, string> } {
  if (err instanceof ApiError) {
    if (err.code === 'VALIDATION_ERROR') return { message: 'Please correct the highlighted fields.', fields: err.fieldErrors };
    if (err.code === 'TOO_MANY_ATTEMPTS' || err.code === 'RATE_LIMITED') {
      const mins = err.retryAfterSeconds ? Math.ceil(err.retryAfterSeconds / 60) : null;
      return {
        message: mins
          ? `Too many attempts. Please try again in about ${mins} minute${mins === 1 ? '' : 's'}.`
          : 'Too many attempts. Please wait a few minutes and try again.',
        fields: {},
      };
    }
    if (err.code === 'EMAIL_IN_USE') return { message: 'An account with this email already exists. Try signing in instead.', fields: {} };
    if (err.code === 'INVALID_CREDENTIALS') return { message: 'Incorrect email or password.', fields: {} };
    if (err.status >= 500) return { message: 'Something went wrong on our side. Please try again shortly.', fields: {} };
    return { message: err.message, fields: {} };
  }
  return { message: 'Could not reach the server. Check your connection and try again.', fields: {} };
}
