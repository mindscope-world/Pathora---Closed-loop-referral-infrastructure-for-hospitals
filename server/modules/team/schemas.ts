import { z } from 'zod';
import { printableText } from '../../lib/validation';
import { newPassword } from '../auth/schemas';

const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address').max(254));
const role = z.enum(['PROGRAMME_MANAGER', 'PROGRAMME_COORDINATOR', 'FACILITY_FOCAL', 'CLINICAL_LEAD', 'DPO']);
const personName = printableText(2, 120, 'Enter a name');

export const inviteSchema = z
  .object({ email, name: personName, role, facilityId: z.string().trim().min(1).max(64).optional() })
  .superRefine((v, ctx) => {
    if (v.role === 'FACILITY_FOCAL' && !v.facilityId) {
      ctx.addIssue({ code: 'custom', path: ['facilityId'], message: 'Choose the facility this person works at' });
    }
    if (v.role !== 'FACILITY_FOCAL' && v.facilityId) {
      ctx.addIssue({ code: 'custom', path: ['facilityId'], message: 'Only receiving-facility focal contacts are tied to a facility' });
    }
  });

export const updateMemberSchema = z
  .object({
    active: z.boolean().optional(),
    role: role.optional(),
    facilityId: z.string().trim().min(1).max(64).nullable().optional(),
    name: personName.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

/** The token is 32 random bytes, base64url: always 43 characters. Anything else is rejected before touching the DB. */
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid invitation link');
export const lookupInviteSchema = z.object({ token });
export const acceptInviteSchema = z.object({ token, password: newPassword, name: personName.optional() });
