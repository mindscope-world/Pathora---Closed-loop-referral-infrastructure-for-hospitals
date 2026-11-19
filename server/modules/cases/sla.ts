import type { Stage } from '../../db/generated/client';
import type { CaseStatus } from '../../../shared/types';

/**
 * The SLA clock. Pure functions: every rule the product's accountability claim rests on lives here
 * and is unit-tested, so the UI, the API and the Phase 6 monitor job cannot disagree.
 *
 * A case carries ONE deadline, `slaDueAt` — the deadline for the next required action:
 *   - created / handed off    → issuedAt + the pathway's ack SLA
 *   - facility acknowledges   → issuedAt + the pathway's evaluation target
 *   - barrier resolved        → now + the pathway's contact SLA (a fresh window to act)
 *   - closed                  → no deadline
 */
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export interface PackSla {
  ackSlaHours: number;
  contactSlaHours: number;
  evalTargetDays: number;
}

export const ackDeadline = (issuedAt: Date, p: PackSla) => new Date(issuedAt.getTime() + p.ackSlaHours * HOUR_MS);
export const evaluationDeadline = (issuedAt: Date, p: PackSla) => new Date(issuedAt.getTime() + p.evalTargetDays * DAY_MS);
export const barrierDeadline = (now: Date, p: PackSla) => new Date(now.getTime() + p.contactSlaHours * HOUR_MS);

export interface StatusInput {
  stage: Stage;
  hasAcknowledged: boolean;
  slaDueAt: Date;
}

/**
 * - Closed Verified: the case is closed (the DB guarantees a documented outcome).
 * - Overdue SLA:     escalated, or the next-action deadline has passed. Escalation implies the case
 *                    is off-track until a barrier is resolved or the facility makes progress.
 * - Awaiting Ack:    handed off, within SLA, facility has not acknowledged.
 * - Active:          everything else in flight.
 * A deadline exactly equal to `now` is not yet overdue.
 */
export function deriveStatus(c: StatusInput, now: Date): CaseStatus {
  if (c.stage === 'CLOSED') return 'CLOSED_VERIFIED';
  if (c.stage === 'ESCALATED' || now.getTime() > c.slaDueAt.getTime()) return 'OVERDUE_SLA';
  if (!c.hasAcknowledged) return 'AWAITING_ACK';
  return 'ACTIVE';
}

/** Whole hours until the deadline, rounded to nearest; negative once overdue; 0 when closed. */
export function slaHoursRemaining(c: Pick<StatusInput, 'stage' | 'slaDueAt'>, now: Date): number {
  if (c.stage === 'CLOSED') return 0;
  const hours = Math.round((c.slaDueAt.getTime() - now.getTime()) / HOUR_MS);
  return Object.is(hours, -0) ? 0 : hours;
}
