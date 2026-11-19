import { CSV_BOM } from '../lib/csv';
import { EXPORT_LABELS, ROLE_LABELS, type ExportType } from '../../shared/types';
import { prisma } from '../db/client';
import { logger } from '../lib/logger';
import { getFileStore } from '../storage/fileStore';
import { appendAudit } from '../modules/audit/append';
import { generateAuditCsv, generateCasesCsv, generateGovernanceCsv, sinkFor, type ExportParams, type GenerateResult } from '../modules/exports/generators';

/**
 * Export generation, run as a small database-backed queue: the ExportJob table IS the queue.
 * Jobs are claimed with `FOR UPDATE SKIP LOCKED`, so several server instances can run this safely
 * without ever generating the same export twice, and nothing is lost if a process dies mid-job.
 */
export const FILE_RETENTION_DAYS = 7;
export const MAX_ATTEMPTS = 3;
/** A RUNNING job older than this is assumed to belong to a crashed worker. */
export const STALE_AFTER_MS = 10 * 60_000;
const POLL_MS = 5_000;
const DAY_MS = 86_400_000;

const GENERATORS: Record<ExportType, typeof generateCasesCsv> = {
  CASES_CSV: generateCasesCsv,
  AUDIT_CSV: generateAuditCsv,
  GOVERNANCE_CSV: generateGovernanceCsv,
};

/** Atomically takes the oldest PENDING job, or returns null. */
export async function claimNextJob(): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "ExportJob" SET status = 'RUNNING', "startedAt" = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM "ExportJob" WHERE status = 'PENDING'
      ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1
    )
    RETURNING id`;
  return rows[0]?.id ?? null;
}

export async function runExportJob(jobId: string): Promise<void> {
  const job = await prisma.exportJob.findUniqueOrThrow({ where: { id: jobId } });
  const requester = await prisma.user.findUnique({ where: { id: job.requestedBy }, select: { id: true, name: true, role: true } });
  // The audit trail names the person who asked for the export, flagged as performed by the job.
  const actor = {
    orgId: job.orgId, actorId: requester?.id ?? null, actorLabel: requester?.name ?? 'Unknown user',
    actorRole: requester ? `${ROLE_LABELS[requester.role]} (export job)` : 'System',
  };

  const store = getFileStore();
  const key = `${job.orgId}/${job.id}.csv`;
  const writer = await store.open(key);
  try {
    await writer.write(CSV_BOM);
    const now = new Date();
    const result: GenerateResult = await GENERATORS[job.type](
      { orgId: job.orgId, params: (job.params ?? {}) as ExportParams, now },
      sinkFor(writer.write),
    );
    const file = await writer.finish();

    await prisma.$transaction(async (tx) => {
      await tx.exportJob.update({
        where: { id: job.id },
        data: {
          status: 'READY', fileKey: key, rowCount: result.rowCount, byteSize: file.bytes, sha256: file.sha256,
          chainTip: result.chainTip ?? null, error: null, completedAt: new Date(), expiresAt: new Date(Date.now() + FILE_RETENTION_DAYS * DAY_MS),
        },
      });
      await appendAudit(tx, {
        ...actor, action: 'EXPORT_GENERATED', resourceType: 'Export', resourceId: job.id,
        detail: `Generated ${EXPORT_LABELS[job.type]} (${result.rowCount} rows, ${file.bytes} bytes, sha256 ${file.sha256.slice(0, 16)}…).`,
      });
    });
  } catch (err) {
    await writer.abort();
    logger.error({ err, jobId: job.id, type: job.type }, 'Export generation failed');
    await prisma.$transaction(async (tx) => {
      await tx.exportJob.update({
        where: { id: job.id },
        // User-safe text only; the cause is in the server log.
        data: { status: 'FAILED', error: 'The export could not be generated. Please try again.', completedAt: new Date() },
      });
      await appendAudit(tx, { ...actor, action: 'EXPORT_FAILED', resourceType: 'Export', resourceId: job.id, detail: `${EXPORT_LABELS[job.type]} could not be generated.` });
    });
  }
}

/** Runs queued jobs until none are left (or `max` have been processed). */
export async function processPending(max = 25): Promise<number> {
  let done = 0;
  while (done < max) {
    const id = await claimNextJob();
    if (!id) break;
    await runExportJob(id);
    done++;
  }
  return done;
}

/** Re-queues jobs a crashed worker left RUNNING (or fails them after too many attempts). */
export async function recoverStaleJobs(staleMs = STALE_AFTER_MS): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "ExportJob" SET
      status = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN 'FAILED'::"ExportStatus" ELSE 'PENDING'::"ExportStatus" END,
      error = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN 'Generation was interrupted. Please try again.' ELSE NULL END,
      "completedAt" = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN now() ELSE NULL END
    WHERE status = 'RUNNING' AND "startedAt" < ${new Date(Date.now() - staleMs)}`;
}

/** Deletes files past their retention period: exports contain patient data and must not accumulate. */
export async function expireOldExports(now: Date = new Date()): Promise<number> {
  const due = await prisma.exportJob.findMany({ where: { status: 'READY', expiresAt: { lt: now } }, select: { id: true, fileKey: true } });
  const store = getFileStore();
  for (const j of due) {
    if (j.fileKey) await store.remove(j.fileKey).catch((err) => logger.warn({ err, jobId: j.id }, 'Could not delete expired export file'));
    await prisma.exportJob.update({ where: { id: j.id }, data: { status: 'EXPIRED', fileKey: null } });
  }
  return due.length;
}

/** Starts the background loop; returns a function that stops it. */
export function startExportWorker(): () => void {
  let running = false;
  let tick = 0;
  const timer = setInterval(async () => {
    if (running) return; // never overlap runs
    running = true;
    try {
      await recoverStaleJobs();
      await processPending();
      if (tick++ % 12 === 0) await expireOldExports(); // roughly once a minute
    } catch (err) {
      logger.error({ err }, 'Export worker tick failed');
    } finally {
      running = false;
    }
  }, POLL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
