import type { UserRole } from './types';

/**
 * Role → capability matrix. Single source of truth, shared by the API (which enforces it) and the
 * UI (which only uses it to hide controls the server would reject anyway). Derived from the access
 * scopes the UI shows for each role and the table in plan.md Phase 2.
 *
 * Row-level limits a role alone cannot express (a facility focal sees only their own facility's
 * referrals) are applied separately on the server by `caseScope`.
 */
const MANAGER: UserRole = 'PROGRAMME_MANAGER';
const COORDINATOR: UserRole = 'PROGRAMME_COORDINATOR';
const FACILITY: UserRole = 'FACILITY_FOCAL';
const CLINICAL: UserRole = 'CLINICAL_LEAD';
const DPO: UserRole = 'DPO';
const ALL: UserRole[] = [MANAGER, COORDINATOR, FACILITY, CLINICAL, DPO];

export const PERMISSIONS = {
  // Referral cases
  'cases.read': ALL, // facility focals: own facility only
  'cases.create': [MANAGER, COORDINATOR],
  'cases.import': [MANAGER, COORDINATOR],
  'cases.acknowledge': [FACILITY],
  'cases.attend': [FACILITY],
  'cases.close': [FACILITY],
  'cases.escalate': [MANAGER, COORDINATOR, CLINICAL],
  'cases.barrier': [MANAGER, COORDINATOR, CLINICAL],
  'cases.reassign': [MANAGER],
  // Patient communications & consent
  'comms.read': [MANAGER, COORDINATOR, CLINICAL, DPO],
  'comms.send': [MANAGER, COORDINATOR],
  // Message wording: staff draft it, the clinical lead approves it (nothing unapproved can be sent).
  'templates.manage': [MANAGER, COORDINATOR],
  'templates.approve': [CLINICAL],
  'consent.manage': [DPO],
  // Pathway rules
  'rulepacks.read': ALL,
  'rulepacks.edit': [CLINICAL],
  // Compliance
  'audit.read': [MANAGER, CLINICAL, DPO],
  'exports.create': [MANAGER, CLINICAL, DPO],
  // Administration
  'team.read': [MANAGER, CLINICAL, DPO],
  'team.manage': [MANAGER],
  'org.read': ALL,
  'org.manage': [MANAGER],
  'facilities.read': ALL,
  'facilities.manage': [MANAGER],
  'metrics.read': ALL,
  // Facility system credentials (API keys) for status-return and referral pull.
  'integrations.manage': [MANAGER],
} as const satisfies Record<string, readonly UserRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: UserRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly UserRole[]).includes(role);
}
