import { can } from '../../shared/permissions';
import { EXPORT_LABELS, ROLE_LABELS } from '../../shared/types';
import { prisma } from '../db/client';
import { recordJobRun } from '../lib/metrics';
import { logger } from '../lib/logger';
import { compactStamp } from '../lib/time';
import { appendAudit } from '../modules/audit/append';
import { FILE_PREFIX } from '../modules/exports/service';
import { nextRunAfter, periodFor } from '../modules/reports/schedule';

/**
 * Queues the exports that scheduled reports are due for. The report itself is an ordinary ExportJob, so the
 * existing worker generates it and it appears in the owner's export list with the usual signed download link.
 *
 * Safe to run on several servers at once: a schedule is claimed by moving `nextRunAt` forward with a
 * compare-and-set, and only the instance whose update matched queues the job. If the server was down for
 * several periods, ONE catch-up report is produced (for the most recent period), not a backlog.
 */
type DueSchedule = Awaited<ReturnType<typeof findDue>>[number];
const findDue = (now: Date) => prisma.reportSchedule.findMany({ where: { enabled: true, nextRunAt: { lte: now } }, include: { createdBy: true } });

/**
 * Handles one schedule from a snapshot read earlier (which another server may since have acted on). Returns true
 * only if THIS call queued the report; false if someone else already had, or the owner lost access.
 */
export async function queueScheduledReport(s: DueSchedule, now: Date): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.reportSchedule.updateMany({
      where: { id: s.id, enabled: true, nextRunAt: s.nextRunAt },
      data: { lastRunAt: now, nextRunAt: nextRunAfter(s.frequency, now) },
    });
    if (claimed.count === 0) return false; // another instance got it

    const owner = s.createdBy;
    if (!owner.active || !can(owner.role, 'exports.create')) {
      // The person who scheduled it can no longer ask for exports: stop rather than produce files in their name.
      await tx.reportSchedule.update({ where: { id: s.id }, data: { enabled: false } });
      await appendAudit(tx, {
        orgId: s.orgId, actorId: null, actorLabel: 'Report scheduler', actorRole: 'System',
        action: 'REPORT_SCHEDULE_PAUSED', resourceType: 'ReportSchedule', resourceId: s.id,
        detail: `Paused the scheduled ${EXPORT_LABELS[s.type]}: ${owner.name} no longer has access to exports.`,
      });
      return false;
    }

    // Cohort = referrals issued in the period that just ended, counted from the run that was due.
    const { from, to } = periodFor(s.frequency, s.nextRunAt);
    const job = await tx.exportJob.create({
      data: {
        orgId: s.orgId, type: s.type, requestedBy: owner.id, params: { from: from.toISOString(), to: to.toISOString() },
        fileName: `${FILE_PREFIX[s.type as keyof typeof FILE_PREFIX]}-${s.frequency.toLowerCase()}-${compactStamp(now)}.csv`,
      },
    });
    await appendAudit(tx, {
      orgId: s.orgId, actorId: owner.id, actorLabel: owner.name, actorRole: `${ROLE_LABELS[owner.role]} (scheduled report)`,
      action: 'EXPORT_REQUESTED', resourceType: 'Export', resourceId: job.id,
      detail: `Scheduled ${s.frequency.toLowerCase()} run of ${EXPORT_LABELS[s.type]} (${from.toISOString()} to ${to.toISOString()}).`,
    });
    return true;
  });
}

export async function runReportScheduler(now: Date = new Date()): Promise<number> {
  let queued = 0;
  for (const s of await findDue(now)) {
    try {
      if (await queueScheduledReport(s, now)) queued++;
    } catch (err) {
      // One schedule failing must not stop the others; it stays due and is retried on the next tick.
      logger.error({ err, scheduleId: s.id }, 'Could not queue a scheduled report');
    }
  }
  if (queued > 0) logger.info({ queued }, 'Queued scheduled reports');
  return queued;
}

/** Starts the periodic check (every minute is plenty for weekly/monthly reports); returns a stop function. */
export function startReportScheduler(intervalSeconds = 60): () => void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runReportScheduler();
      recordJobRun('report_scheduler', true);
    } catch (err) {
      recordJobRun('report_scheduler', false);
      logger.error({ err }, 'Report scheduler tick failed');
    } finally {
      running = false;
    }
  }, intervalSeconds * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
