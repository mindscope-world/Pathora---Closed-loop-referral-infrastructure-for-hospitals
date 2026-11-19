import type { CaseDto } from '../../shared/types';
import { forOrg } from '../db/tenant';
import { HttpError } from '../lib/errors';
import { acknowledgeCase, closeCase, confirmAttendance, loadCase } from '../modules/cases/service';
import type { AuthContext } from '../types';
import type { StatusEvent } from './fhir/task';

export interface StatusReturn {
  ref: string;
  event: StatusEvent;
  closureReason?: string;
  outcomeSource?: string;
}

export interface StatusReturnResult {
  ref: string;
  event: StatusEvent;
  /** `already_recorded`: the facility repeated a step we already have. That is success, not an error: callbacks get retried. */
  result: 'applied' | 'already_recorded';
  stage: CaseDto['stage'];
}

const satisfied = (event: StatusEvent, row: { stage: string; milestones: Array<{ type: string }> }) => {
  const has = (t: string) => row.milestones.some((m) => m.type === t);
  if (event === 'ACKNOWLEDGED') return has('FACILITY_ACKNOWLEDGED');
  if (event === 'ATTENDED') return has('PATIENT_ATTENDED');
  return row.stage === 'CLOSED';
};

/**
 * Applies a facility's status return through the SAME case actions the dashboard uses, so every rule (state machine,
 * optimistic lock, audit, SLA reset) applies identically. The caller's `auth` is the facility's integration identity,
 * which `caseScope` limits to that facility's referrals; another facility's referral is a plain 404.
 *
 * Idempotent: repeating a step that is already recorded returns `already_recorded` and changes nothing. A step that
 * is out of order (e.g. an outcome before attendance) is refused with the state machine's explanation; history is
 * never back-filled.
 */
export async function applyStatusReturn(auth: AuthContext, input: StatusReturn): Promise<StatusReturnResult> {
  const db = forOrg(auth.orgId);
  const current = await loadCase(db, auth, input.ref);
  if (satisfied(input.event, current)) return { ref: input.ref, event: input.event, result: 'already_recorded', stage: current.stage as CaseDto['stage'] };

  try {
    const dto =
      input.event === 'ACKNOWLEDGED'
        ? await acknowledgeCase(auth, input.ref)
        : input.event === 'ATTENDED'
        ? await confirmAttendance(auth, input.ref)
        : await closeCase(auth, input.ref, { closureReason: requireReason(input.closureReason), outcomeSource: input.outcomeSource });
    return { ref: input.ref, event: input.event, result: 'applied', stage: dto.stage };
  } catch (err) {
    // Two returns raced: if the other one satisfied this step, that is success.
    if (err instanceof HttpError && (err.code === 'VERSION_CONFLICT' || err.code === 'ILLEGAL_TRANSITION')) {
      const again = await loadCase(db, auth, input.ref);
      if (satisfied(input.event, again)) return { ref: input.ref, event: input.event, result: 'already_recorded', stage: again.stage as CaseDto['stage'] };
    }
    throw err;
  }
}

function requireReason(reason: string | undefined): string {
  const r = reason?.trim();
  if (!r) throw new HttpError(422, 'VALIDATION_ERROR', 'An outcome needs the documented closure reason');
  if (r.length > 500) throw new HttpError(422, 'VALIDATION_ERROR', 'Use at most 500 characters for the closure reason');
  return r;
}
