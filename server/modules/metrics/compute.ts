import { FUNNEL_STEPS, type OverviewMetricsDto, type PathwayId, type PathwayMetricsDto } from '../../../shared/types';
import type { Stage } from '../../db/generated/client';
import { deriveStatus } from '../cases/sla';

/** The minimum a referral needs to be counted. Loaded without any patient data. */
export interface MetricRow {
  stage: Stage;
  pathway: PathwayId;
  facilityId: string;
  slaDueAt: Date;
  redFlag: boolean;
  issuedAt: Date;
  closedAt: Date | null;
  milestones: Array<{ type: string; occurredAt: Date }>;
}

const HOUR_MS = 3_600_000;
export const PATHWAY_ORDER: PathwayId[] = ['CANCER_SCREENING', 'NCD_SCREENING', 'MALE_REPRODUCTIVE_HEALTH', 'MATERNAL_CHILD_HEALTH'];

const at = (r: MetricRow, type: string) => r.milestones.find((m) => m.type === type)?.occurredAt;
const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const round1 = (n: number) => Math.round(n * 10) / 10;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return round1(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
}

/** Hours from issue to the acknowledgement milestone (a negative gap is bad data and is left out). */
export function hoursToAcknowledge(r: MetricRow): number | null {
  const ack = at(r, 'FACILITY_ACKNOWLEDGED');
  if (!ack) return null;
  const h = (ack.getTime() - (at(r, 'REFERRAL_ISSUED') ?? r.issuedAt).getTime()) / HOUR_MS;
  return h >= 0 ? h : null;
}

/** Hours from issue to the documented outcome, for closed referrals only. */
export function hoursToClose(r: MetricRow): number | null {
  if (r.stage !== 'CLOSED') return null;
  const end = at(r, 'OUTCOME_DOCUMENTED') ?? r.closedAt;
  if (!end) return null;
  const h = (end.getTime() - (at(r, 'REFERRAL_ISSUED') ?? r.issuedAt).getTime()) / HOUR_MS;
  return h >= 0 ? h : null;
}

/** Numbers for one set of referrals (the whole programme, one pathway, one facility…). */
export interface GroupSummary {
  referrals: number;
  acknowledged: number;
  attended: number;
  closedVerified: number;
  overdueSla: number;
  redFlags: number;
  medianHoursToAcknowledge: number | null;
  medianHoursToClose: number | null;
}

export function summariseGroup(rows: MetricRow[], now: Date): GroupSummary {
  const ackHours = rows.map(hoursToAcknowledge).filter((h): h is number => h !== null);
  const closeHours = rows.map(hoursToClose).filter((h): h is number => h !== null);
  return {
    referrals: rows.length,
    acknowledged: rows.filter((r) => at(r, 'FACILITY_ACKNOWLEDGED')).length,
    attended: rows.filter((r) => at(r, 'PATIENT_ATTENDED')).length,
    closedVerified: rows.filter((r) => r.stage === 'CLOSED').length,
    overdueSla: rows.filter((r) => status(r, now) === 'OVERDUE_SLA').length,
    redFlags: rows.filter((r) => r.redFlag).length,
    medianHoursToAcknowledge: median(ackHours),
    medianHoursToClose: median(closeHours),
  };
}

const status = (r: MetricRow, now: Date) =>
  deriveStatus({ stage: r.stage, hasAcknowledged: Boolean(at(r, 'FACILITY_ACKNOWLEDGED')), slaDueAt: r.slaDueAt }, now);

/**
 * The Overview screen's numbers. Pure, so the same rows and clock always give the same answer, and it is
 * tested against the formulas the screen used to compute in the browser.
 */
export function computeOverview(rows: MetricRow[], now: Date): OverviewMetricsDto {
  const total = rows.length;
  const withStatus = rows.map((r) => ({ r, s: status(r, now), acked: Boolean(at(r, 'FACILITY_ACKNOWLEDGED')) }));
  const open = withStatus.filter((x) => x.s !== 'CLOSED_VERIFIED');
  const closedVerified = total - open.length;

  const pending = open.filter(
    (x) => x.acked || x.r.stage === 'ACKNOWLEDGED' || x.r.stage === 'ATTENDED' || x.s === 'AWAITING_ACK' || x.s === 'OVERDUE_SLA',
  );

  const pathways: PathwayMetricsDto[] = PATHWAY_ORDER.map((pathway) => {
    const mine = withStatus.filter((x) => x.r.pathway === pathway);
    return {
      pathway,
      cases: mine.length,
      acknowledged: mine.filter((x) => x.acked).length,
      closedVerified: mine.filter((x) => x.s === 'CLOSED_VERIFIED').length,
    };
  });

  const ackHours = rows.map(hoursToAcknowledge).filter((h): h is number => h !== null);
  const closeHours = rows.map(hoursToClose).filter((h): h is number => h !== null);

  return {
    asOf: now.toISOString(),
    total,
    statusCounts: {
      active: withStatus.filter((x) => x.s === 'ACTIVE').length,
      awaitingAck: withStatus.filter((x) => x.s === 'AWAITING_ACK').length,
      overdueSla: withStatus.filter((x) => x.s === 'OVERDUE_SLA').length,
      closedVerified,
    },
    activeReferrals: open.length,
    pendingCareCompletions: pending.length,
    attendedAwaitingOutcome: open.filter((x) => at(x.r, 'PATIENT_ATTENDED')).length,
    completionRate: percent(closedVerified, total),
    funnel: FUNNEL_STEPS.map((step) => {
      const count = rows.filter((r) => step.stages.includes(r.stage)).length;
      return { key: step.key, label: step.label, count, percent: percent(count, total) };
    }),
    pathways,
    medianHoursToAcknowledge: median(ackHours),
    medianHoursToClose: median(closeHours),
    acknowledgedSample: ackHours.length,
    closedSample: closeHours.length,
  };
}

// ── East Africa Time (UTC+3, no daylight saving): "today" is a calendar day there, not in UTC. ──
const EAT_OFFSET_MS = 3 * HOUR_MS;
const DAY_MS = 24 * HOUR_MS;

/** The instant today began in East Africa Time. */
export function startOfDayEat(now: Date): Date {
  return new Date(Math.floor((now.getTime() + EAT_OFFSET_MS) / DAY_MS) * DAY_MS - EAT_OFFSET_MS);
}

/** "Due this week" = due today or within the next 7 calendar days (EAT). Upper bound is exclusive. */
export function upcomingWindow(now: Date): { from: Date; to: Date } {
  const from = startOfDayEat(now);
  return { from, to: new Date(from.getTime() + 8 * DAY_MS) };
}
