import { describe, expect, it } from 'vitest';
import { PATHWAY_LABELS, type CaseDto, type CaseStage, type CaseStatus, type FacilityDto, type PathwayId } from '../../shared/types';
import { formatDate, formatDateTime, toViewCase, toViewFacility } from './caseViewModel';

const dto = (over: Partial<CaseDto> = {}): CaseDto => ({
  id: 'REF-2026-0418', patientCode: 'PT-8841', patientName: 'Jane Wambui', patientLabel: 'Cohort NBO · F / 44',
  pathway: 'CANCER_SCREENING', sourceProgram: 'Nairobi Mobile', coordinator: { id: 'u1', name: 'Miriam Wanjiku' },
  facility: { id: 'f1', name: 'Kenyatta Referral Outpatient Desk' }, stage: 'HANDOFF_SENT', status: 'AWAITING_ACK',
  consentSms: true, consentWhatsApp: false, optedOut: false,
  createdAt: '2026-11-17T06:15:00.000Z', dueDate: '2026-11-23T21:00:00.000Z', slaDueAt: '2026-11-18T06:20:00.000Z',
  slaHoursRemaining: 18, redFlag: true, notes: 'n', closureReason: null, outcomeSource: null,
  milestones: { referralIssuedAt: '2026-11-17T06:20:00.000Z' }, version: 3, ...over,
});

describe('East Africa Time formatting', () => {
  it('renders UTC instants in Nairobi time (UTC+3) in the dashboard’s format', () => {
    expect(formatDateTime('2026-11-17T06:15:00.000Z')).toBe('2026-11-17 09:15');
    expect(formatDate('2026-11-17T06:15:00.000Z')).toBe('2026-11-17');
  });
  it('rolls the date over at 21:00 UTC (midnight in Nairobi) and never shows 24:00', () => {
    expect(formatDateTime('2026-11-17T21:00:00.000Z')).toBe('2026-11-18 00:00');
    expect(formatDateTime('2026-11-17T20:59:00.000Z')).toBe('2026-11-17 23:59');
    expect(formatDate('2026-11-23T21:00:00.000Z')).toBe('2026-11-24');
  });
});

describe('toViewCase', () => {
  it('maps ids, names and display strings', () => {
    const v = toViewCase(dto());
    expect(v).toMatchObject({
      id: 'REF-2026-0418', patientName: 'Jane Wambui', pathway: 'Cancer Screening', stage: 'Handoff Sent', status: 'Awaiting Ack',
      coordinator: 'Miriam Wanjiku', receivingFacility: 'Kenyatta Referral Outpatient Desk', createdAt: '2026-11-17 09:15',
      dueDate: '2026-11-24', slaHoursRemaining: 18, redFlag: true, consentSms: true, optedOut: false,
      coordinatorId: 'u1', facilityId: 'f1', version: 3,
    });
    expect(v.milestones.referralIssuedAt).toBe('2026-11-17 09:20');
    expect(v.milestones.facilityAcknowledgedAt).toBeUndefined();
  });

  it('every stage, status and pathway the API can send has a display value', () => {
    const stages: CaseStage[] = ['INTAKE', 'ASSIGNED', 'CONTACTED', 'HANDOFF_SENT', 'ACKNOWLEDGED', 'ATTENDED', 'ESCALATED', 'CLOSED'];
    const expectedStage = ['Intake', 'Assigned', 'Contacted', 'Handoff Sent', 'Acknowledged', 'Attended', 'Escalated', 'Closed'];
    expect(stages.map((stage) => toViewCase(dto({ stage })).stage)).toEqual(expectedStage);

    const statuses: CaseStatus[] = ['ACTIVE', 'AWAITING_ACK', 'OVERDUE_SLA', 'CLOSED_VERIFIED'];
    expect(statuses.map((status) => toViewCase(dto({ status })).status)).toEqual(['Active', 'Awaiting Ack', 'Overdue SLA', 'Closed Verified']);

    for (const pathway of Object.keys(PATHWAY_LABELS) as PathwayId[]) {
      expect(toViewCase(dto({ pathway })).pathway).toBe(PATHWAY_LABELS[pathway]);
    }
  });

  it('turns API nulls into the optional fields the views expect', () => {
    const open = toViewCase(dto());
    expect(open.closureReason).toBeUndefined();
    expect(open.outcomeSource).toBeUndefined();
    const closed = toViewCase(dto({ stage: 'CLOSED', status: 'CLOSED_VERIFIED', closureReason: 'Done', outcomeSource: 'Dr X', slaDueAt: null }));
    expect(closed).toMatchObject({ closureReason: 'Done', outcomeSource: 'Dr X' });
  });

  it('formats every milestone', () => {
    const v = toViewCase(dto({
      milestones: {
        referralIssuedAt: '2026-11-10T11:35:00.000Z', facilityAcknowledgedAt: '2026-11-10T15:10:00.000Z',
        patientAttendedAt: '2026-11-14T06:45:00.000Z', evaluationCompletedAt: '2026-11-14T08:00:00.000Z', outcomeDocumentedAt: '2026-11-14T12:20:00.000Z',
      },
    }));
    expect(v.milestones).toEqual({
      referralIssuedAt: '2026-11-10 14:35', facilityAcknowledgedAt: '2026-11-10 18:10', patientAttendedAt: '2026-11-14 09:45',
      evaluationCompletedAt: '2026-11-14 11:00', outcomeDocumentedAt: '2026-11-14 15:20',
    });
  });
});

describe('toViewFacility', () => {
  const f: FacilityDto = { id: 'f', name: 'N', type: 'FAITH_BASED', city: 'Nakuru', interopMethod: 'PORTAL_CSV', focalPerson: null, avgAckHours: 19.4 };
  it('maps enums and rounds the acknowledgment time', () => {
    expect(toViewFacility(f)).toMatchObject({ type: 'Faith-Based', interopMethod: 'Portal + CSV', avgAckHours: 19, focalPerson: '—' });
  });
  it('shows 0 until there is acknowledgment data, and keeps a named focal person', () => {
    expect(toViewFacility({ ...f, avgAckHours: null, focalPerson: 'Dr K' })).toMatchObject({ avgAckHours: 0, focalPerson: 'Dr K' });
  });
});
