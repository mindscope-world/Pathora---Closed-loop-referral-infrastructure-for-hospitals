import { z } from 'zod';
import { EXPORT_LABELS, ROLE_LABELS, type ExportJobDto } from '../../../shared/types';
import { can } from '../../../shared/permissions';
import { prisma } from '../../db/client';
import type { ExportJob, Prisma } from '../../db/generated/client';
import { forOrg } from '../../db/tenant';
import { HttpError } from '../../lib/errors';
import { compactStamp } from '../../lib/time';
import type { AuthContext } from '../../types';
import { appendAudit } from '../audit/append';
import { signDownloadToken } from './signedUrl';

/** Per organisation. Keeps one person from queueing unbounded work. */
export const MAX_ACTIVE_EXPORTS = 3;

const isoDate = z.string().trim().pipe(z.iso.datetime({ offset: true }));

export const createExportSchema = z
  .object({ type: z.enum(['CASES_CSV', 'AUDIT_CSV', 'GOVERNANCE_CSV']), from: isoDate.optional(), to: isoDate.optional() })
  .refine((v) => !v.from || !v.to || Date.parse(v.from) <= Date.parse(v.to), { message: 'The start date must not be after the end date', path: ['from'] });

export const FILE_PREFIX = { CASES_CSV: 'pathora-live-referrals', AUDIT_CSV: 'pathora-audit-trail', GOVERNANCE_CSV: 'pathora-programme-performance' } as const;

export function toExportDto(job: ExportJob, requestedByName: string, now: Date = new Date()): ExportJobDto {
  const downloadable = job.status === 'READY' && job.fileKey && (!job.expiresAt || job.expiresAt > now);
  return {
    id: job.id, type: job.type, status: job.status, fileName: job.fileName, requestedBy: requestedByName,
    requestedAt: job.createdAt.toISOString(), completedAt: job.completedAt?.toISOString() ?? null,
    expiresAt: job.expiresAt?.toISOString() ?? null, rowCount: job.rowCount, byteSize: job.byteSize,
    sha256: job.sha256, chainTip: job.chainTip, error: job.error,
    downloadUrl: downloadable ? `/api/exports/${job.id}/download?token=${signDownloadToken(job.id, job.orgId)}` : null,
  };
}

async function namesFor(auth: AuthContext, ids: string[]): Promise<Map<string, string>> {
  const users = await forOrg(auth.orgId).user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

/** Queues an export. Generation happens in the worker; the caller polls `getExport`. */
export async function requestExport(auth: AuthContext, input: z.infer<typeof createExportSchema>, kick: () => void): Promise<ExportJobDto> {
  const params = { ...(input.from ? { from: input.from } : {}), ...(input.to ? { to: input.to } : {}) };
  const job = await forOrg(auth.orgId).$transaction(async (tx) => {
    const active = await tx.exportJob.count({ where: { status: { in: ['PENDING', 'RUNNING'] } } });
    if (active >= MAX_ACTIVE_EXPORTS) {
      throw new HttpError(429, 'TOO_MANY_EXPORTS', 'Several exports are already being prepared. Please wait for one to finish.');
    }
    const created = await tx.exportJob.create({
      data: {
        orgId: auth.orgId, type: input.type, requestedBy: auth.userId, params: Object.keys(params).length ? params : undefined,
        fileName: `${FILE_PREFIX[input.type]}-${compactStamp()}.csv`,
      },
    });
    await appendAudit(tx as unknown as Prisma.TransactionClient, {
      orgId: auth.orgId, actorId: auth.userId, actorLabel: auth.name, actorRole: ROLE_LABELS[auth.role],
      action: 'EXPORT_REQUESTED', resourceType: 'Export', resourceId: created.id,
      detail: `Requested ${EXPORT_LABELS[input.type]}${input.from || input.to ? ` (${input.from ?? 'start'} to ${input.to ?? 'now'})` : ''}.`,
    });
    return created;
  });
  kick();
  return toExportDto(job, auth.name);
}

export async function listExports(auth: AuthContext, limit = 20): Promise<ExportJobDto[]> {
  const jobs = await forOrg(auth.orgId).exportJob.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  const names = await namesFor(auth, jobs.map((j) => j.requestedBy));
  return jobs.map((j) => toExportDto(j, names.get(j.requestedBy) ?? 'Unknown user'));
}

export async function getExport(auth: AuthContext, id: string): Promise<ExportJobDto> {
  const job = await forOrg(auth.orgId).exportJob.findFirst({ where: { id } });
  if (!job) throw HttpError.notFound('Export not found');
  return toExportDto(job, (await namesFor(auth, [job.requestedBy])).get(job.requestedBy) ?? 'Unknown user');
}

/** Resolves a verified download link to a job the original requester may still fetch; audits the download. */
export async function authoriseDownload(jobId: string, orgId: string) {
  const job = await prisma.exportJob.findFirst({ where: { id: jobId, orgId } });
  if (!job || job.status !== 'READY' || !job.fileKey || (job.expiresAt && job.expiresAt <= new Date())) {
    throw new HttpError(410, 'EXPORT_UNAVAILABLE', 'This export is no longer available. Request a new one.');
  }
  // The link was valid when issued; permissions may have changed since (deactivated, demoted).
  const user = await prisma.user.findFirst({ where: { id: job.requestedBy, orgId, active: true } });
  if (!user || !can(user.role, 'exports.create')) throw HttpError.forbidden();

  await prisma.$transaction((tx) =>
    appendAudit(tx, {
      orgId, actorId: user.id, actorLabel: user.name, actorRole: ROLE_LABELS[user.role],
      action: 'EXPORT_DOWNLOADED', resourceType: 'Export', resourceId: job.id,
      detail: `Downloaded ${EXPORT_LABELS[job.type]} (${job.fileName}).`,
    }),
  );
  return job;
}
