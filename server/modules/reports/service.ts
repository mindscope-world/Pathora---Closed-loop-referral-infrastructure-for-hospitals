import { z } from 'zod';
import { EXPORT_LABELS, ROLE_LABELS, type ReportScheduleDto } from '../../../shared/types';
import type { Prisma, ReportSchedule } from '../../db/generated/client';
import { forOrg } from '../../db/tenant';
import { HttpError } from '../../lib/errors';
import type { AuthContext } from '../../types';
import { appendAudit } from '../audit/append';
import { nextRunAfter } from './schedule';

export const MAX_SCHEDULES_PER_ORG = 10;

export const createScheduleSchema = z.object({
  type: z.enum(['CASES_CSV', 'GOVERNANCE_CSV']),
  frequency: z.enum(['WEEKLY', 'MONTHLY']),
});
export const updateScheduleSchema = z.object({ enabled: z.boolean() });

const WHEN = { WEEKLY: 'every Monday', MONTHLY: 'on the 1st of each month' } as const;

export const toScheduleDto = (s: ReportSchedule, createdBy: string): ReportScheduleDto => ({
  id: s.id, type: s.type as ReportScheduleDto['type'], frequency: s.frequency, enabled: s.enabled,
  nextRunAt: s.nextRunAt.toISOString(), lastRunAt: s.lastRunAt?.toISOString() ?? null, createdBy,
});

const audit = (tx: unknown, auth: AuthContext, action: string, id: string, detail: string) =>
  appendAudit(tx as Prisma.TransactionClient, {
    orgId: auth.orgId, actorId: auth.userId, actorLabel: auth.name, actorRole: ROLE_LABELS[auth.role],
    action, resourceType: 'ReportSchedule', resourceId: id, detail,
  });

async function names(auth: AuthContext, ids: string[]) {
  const users = await forOrg(auth.orgId).user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

export async function listSchedules(auth: AuthContext): Promise<ReportScheduleDto[]> {
  const rows = await forOrg(auth.orgId).reportSchedule.findMany({ orderBy: { createdAt: 'asc' } });
  const who = await names(auth, rows.map((r) => r.createdById));
  return rows.map((r) => toScheduleDto(r, who.get(r.createdById) ?? 'Unknown user'));
}

export async function createSchedule(auth: AuthContext, input: z.infer<typeof createScheduleSchema>): Promise<ReportScheduleDto> {
  const row = await forOrg(auth.orgId).$transaction(async (tx) => {
    if ((await tx.reportSchedule.count()) >= MAX_SCHEDULES_PER_ORG) {
      throw new HttpError(409, 'TOO_MANY_SCHEDULES', `You can have up to ${MAX_SCHEDULES_PER_ORG} scheduled reports. Remove one first.`);
    }
    const created = await tx.reportSchedule.create({
      data: { orgId: auth.orgId, type: input.type, frequency: input.frequency, createdById: auth.userId, nextRunAt: nextRunAfter(input.frequency, new Date()) },
    });
    await audit(tx, auth, 'REPORT_SCHEDULE_CREATED', created.id, `Scheduled ${EXPORT_LABELS[input.type]} ${WHEN[input.frequency]}.`);
    return created;
  });
  return toScheduleDto(row, auth.name);
}

async function owned(auth: AuthContext, id: string) {
  const row = await forOrg(auth.orgId).reportSchedule.findFirst({ where: { id } });
  if (!row) throw HttpError.notFound('Scheduled report not found');
  return row;
}

export async function setScheduleEnabled(auth: AuthContext, id: string, enabled: boolean): Promise<ReportScheduleDto> {
  const row = await owned(auth, id);
  const updated = await forOrg(auth.orgId).$transaction(async (tx) => {
    // Turning a report back on must not fire for the time it was off: pick the next future run.
    const u = await tx.reportSchedule.update({
      where: { id },
      data: { enabled, ...(enabled && !row.enabled ? { nextRunAt: nextRunAfter(row.frequency, new Date()) } : {}) },
    });
    await audit(tx, auth, enabled ? 'REPORT_SCHEDULE_ENABLED' : 'REPORT_SCHEDULE_PAUSED', id, `${enabled ? 'Resumed' : 'Paused'} the scheduled ${EXPORT_LABELS[row.type]}.`);
    return u;
  });
  return toScheduleDto(updated, (await names(auth, [updated.createdById])).get(updated.createdById) ?? 'Unknown user');
}

export async function deleteSchedule(auth: AuthContext, id: string): Promise<void> {
  const row = await owned(auth, id);
  await forOrg(auth.orgId).$transaction(async (tx) => {
    await tx.reportSchedule.delete({ where: { id } });
    await audit(tx, auth, 'REPORT_SCHEDULE_DELETED', id, `Removed the scheduled ${EXPORT_LABELS[row.type]} (${WHEN[row.frequency]}).`);
  });
}
