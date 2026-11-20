import { z } from 'zod';

/**
 * FHIR R4 `Task` ⇄ a status return. A facility reports progress on a referral as a Task whose `focus` is the
 * ServiceRequest. Only the statuses that correspond to a real step in our lifecycle are accepted; anything else
 * is refused with an explanation rather than silently guessed at.
 *
 *   accepted | received → the facility acknowledges the referral
 *   in-progress         → the patient attended
 *   completed           → outcome documented and the loop closed (needs a reason in statusReason.text)
 */
export type StatusEvent = 'ACKNOWLEDGED' | 'ATTENDED' | 'CLOSED';

const TASK_STATUS_TO_EVENT: Record<string, StatusEvent> = {
  accepted: 'ACKNOWLEDGED',
  received: 'ACKNOWLEDGED',
  'in-progress': 'ATTENDED',
  completed: 'CLOSED',
};

/** Escape hatch for the FHIR statuses we deliberately do not act on, so the error can say why. */
const KNOWN_UNSUPPORTED = new Set(['draft', 'requested', 'rejected', 'ready', 'cancelled', 'on-hold', 'failed', 'entered-in-error']);

const REF = /^[A-Za-z0-9][A-Za-z0-9.-]{0,63}$/;

const taskSchema = z.object({
  resourceType: z.literal('Task'),
  status: z.string().min(1).max(32),
  focus: z.object({ reference: z.string().max(100) }),
  statusReason: z.object({ text: z.string().trim().min(1).max(500).optional() }).optional(),
});

export interface ParsedTask {
  ref: string;
  event: StatusEvent;
  closureReason?: string;
}

export class TaskMappingError extends Error {}

export function parseTask(input: unknown): ParsedTask {
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) {
    throw new TaskMappingError(`Not a valid Task: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'Task'} ${i.message}`).join('; ')}`);
  }
  const t = parsed.data;
  const m = /^ServiceRequest\/(.+)$/.exec(t.focus.reference);
  if (!m || !REF.test(m[1])) throw new TaskMappingError('Task.focus.reference must be "ServiceRequest/<referral id>"');

  const event = TASK_STATUS_TO_EVENT[t.status];
  if (!event) {
    throw new TaskMappingError(
      KNOWN_UNSUPPORTED.has(t.status)
        ? `Task status "${t.status}" is not supported. Use accepted, in-progress or completed.`
        : `Unknown Task status "${t.status}".`,
    );
  }
  const reason = t.statusReason?.text;
  if (event === 'CLOSED' && !reason) throw new TaskMappingError('A completed Task needs the documented outcome in statusReason.text');
  return { ref: m[1], event, ...(event === 'CLOSED' ? { closureReason: reason } : {}) };
}

/** The Task view of where a referral stands, for the facility's own records. */
export function toTask(r: { refNumber: string; stage: string; updatedAt: Date }) {
  const status =
    r.stage === 'CLOSED' ? 'completed' : r.stage === 'ATTENDED' ? 'in-progress' : r.stage === 'ACKNOWLEDGED' ? 'accepted' : r.stage === 'ESCALATED' ? 'on-hold' : 'requested';
  return {
    resourceType: 'Task' as const,
    id: r.refNumber,
    status,
    intent: 'order',
    focus: { reference: `ServiceRequest/${r.refNumber}` },
    lastModified: r.updatedAt.toISOString(),
  };
}
