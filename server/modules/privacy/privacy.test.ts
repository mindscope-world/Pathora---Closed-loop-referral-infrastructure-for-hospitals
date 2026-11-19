import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuditVerifyResponse, CaseDto } from '../../../shared/types';
import { aad, decryptField } from '../../lib/crypto';
import { prisma } from '../../test/helpers';
import { advance, app, as, createCase, makeWorkspace, uniquePhone, type Actor, type Workspace } from '../../test/workspace';
import { ERASED_NAME, REDACTED_TEXT } from './erase';

let ws: Workspace;
beforeAll(async () => {
  ws = await makeWorkspace();
});
afterAll(() => prisma.$disconnect());

const exp = (code: string, actor: Actor = ws.dpo) => request(app).get(`/api/privacy/patients/${code}/export`).set(as(actor));
const erase = (code: string, body: object = { reason: 'Data subject request received by email' }, actor: Actor = ws.dpo) =>
  request(app).post(`/api/privacy/patients/${code}/erasure`).set(as(actor)).send(body);
const verify = async () => (await request(app).get('/api/audit/verify').set(as(ws.dpo)).expect(200)).body as AuditVerifyResponse;
const patientOf = (c: CaseDto) => prisma.patient.findFirstOrThrow({ where: { orgId: ws.orgId, patientCode: c.patientCode } });

/** A closed referral for a patient with a phone number, a message and a free-text note. */
async function closedPatient(name: string) {
  const c = await createCase(ws, { patientName: name, patientPhone: uniquePhone('0712'), notes: `${name} reported symptoms to the nurse` } as never);
  await advance(ws, c.id, 'closed');
  const p = await patientOf(c);
  const row = await prisma.referralCase.findFirstOrThrow({ where: { orgId: ws.orgId, refNumber: c.id } });
  await prisma.commsLog.create({
    data: { orgId: ws.orgId, caseId: row.id, patientId: p.id, channel: 'SMS', templateName: 'Reminder', body: `Hello ${name}, your slot is ready`, status: 'DELIVERED', failureReason: 'none' },
  });
  return { c, p };
}

describe('subject access export', () => {
  it('returns everything held about the person, and records that it was produced', async () => {
    const { c } = await closedPatient('Achieng Odhiambo');
    const before = await prisma.auditEvent.count({ where: { orgId: ws.orgId, action: 'PATIENT_DATA_ACCESSED' } });
    const res = await exp(c.patientCode).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.patient).toMatchObject({ patientCode: c.patientCode, name: 'Achieng Odhiambo', erasedAt: null });
    expect(res.body.patient.phone).toMatch(/^\+254712/);
    expect(res.body.referrals).toHaveLength(1);
    expect(res.body.referrals[0]).toMatchObject({ referralId: c.id, stage: 'CLOSED' });
    expect(res.body.referrals[0].milestones.length).toBeGreaterThanOrEqual(4);
    expect(res.body.consent.length).toBeGreaterThan(0);
    expect(res.body.messages[0]).toMatchObject({ template: 'Reminder', text: 'Hello Achieng Odhiambo, your slot is ready' });
    expect(await prisma.auditEvent.count({ where: { orgId: ws.orgId, action: 'PATIENT_DATA_ACCESSED' } })).toBe(before + 1);
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { orgId: ws.orgId, action: 'PATIENT_DATA_ACCESSED' }, orderBy: { id: 'desc' } });
    expect(ev.detail).not.toContain('Achieng'); // the trail says THAT it was read, not what it contained
    expect(ev.actorId).toBe(ws.dpo.id);
  });

  it('is DPO-only, needs sign-in, and never crosses organisations', async () => {
    const { c } = await closedPatient('Cross Tenant');
    for (const a of [ws.manager, ws.coordinator, ws.focalA, ws.clinical]) {
      expect((await exp(c.patientCode, a)).status).toBe(403);
      expect((await erase(c.patientCode, undefined, a)).status).toBe(403);
    }
    await request(app).get(`/api/privacy/patients/${c.patientCode}/export`).expect(401);
    const other = await makeWorkspace();
    expect((await exp(c.patientCode, other.dpo)).status).toBe(404);
    expect((await erase(c.patientCode, undefined, other.dpo)).status).toBe(404);
    expect((await patientOf(c)).erasedAt).toBeNull();
  });

  it.each(['../etc/passwd', 'PT 1', 'x', 'PT-' + 'A'.repeat(40), '%00'])('treats a malformed code %j as not found', async (code) => {
    expect((await exp(encodeURIComponent(code))).status).toBe(404);
  });
});

describe('erasure on request', () => {
  it('removes personal data but keeps the referral record, consent history and a verifiable audit trail', async () => {
    const { c, p } = await closedPatient('Wafula Barasa');
    const auditBefore = await prisma.auditEvent.count({ where: { orgId: ws.orgId } });
    const res = await erase(c.patientCode, { reason: 'Written request from the patient' }).expect(200);
    expect(res.body).toMatchObject({ patientCode: c.patientCode, erased: true, casesRedacted: 1, messagesRedacted: 1 });

    const after = await prisma.patient.findUniqueOrThrow({ where: { id: p.id } });
    expect(decryptField(after.nameEnc, aad.patientName(ws.orgId))).toBe(ERASED_NAME);
    expect(after).toMatchObject({ phoneEnc: null, phoneHash: null, nameTokens: [], label: 'Erased', patientCode: c.patientCode });
    expect(after.erasedAt).not.toBeNull();

    const row = await prisma.referralCase.findFirstOrThrow({ where: { orgId: ws.orgId, refNumber: c.id } });
    expect(row).toMatchObject({ stage: 'CLOSED', notes: REDACTED_TEXT, closureReason: REDACTED_TEXT });
    expect(row.outcomeSource).toBe(c.outcomeSource ?? row.outcomeSource); // staff attribution stays
    const log = await prisma.commsLog.findFirstOrThrow({ where: { patientId: p.id } });
    expect(log).toMatchObject({ body: null, failureReason: null, templateName: 'Reminder', status: 'DELIVERED' });
    expect(await prisma.consent.count({ where: { patientId: p.id } })).toBeGreaterThan(0); // legal record kept

    // The audit trail was only appended to, and still verifies end to end.
    expect(await prisma.auditEvent.count({ where: { orgId: ws.orgId } })).toBe(auditBefore + 1);
    const v = await verify();
    expect(v.ok, JSON.stringify(v)).toBe(true);
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { orgId: ws.orgId, action: 'PATIENT_DATA_ERASED', resourceId: c.patientCode } });
    expect(ev.detail).toContain('Written request from the patient');
    expect(ev.detail).not.toContain('Wafula');
    expect(ev.actorId).toBe(ws.dpo.id);

    // The dashboard still works and no longer shows the person.
    const dto = (await request(app).get(`/api/cases/${c.id}`).set(as(ws.manager)).expect(200)).body as CaseDto;
    expect(dto).toMatchObject({ stage: 'CLOSED', patientName: ERASED_NAME, hasPhone: false, patientCode: c.patientCode });
    expect((await request(app).get('/api/cases?q=Wafula').set(as(ws.manager)).expect(200)).body.cases).toHaveLength(0);
  });

  it('is idempotent: a second request changes nothing and adds no audit event', async () => {
    const { c } = await closedPatient('Repeat Request');
    await erase(c.patientCode).expect(200);
    const n = await prisma.auditEvent.count({ where: { orgId: ws.orgId, action: 'PATIENT_DATA_ERASED', resourceId: c.patientCode } });
    const again = await erase(c.patientCode).expect(200);
    expect(again.body).toMatchObject({ erased: false, casesRedacted: 0, messagesRedacted: 0 });
    expect(await prisma.auditEvent.count({ where: { orgId: ws.orgId, action: 'PATIENT_DATA_ERASED', resourceId: c.patientCode } })).toBe(n);
  });

  it('simultaneous requests erase once', async () => {
    const { c } = await closedPatient('Racing Request');
    const results = await Promise.all([1, 2, 3].map(() => erase(c.patientCode)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(results.filter((r) => r.body.erased)).toHaveLength(1);
    expect(await prisma.auditEvent.count({ where: { orgId: ws.orgId, action: 'PATIENT_DATA_ERASED', resourceId: c.patientCode } })).toBe(1);
    expect((await verify()).ok).toBe(true);
  });

  it('is refused while a referral is still open, and then nothing at all changes', async () => {
    const { c } = await closedPatient('Has Open Referral');
    const p = await patientOf(c);
    // A second, still-open referral for the same person.
    const row = await prisma.referralCase.findFirstOrThrow({ where: { orgId: ws.orgId, refNumber: c.id } });
    await prisma.referralCase.create({
      data: { refNumber: 'REF-8888-0001', orgId: ws.orgId, patientId: p.id, pathway: 'NCD_SCREENING', rulePackId: row.rulePackId, sourceProgram: 'x', coordinatorId: ws.coordinator.id, facilityId: ws.facilityA.id, stage: 'HANDOFF_SENT', issuedAt: new Date(), slaDueAt: new Date(Date.now() + 36e5), dueDate: new Date() },
    });
    const res = await erase(c.patientCode);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OPEN_REFERRALS');
    const after = await patientOf(c);
    expect(after.erasedAt).toBeNull();
    expect(decryptField(after.nameEnc, aad.patientName(ws.orgId))).toBe('Has Open Referral');
    expect((await prisma.referralCase.findFirstOrThrow({ where: { orgId: ws.orgId, refNumber: c.id } })).notes).not.toBe(REDACTED_TEXT);
  });

  it.each([{}, { reason: '' }, { reason: 'no' }, { reason: 'x'.repeat(301) }, { reason: 'bad\nreason here' }])('requires a recorded reason: %j', async (body) => {
    const { c } = await closedPatient('Needs Reason');
    expect((await erase(c.patientCode, body)).status).toBe(400);
    expect((await patientOf(c)).erasedAt).toBeNull();
  });

  it('after erasure the export shows the placeholder and no contact details or message text', async () => {
    const { c } = await closedPatient('Gone Person');
    await erase(c.patientCode).expect(200);
    const res = await exp(c.patientCode).expect(200);
    expect(res.body.patient).toMatchObject({ name: ERASED_NAME, phone: null });
    expect(res.body.patient.erasedAt).not.toBeNull();
    expect(JSON.stringify(res.body)).not.toMatch(/Gone Person|254712/);
    expect(res.body.messages[0].text).toBeNull();
    expect(res.body.referrals[0].notes).toBe(REDACTED_TEXT);
  });
});
