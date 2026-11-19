/** Who the audit trail names for actions the system takes by itself (monitors, workers, patient replies aside). */
export const SYSTEM_ACTOR = { actorId: null, actorLabel: 'SLA Monitor', actorRole: 'System' } as const;
export const MESSAGING_ACTOR = { actorId: null, actorLabel: 'Messaging Service', actorRole: 'System' } as const;
export const PATIENT_ACTOR = { actorId: null, actorLabel: 'Patient (reply)', actorRole: 'Patient' } as const;
