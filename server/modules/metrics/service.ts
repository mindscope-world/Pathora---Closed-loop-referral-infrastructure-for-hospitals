import type { OverviewMetricsDto, PathwayId, UpcomingMetricsDto } from '../../../shared/types';
import type { Prisma } from '../../db/generated/client';
import { forOrg } from '../../db/tenant';
import { caseScope } from '../../middleware/tenant';
import type { AuthContext } from '../../types';
import { caseInclude, toCaseDto } from '../cases/dto';
import { computeOverview, startOfDayEat, upcomingWindow, type MetricRow } from './compute';

/** Metrics never include rule-pack simulation cases, and a facility focal sees only their own facility. */
const baseWhere = (auth: AuthContext): Prisma.ReferralCaseWhereInput => ({ AND: [caseScope(auth), { isSynthetic: false }] });

export const metricRowSelect = {
  stage: true, pathway: true, facilityId: true, slaDueAt: true, redFlag: true, issuedAt: true, closedAt: true,
  milestones: { select: { type: true, occurredAt: true } },
} satisfies Prisma.ReferralCaseSelect;

export async function overviewMetrics(auth: AuthContext, now: Date): Promise<OverviewMetricsDto> {
  const rows = await forOrg(auth.orgId).referralCase.findMany({ where: baseWhere(auth), select: metricRowSelect });
  return computeOverview(rows as unknown as MetricRow[], now);
}

const UPCOMING_LIMIT = 10;

/**
 * Open referrals due in the next week, plus any acknowledged but not yet attended (the facility has
 * confirmed a slot, so it is "upcoming" however far off). Soonest first.
 */
export async function upcomingMetrics(auth: AuthContext, now: Date): Promise<UpcomingMetricsDto> {
  const { from, to } = upcomingWindow(now);
  const db = forOrg(auth.orgId);
  const where: Prisma.ReferralCaseWhereInput = {
    AND: [
      baseWhere(auth),
      { stage: { not: 'CLOSED' } },
      {
        OR: [
          { dueDate: { gte: from, lt: to } },
          { AND: [{ milestones: { some: { type: 'FACILITY_ACKNOWLEDGED' } } }, { milestones: { none: { type: 'PATIENT_ATTENDED' } } }] },
        ],
      },
    ],
  };
  const [count, rows] = await Promise.all([
    db.referralCase.count({ where }),
    db.referralCase.findMany({ where, orderBy: [{ dueDate: 'asc' }, { id: 'asc' }], take: UPCOMING_LIMIT, include: caseInclude }),
  ]);
  return { asOf: now.toISOString(), windowStart: startOfDayEat(now).toISOString(), count, cases: rows.map((r) => toCaseDto(r, now)) };
}

export type { PathwayId };
