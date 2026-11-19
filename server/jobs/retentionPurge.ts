import { prisma } from '../db/client';
import { logger } from '../lib/logger';
import { recordJobRun } from '../lib/metrics';
import { erasePatientData } from '../modules/privacy/erase';

const DAY_MS = 86_400_000;
const BATCH_PER_ORG = 200;
export const RETENTION_ACTOR = { actorId: null, actorLabel: 'Retention job', actorRole: 'System' } as const;

export interface PurgeSummary {
  organisations: number;
  patientsErased: number;
  errors: number;
  /** Rows of short-lived technical data (login throttling, replay keys) removed. */
  housekeeping: number;
}

/**
 * Enforces each organisation's retention window (`retentionDays`). A person's personal data is erased once EVERY one
 * of their referrals has been closed for longer than the window: open or recently closed follow-up is never touched.
 * Uses the same erasure as a data-subject request, so the audit chain and programme statistics are unaffected.
 * Safe to run on several servers at once (the erasure itself is guarded) and repeatedly.
 */
export async function runRetentionPurge(now: Date = new Date()): Promise<PurgeSummary> {
  const summary: PurgeSummary = { organisations: 0, patientsErased: 0, errors: 0, housekeeping: 0 };

  for (const org of await prisma.organization.findMany({ select: { id: true, retentionDays: true } })) {
    summary.organisations++;
    const cutoff = new Date(now.getTime() - org.retentionDays * DAY_MS);
    const due = await prisma.patient.findMany({
      where: {
        orgId: org.id, erasedAt: null,
        // has referrals, and none is open or closed inside the window
        cases: { some: {}, none: { OR: [{ stage: { not: 'CLOSED' } }, { closedAt: null }, { closedAt: { gte: cutoff } }] } },
      },
      select: { id: true, orgId: true, patientCode: true },
      take: BATCH_PER_ORG,
    });
    for (const p of due) {
      try {
        const r = await prisma.$transaction((tx) => erasePatientData(tx, p, RETENTION_ACTOR, `retention window of ${org.retentionDays} days passed`, now));
        if (r.erased) summary.patientsErased++;
      } catch (err) {
        summary.errors++;
        logger.error({ err, patientCode: p.patientCode }, 'Retention purge could not erase a patient');
      }
    }
  }

  const a = await prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 7 * DAY_MS) } } });
  const b = await prisma.idempotencyKey.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 2 * DAY_MS) } } });
  summary.housekeeping = a.count + b.count;

  if (summary.patientsErased > 0) logger.info(summary, 'Retention purge erased personal data');
  return summary;
}

/** Starts the hourly purge (first run shortly after boot); returns a stop function. */
export function startRetentionPurge(intervalSeconds = 3600): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runRetentionPurge();
      recordJobRun('retention_purge', true);
    } catch (err) {
      recordJobRun('retention_purge', false);
      logger.error({ err }, 'Retention purge failed');
    } finally {
      running = false;
    }
  };
  const first = setTimeout(tick, 120_000);
  const timer = setInterval(tick, intervalSeconds * 1000);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
