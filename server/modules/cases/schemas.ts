import { z } from 'zod';

const text = (min: number, max: number, what: string) =>
  z.string().trim().min(min, `${what} is required`).max(max, `${what} must be at most ${max} characters`);

const expectedVersion = z.number().int().positive().optional();
const pathway = z.enum(['CANCER_SCREENING', 'NCD_SCREENING', 'MALE_REPRODUCTIVE_HEALTH', 'MATERNAL_CHILD_HEALTH']);

export const refParam = z.string().regex(/^REF-\d{4}-\d{4,}$/);

export const createCaseSchema = z
  .object({
    patientName: text(1, 120, 'Patient name').optional(),
    patientCode: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9-]{1,31}$/, 'Use 2–32 letters, numbers or dashes').optional(),
    patientLabel: text(1, 120, 'Cohort note').optional(),
    pathway,
    sourceProgram: text(1, 160, 'Source programme'),
    coordinatorId: text(1, 64, 'Owner'),
    facilityId: text(1, 64, 'Receiving facility'),
    redFlag: z.boolean().default(false),
    consentSms: z.boolean().default(false),
    notes: text(1, 1000, 'Notes').optional(),
  })
  .refine((v) => v.patientName || v.patientCode, { message: 'Enter a patient name or an identifier code', path: ['patientName'] });

export const ackSchema = z.object({ expectedVersion });
export const attendSchema = z.object({ expectedVersion });
export const closeSchema = z.object({
  expectedVersion,
  closureReason: text(3, 300, 'Closure reason'),
  outcomeSource: text(2, 200, 'Outcome source').optional(),
});
export const escalateSchema = z.object({ expectedVersion, reason: text(3, 500, 'Reason') });
export const barrierSchema = z.object({ expectedVersion, note: text(3, 500, 'Resolution note') });
export const reassignSchema = z.object({ expectedVersion, coordinatorId: text(1, 64, 'Owner') });
export const optOutSchema = z.object({ optedOut: z.boolean() });

export const importSchema = z.object({
  csv: z.string().min(1, 'Paste at least one CSV row').max(1_000_000, 'CSV is too large'),
  dryRun: z.boolean().optional(),
  consentAttested: z.boolean().optional(),
});
