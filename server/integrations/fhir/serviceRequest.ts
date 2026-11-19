import { PATHWAY_LABELS, type PathwayId } from '../../../shared/types';

/**
 * FHIR R4 mapping for outbound referrals. This is an ADAPTER: it reads plain referral data and produces FHIR JSON,
 * and nothing in the core domain knows FHIR exists. Patients are identified by programme code only unless the
 * facility's key carries the `referrals:identify` scope (then the display name is added): the least data that
 * lets the facility do its job is the default.
 */
export const SYSTEMS = {
  referral: 'urn:pathora:referral',
  patientCode: 'urn:pathora:patient-code',
  facility: 'urn:pathora:facility',
  slaDueAt: 'https://pathora.example/fhir/StructureDefinition/sla-due-at',
} as const;

export const FHIR_CONTENT_TYPE = 'application/fhir+json; charset=utf-8';

export interface ReferralForFhir {
  refNumber: string;
  pathway: PathwayId;
  stage: string;
  redFlag: boolean;
  issuedAt: Date;
  dueDate: Date;
  slaDueAt: Date;
  updatedAt: Date;
  patientCode: string;
  /** Only passed when the key may identify patients. */
  patientName?: string;
  facility: { id: string; name: string };
  organisationName: string;
}

export function toServiceRequest(r: ReferralForFhir) {
  return {
    resourceType: 'ServiceRequest' as const,
    id: r.refNumber,
    meta: { lastUpdated: r.updatedAt.toISOString() },
    identifier: [{ system: SYSTEMS.referral, value: r.refNumber }],
    status: r.stage === 'CLOSED' ? 'completed' : 'active',
    intent: 'order',
    priority: r.redFlag ? 'urgent' : 'routine',
    code: { text: PATHWAY_LABELS[r.pathway] },
    subject: {
      identifier: { system: SYSTEMS.patientCode, value: r.patientCode },
      ...(r.patientName ? { display: r.patientName } : {}),
    },
    authoredOn: r.issuedAt.toISOString(),
    occurrenceDateTime: r.dueDate.toISOString(),
    requester: { display: r.organisationName },
    performer: [{ identifier: { system: SYSTEMS.facility, value: r.facility.id }, display: r.facility.name }],
    extension: r.stage === 'CLOSED' ? [] : [{ url: SYSTEMS.slaDueAt, valueDateTime: r.slaDueAt.toISOString() }],
  };
}

export type ServiceRequest = ReturnType<typeof toServiceRequest>;

export function searchBundle(resources: ServiceRequest[], opts: { next?: string } = {}) {
  return {
    resourceType: 'Bundle' as const,
    type: 'searchset',
    total: resources.length,
    link: opts.next ? [{ relation: 'next', url: opts.next }] : [],
    entry: resources.map((resource) => ({ fullUrl: `ServiceRequest/${resource.id}`, resource })),
  };
}

/** The server's description of itself, so a facility's FHIR client can discover what it may do. */
export function capabilityStatement() {
  return {
    resourceType: 'CapabilityStatement' as const,
    status: 'active',
    kind: 'instance',
    fhirVersion: '4.0.1',
    format: ['application/fhir+json'],
    software: { name: 'Pathora' },
    rest: [
      {
        mode: 'server',
        security: { description: 'Facility API key (Authorization: Bearer) on every request; POSTs also carry an X-Pathora-Signature HMAC.' },
        resource: [
          { type: 'ServiceRequest', interaction: [{ code: 'read' }, { code: 'search-type' }], searchParam: [{ name: 'status', type: 'token' }, { name: '_count', type: 'number' }] },
          { type: 'Task', interaction: [{ code: 'read' }, { code: 'create' }] },
        ],
      },
    ],
  };
}

export function operationOutcome(severity: 'error' | 'warning' | 'information', code: string, diagnostics: string) {
  return { resourceType: 'OperationOutcome' as const, issue: [{ severity, code, diagnostics }] };
}
