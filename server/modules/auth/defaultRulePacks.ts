import type { Pathway, RulePackStatus } from '../../db/generated/client';

/**
 * Starting rule packs for a newly created organisation, so the referral engine (Phase 3) has SLAs
 * to apply on day one. Values mirror the pilot defaults shown in the Pathway Rules screen; the
 * partner's clinical lead is expected to review and adjust them (each edit writes a new version).
 */
export const DEFAULT_RULE_PACKS: Array<{
  key: string; pathway: Pathway; name: string; status: RulePackStatus;
  ackSlaHours: number; contactSlaHours: number; evalTargetDays: number; redFlagRule: string; closureCriteria: string;
}> = [
  {
    key: 'RP-CANCER', pathway: 'CANCER_SCREENING', name: 'Cancer Screening Pathway', status: 'ACTIVE',
    ackSlaHours: 24, contactSlaHours: 12, evalTargetDays: 7,
    redFlagRule: 'Immediate human coordinator escalation if high-grade lesion signal unacknowledged > 24h.',
    closureCriteria: 'Authorized colposcopy, biopsy, or specialist evaluation documented by receiving facility.',
  },
  {
    key: 'RP-NCD', pathway: 'NCD_SCREENING', name: 'NCD Screening Pathway (Hypertension & Diabetes)', status: 'ACTIVE',
    ackSlaHours: 48, contactSlaHours: 24, evalTargetDays: 10,
    redFlagRule: 'Route severe hypertensive reading signals directly to human coordinator within 4 hours.',
    closureCriteria: 'Confirmatory clinic attendance and baseline care plan recorded.',
  },
  {
    key: 'RP-MALE', pathway: 'MALE_REPRODUCTIVE_HEALTH', name: 'Male Reproductive Health Pathway', status: 'CONFIGURED',
    ackSlaHours: 48, contactSlaHours: 24, evalTargetDays: 14,
    redFlagRule: 'Acute presentation flags route strictly to partner-approved emergency contact protocol.',
    closureCriteria: 'Private specialist evaluation completed and consented terminal status logged.',
  },
  {
    key: 'RP-MCH', pathway: 'MATERNAL_CHILD_HEALTH', name: 'Maternal & Child Health Pathway', status: 'COMING_SOON',
    ackSlaHours: 12, contactSlaHours: 6, evalTargetDays: 3,
    redFlagRule: 'Multi-level obstetric escalation rules under clinical review.',
    closureCriteria: 'Multi-tier facility handoff and maternal/neonatal evaluation documented.',
  },
];
