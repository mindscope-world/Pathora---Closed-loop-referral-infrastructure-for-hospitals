import type { Stage } from '../../db/generated/client';
import { HttpError } from '../../lib/errors';

/**
 * Referral lifecycle.
 *
 *   INTAKE → ASSIGNED → CONTACTED → HANDOFF_SENT → ACKNOWLEDGED → ATTENDED → CLOSED
 *                                       │  ▲              │            │
 *                                       └──┴── ESCALATED ◄─┴────────────┘   (and from CONTACTED)
 *
 * Cases created through the app start at HANDOFF_SENT: intake, assignment and the facility handoff
 * happen in one step. Earlier stages exist for staged intake flows.
 *
 * The machine never lets a milestone be skipped. The old UI quietly back-filled a missing
 * acknowledgment/attendance timestamp when later steps were recorded; that would let a case "close"
 * with fabricated history, so here the missing step is an error the caller must resolve first.
 */
export type CaseEvent = 'ACKNOWLEDGE' | 'ATTEND' | 'CLOSE' | 'ESCALATE' | 'RESOLVE_BARRIER';

export interface CaseFacts {
  stage: Stage;
  hasAcknowledged: boolean;
  hasAttended: boolean;
}

const illegal = (message: string) => new HttpError(409, 'ILLEGAL_TRANSITION', message);

const label = (s: Stage) => s.toLowerCase().replace(/_/g, ' ');

/** Where a case returns to when an escalation is cleared: back to its real progress, never backwards. */
export function resumeStage(f: Pick<CaseFacts, 'hasAcknowledged' | 'hasAttended'>): Stage {
  if (f.hasAttended) return 'ATTENDED';
  if (f.hasAcknowledged) return 'ACKNOWLEDGED';
  return 'HANDOFF_SENT';
}

/** Returns the next stage, or throws a 409 ILLEGAL_TRANSITION explaining what is missing. */
export function transition(f: CaseFacts, event: CaseEvent): Stage {
  if (f.stage === 'CLOSED') throw illegal('This case is closed and can no longer be changed');

  switch (event) {
    case 'ACKNOWLEDGE':
      if (f.hasAcknowledged) throw illegal('The facility has already acknowledged this referral');
      if (f.stage !== 'HANDOFF_SENT' && f.stage !== 'ESCALATED') {
        throw illegal(`The referral has not been handed off to the facility yet (stage: ${label(f.stage)})`);
      }
      return 'ACKNOWLEDGED';

    case 'ATTEND':
      if (!f.hasAcknowledged) throw illegal('The facility must acknowledge the referral before attendance can be confirmed');
      if (f.hasAttended) throw illegal('Patient attendance has already been confirmed');
      return 'ATTENDED';

    case 'CLOSE':
      if (!f.hasAcknowledged) throw illegal('The facility must acknowledge the referral before the case can be closed');
      if (!f.hasAttended) throw illegal('Patient attendance must be confirmed before the case can be closed');
      return 'CLOSED';

    case 'ESCALATE':
      if (f.stage === 'ESCALATED') throw illegal('This case is already escalated');
      if (f.stage === 'INTAKE' || f.stage === 'ASSIGNED') {
        throw illegal(`A case cannot be escalated before it is contacted (stage: ${label(f.stage)})`);
      }
      return 'ESCALATED';

    case 'RESOLVE_BARRIER':
      return f.stage === 'ESCALATED' ? resumeStage(f) : f.stage;
  }
}
