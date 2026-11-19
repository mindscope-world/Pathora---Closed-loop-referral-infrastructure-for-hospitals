import type { ErrorRequestHandler, Request, Response } from 'express';
import { Router } from 'express';
import { parse } from 'csv-parse/sync';
import { ZodError } from 'zod';
import { z } from 'zod';
import { PATHWAY_LABELS } from '../../../shared/types';
import { prisma } from '../../db/client';
import { forOrg } from '../../db/tenant';
import { aad, decryptField } from '../../lib/crypto';
import { asyncHandler } from '../../lib/asyncHandler';
import { csvRow, CSV_BOM } from '../../lib/csv';
import { HttpError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { caseScope } from '../../middleware/tenant';
import { FHIR_CONTENT_TYPE, capabilityStatement, operationOutcome, searchBundle, toServiceRequest, type ReferralForFhir } from '../../integrations/fhir/serviceRequest';
import { parseTask, TaskMappingError, toTask, type StatusEvent } from '../../integrations/fhir/task';
import { applyStatusReturn } from '../../integrations/statusReturn';
import type { Prisma } from '../../db/generated/client';
import { appendAudit } from '../audit/append';
import { decodeCursor, encodeCursor } from '../cases/queries';
import { loadCase } from '../cases/service';
import { authenticateKey, failedKeyLimiter, jsonBody, perKeyLimiter, rawBody, requireSignature } from './keyAuth';

const ID = /^[A-Za-z0-9][A-Za-z0-9.-]{0,63}$/;
const PAGE_DEFAULT = 50;
const PAGE_MAX = 100;
const CSV_ROWS_MAX = 500;
const CSV_EXPORT_MAX = 5000;

const outcomeBody = z.object({ closureReason: z.string().trim().min(1, 'Describe the outcome').max(500), outcomeSource: z.string().trim().min(1).max(200).optional() });

/** Loads referrals for the key's facility, ready for FHIR/CSV output. */
async function referralsFor(req: Request, where: Prisma.ReferralCaseWhereInput, opts: { take: number; cursor?: string }) {
  const ctx = req.integration!;
  const auth = req.auth!;
  const identify = ctx.scopes.includes('referrals:identify');
  const rows = await forOrg(ctx.orgId).referralCase.findMany({
    where: { AND: [caseScope(auth), { isSynthetic: false }, where] },
    include: { patient: { select: { patientCode: true, nameEnc: true } }, facility: { select: { id: true, name: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: opts.take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, opts.take);
  const items: ReferralForFhir[] = page.map((r) => ({
    refNumber: r.refNumber, pathway: r.pathway, stage: r.stage, redFlag: r.redFlag, issuedAt: r.issuedAt, dueDate: r.dueDate, slaDueAt: r.slaDueAt,
    updatedAt: r.updatedAt, patientCode: r.patient.patientCode, facility: r.facility, organisationName: ctx.organisationName,
    ...(identify ? { patientName: decryptField(r.patient.nameEnc, aad.patientName(ctx.orgId)) } : {}),
  }));
  return { items, nextCursor: rows.length > opts.take ? encodeCursor(page[page.length - 1].id) : null, identified: identify && items.length > 0 };
}

/** Releasing patient names to a facility system is an access to personal data: it is recorded. */
async function auditIdentified(req: Request, count: number, what: string) {
  const ctx = req.integration!;
  await prisma.$transaction((tx) =>
    appendAudit(tx, {
      orgId: ctx.orgId, actorId: null, actorLabel: `API key "${ctx.keyName}"`, actorRole: 'Facility system (API)',
      action: 'REFERRALS_RELEASED_IDENTIFIED', resourceType: 'Facility', resourceId: ctx.facilityId,
      detail: `Released ${count} referral${count === 1 ? '' : 's'} with patient names to ${ctx.facilityName} (${what}).`,
    }),
  );
}

/** FHIR clients expect an OperationOutcome, not our JSON error envelope. */
const fhirErrors: ErrorRequestHandler = (err, req, res, next) => {
  let status = 500;
  let code = 'exception';
  let message = 'Internal error';
  if (err instanceof HttpError) {
    status = err.status;
    code = status === 401 || status === 403 ? 'security' : status === 404 ? 'not-found' : status === 409 ? 'conflict' : status === 429 ? 'throttled' : status === 422 || status === 400 ? 'invalid' : 'processing';
    message = err.message;
  } else if (err instanceof TaskMappingError || err instanceof ZodError) {
    status = 422;
    code = 'invalid';
    message = err instanceof TaskMappingError ? err.message : 'The request body is not valid';
  } else {
    logger.error({ err, requestId: req.id }, 'Unhandled integration error');
    return res.status(500).type(FHIR_CONTENT_TYPE).send(JSON.stringify(operationOutcome('error', 'exception', 'Internal error')));
  }
  void next;
  res.status(status).type(FHIR_CONTENT_TYPE).send(JSON.stringify(operationOutcome('error', code, message)));
};

const sendFhir = (res: Response, body: unknown, status = 200) => res.status(status).type(FHIR_CONTENT_TYPE).send(JSON.stringify(body));

export function integrationsRouter(opts: { maxFailedPerIp?: number; maxPerKey?: number } = {}): Router {
  const r = Router();
  r.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  r.use(failedKeyLimiter(opts.maxFailedPerIp ?? 30));

  // ── FHIR ──
  const fhir = Router();
  fhir.get('/metadata', (_req, res) => sendFhir(res, capabilityStatement())); // public by FHIR convention; describes, never exposes

  fhir.get('/ServiceRequest', authenticateKey('referrals:read'), perKeyLimiter(opts.maxPerKey ?? 300), asyncHandler(async (req, res) => {
    const status = req.query.status === 'completed' ? 'completed' : req.query.status === undefined || req.query.status === 'active' ? 'active' : null;
    if (!status) throw new HttpError(422, 'VALIDATION_ERROR', 'status must be "active" or "completed"');
    const count = Number(req.query._count ?? PAGE_DEFAULT);
    if (!Number.isInteger(count) || count < 1 || count > PAGE_MAX) throw new HttpError(422, 'VALIDATION_ERROR', `_count must be between 1 and ${PAGE_MAX}`);
    const cursor = typeof req.query._cursor === 'string' ? decodeCursor(req.query._cursor) : null;
    if (req.query._cursor && !cursor) throw new HttpError(422, 'VALIDATION_ERROR', 'Invalid _cursor');

    const { items, nextCursor, identified } = await referralsFor(req, { stage: status === 'completed' ? 'CLOSED' : { not: 'CLOSED' } }, { take: count, cursor: cursor ?? undefined });
    if (identified) await auditIdentified(req, items.length, 'FHIR search');
    const next = nextCursor ? `ServiceRequest?status=${status}&_count=${count}&_cursor=${nextCursor}` : undefined;
    sendFhir(res, searchBundle(items.map(toServiceRequest), { next }));
  }));

  fhir.get('/ServiceRequest/:ref', authenticateKey('referrals:read'), perKeyLimiter(opts.maxPerKey ?? 300), asyncHandler(async (req, res) => {
    if (!ID.test(req.params.ref)) throw HttpError.notFound('Referral not found');
    const { items, identified } = await referralsFor(req, { refNumber: req.params.ref }, { take: 1 });
    if (items.length === 0) throw HttpError.notFound('Referral not found');
    if (identified) await auditIdentified(req, 1, `ServiceRequest/${req.params.ref}`);
    sendFhir(res, toServiceRequest(items[0]));
  }));

  fhir.get('/Task/:ref', authenticateKey('referrals:read'), perKeyLimiter(opts.maxPerKey ?? 300), asyncHandler(async (req, res) => {
    if (!ID.test(req.params.ref)) throw HttpError.notFound('Referral not found');
    const row = await loadCase(forOrg(req.integration!.orgId), req.auth!, req.params.ref);
    sendFhir(res, toTask(row));
  }));

  fhir.post('/Task', authenticateKey('status:write'), perKeyLimiter(opts.maxPerKey ?? 300), requireSignature, asyncHandler(async (req, res) => {
    const task = parseTask(jsonBody(req));
    const result = await applyStatusReturn(req.auth!, { ref: task.ref, event: task.event, closureReason: task.closureReason });
    const row = await loadCase(forOrg(req.integration!.orgId), req.auth!, task.ref);
    sendFhir(res, toTask(row), result.result === 'applied' ? 201 : 200);
  }));
  fhir.use(fhirErrors);
  r.use('/fhir', fhir);

  // ── Plain JSON status return ──
  const step = (event: StatusEvent, path: string) =>
    r.post(`/referrals/:ref/${path}`, authenticateKey('status:write'), perKeyLimiter(opts.maxPerKey ?? 300), requireSignature, asyncHandler(async (req, res) => {
      if (!ID.test(req.params.ref)) throw HttpError.notFound('Referral not found');
      const body = event === 'CLOSED' ? outcomeBody.parse(jsonBody(req)) : {};
      res.json(await applyStatusReturn(req.auth!, { ref: req.params.ref, event, ...body }));
    }));
  step('ACKNOWLEDGED', 'acknowledge');
  step('ATTENDED', 'attendance');
  step('CLOSED', 'outcome');

  // ── CSV pull and upload ("Portal + CSV" facilities) ──
  r.get('/referrals.csv', authenticateKey('referrals:read'), perKeyLimiter(opts.maxPerKey ?? 300), asyncHandler(async (req, res) => {
    const { items, identified } = await referralsFor(req, { stage: { not: 'CLOSED' } }, { take: CSV_EXPORT_MAX });
    if (identified) await auditIdentified(req, items.length, 'CSV pull');
    const header = ['Referral ID', 'Patient Code', ...(identified ? ['Patient Name'] : []), 'Pathway', 'Referred On', 'Due Date', 'Priority', 'Status'];
    const lines = [csvRow(header)];
    for (const i of items) {
      lines.push(csvRow([i.refNumber, i.patientCode, ...(identified ? [i.patientName ?? ''] : []), PATHWAY_LABELS[i.pathway], i.issuedAt, i.dueDate, i.redFlag ? 'urgent' : 'routine', i.stage]));
    }
    res.type('text/csv; charset=utf-8').setHeader('Content-Disposition', 'attachment; filename="pathora-referrals.csv"');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(CSV_BOM + lines.join(''));
  }));

  r.post('/status-returns.csv', authenticateKey('status:write'), perKeyLimiter(opts.maxPerKey ?? 300), requireSignature, asyncHandler(async (req, res) => {
    let records: Record<string, string>[];
    try {
      records = parse(rawBody(req).toString('utf8'), {
        bom: true, columns: (h: string[]) => h.map((x) => x.trim().toLowerCase()), skip_empty_lines: true, trim: true, relax_column_count: false,
      });
    } catch {
      throw new HttpError(422, 'VALIDATION_ERROR', 'The file is not valid CSV (check quoting and that every row has the same number of columns)');
    }
    if (records.length === 0) throw new HttpError(422, 'VALIDATION_ERROR', 'The file has no rows');
    if (records.length > CSV_ROWS_MAX) throw new HttpError(422, 'VALIDATION_ERROR', `Send at most ${CSV_ROWS_MAX} rows per file`);
    const first = records[0];
    for (const col of ['referral id', 'status']) {
      if (!(col in first)) throw new HttpError(422, 'VALIDATION_ERROR', `Missing required column "${col}". Expected: Referral ID, Status, Closure Reason, Outcome Source`);
    }

    const results: Array<{ row: number; ref: string; result: 'applied' | 'already_recorded' | 'error'; message?: string }> = [];
    for (const [i, rec] of records.entries()) {
      const row = i + 2; // spreadsheet numbering: the header is row 1
      const ref = rec['referral id'] ?? '';
      const event = ({ ACKNOWLEDGED: 'ACKNOWLEDGED', ATTENDED: 'ATTENDED', CLOSED: 'CLOSED' } as Record<string, StatusEvent>)[(rec.status ?? '').toUpperCase()];
      try {
        if (!ID.test(ref)) throw HttpError.notFound('Referral not found');
        if (!event) throw new HttpError(422, 'VALIDATION_ERROR', 'Status must be ACKNOWLEDGED, ATTENDED or CLOSED');
        const out = await applyStatusReturn(req.auth!, { ref, event, closureReason: rec['closure reason'] || undefined, outcomeSource: rec['outcome source'] || undefined });
        results.push({ row, ref, result: out.result });
      } catch (err) {
        if (!(err instanceof HttpError)) {
          logger.error({ err, requestId: req.id }, 'Status-return row failed unexpectedly');
          results.push({ row, ref, result: 'error', message: 'Could not be processed' });
        } else {
          results.push({ row, ref, result: 'error', message: err.message });
        }
      }
    }
    const count = (k: string) => results.filter((x) => x.result === k).length;
    res.json({ summary: { rows: results.length, applied: count('applied'), alreadyRecorded: count('already_recorded'), failed: count('error') }, results });
  }));

  return r;
}
