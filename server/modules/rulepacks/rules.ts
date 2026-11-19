import { z } from 'zod';
import type { RedFlagPolicy, RulePackStatus } from '../../../shared/types';
import { printableText } from '../../lib/validation';

/**
 * Bounds for a pathway rule pack. These are the authoritative limits: the UI's own min/max are only
 * a convenience and were never enforced before.
 */
export const BOUNDS = {
  ackSlaHours: { min: 1, max: 168 },
  contactSlaHours: { min: 1, max: 168 },
  evalTargetDays: { min: 1, max: 90 },
  redFlagHours: { min: 1, max: 168 },
} as const;

const int = (label: string, b: { min: number; max: number }) =>
  z.number({ error: `${label} must be a number` }).int(`${label} must be a whole number`)
    .min(b.min, `${label} must be at least ${b.min}`).max(b.max, `${label} must be at most ${b.max}`);

export const redFlagPolicySchema = z.object({
  unacknowledgedHours: int('Red-flag timer (hours)', BOUNDS.redFlagHours).nullable(),
});

export const updateRulePackSchema = z
  .object({
    ackSlaHours: int('Facility acknowledgment SLA (hours)', BOUNDS.ackSlaHours).optional(),
    contactSlaHours: int('Contact SLA (hours)', BOUNDS.contactSlaHours).optional(),
    evalTargetDays: int('Evaluation target (days)', BOUNDS.evalTargetDays).optional(),
    redFlagRule: printableText(3, 500, 'Describe the red-flag route').optional(),
    redFlagPolicy: redFlagPolicySchema.optional(),
    closureCriteria: printableText(3, 500, 'Describe the closure criteria').optional(),
    clinicalOwnerId: z.string().trim().min(1).max(64).nullable().optional(),
    status: z.enum(['ACTIVE', 'CONFIGURED', 'COMING_SOON']).optional(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .refine((v) => Object.keys(v).filter((k) => k !== 'expectedVersion').length > 0, { message: 'Nothing to update' });

export const rulePackKey = z.string().regex(/^RP-[A-Z0-9-]{2,30}$/);

export interface PackFields {
  ackSlaHours: number;
  contactSlaHours: number;
  evalTargetDays: number;
  redFlagRule: string;
  redFlagPolicy: RedFlagPolicy;
  closureCriteria: string;
  clinicalOwnerId: string | null;
  status: RulePackStatus;
}

/** Relationships between a pack's own timers. Returns a user-facing message, or null if consistent. */
export function timerProblem(p: Pick<PackFields, 'ackSlaHours' | 'contactSlaHours' | 'evalTargetDays' | 'redFlagPolicy'>): { field: string; message: string } | null {
  if (p.contactSlaHours > p.ackSlaHours) {
    return { field: 'contactSlaHours', message: 'The contact window cannot be longer than the facility acknowledgment window' };
  }
  if (p.evalTargetDays * 24 <= p.ackSlaHours) {
    return { field: 'evalTargetDays', message: 'The evaluation target must fall after the acknowledgment deadline' };
  }
  const rf = p.redFlagPolicy.unacknowledgedHours;
  if (rf !== null && rf > p.evalTargetDays * 24) {
    return { field: 'redFlagPolicy', message: 'The red-flag timer cannot be longer than the evaluation target' };
  }
  return null;
}

/** Reads the stored JSON defensively: anything malformed means "no timer", never a crash in the monitor. */
export function parseRedFlagPolicy(raw: unknown): RedFlagPolicy {
  const parsed = redFlagPolicySchema.safeParse(raw);
  return parsed.success ? parsed.data : { unacknowledgedHours: null };
}

const LABELS: Record<string, string> = {
  ackSlaHours: 'ackSlaHours', contactSlaHours: 'contactSlaHours', evalTargetDays: 'evalTargetDays', redFlagRule: 'redFlagRule',
  redFlagPolicy: 'redFlagTimerHours', closureCriteria: 'closureCriteria', clinicalOwnerId: 'clinicalOwner', status: 'status',
};

/** Human-readable list of what changed between two versions of a pack. Empty when nothing did. */
export function describeChanges(before: PackFields, after: PackFields, ownerNames: Map<string, string>): string[] {
  const show = (k: keyof PackFields, p: PackFields): string => {
    if (k === 'redFlagPolicy') return String(p.redFlagPolicy.unacknowledgedHours ?? 'none');
    if (k === 'clinicalOwnerId') return p.clinicalOwnerId ? (ownerNames.get(p.clinicalOwnerId) ?? p.clinicalOwnerId) : 'none';
    return JSON.stringify(p[k]);
  };
  const same = (k: keyof PackFields) =>
    k === 'redFlagPolicy' ? before.redFlagPolicy.unacknowledgedHours === after.redFlagPolicy.unacknowledgedHours : before[k] === after[k];
  return (Object.keys(LABELS) as (keyof PackFields)[]).filter((k) => !same(k)).map((k) => `${LABELS[k]}: ${show(k, before)} → ${show(k, after)}`);
}
