import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CaseDto, CommsLogDto, CommsLogResponse, SendMessageResponse } from '../../../shared/types';
import { processDue } from '../../jobs/messageWorker';
import { prisma } from '../../test/helpers';
import {
  DISCREET, app, approvedTemplate, as, createCase, makeWorkspace, mockProvider, resetClock, setSupportPhone, uniquePhone, useClock, daytime, type Actor, type Workspace,
} from '../../test/workspace';

const H = 3_600_000;
const phone = () => uniquePhone('0711');
let ws: Workspace;
let tpl: Awaited<ReturnType<typeof approvedTemplate>>;

beforeAll(async () => {
  ws = await makeWorkspace();
  await setSupportPhone(ws);
  tpl = await approvedTemplate(ws, { name: 'Follow-up (EN)' });
});
afterAll(() => prisma.$disconnect());
beforeEach(() => {
  useClock(daytime(10));
  mockProvider().reset();
});
afterEach(() => resetClock());

const send = (ref: string, body: object, actor: Actor = ws.coordinator) => request(app).post(`/api/cases/${ref}/messages`).set(as(actor)).send(body);
const sms = (ref: string, templateId = tpl.id, actor: Actor = ws.coordinator) => send(ref, { templateId, channel: 'SMS' }, actor);
const newCase = (over: object = {}, w: Workspace = ws) => createCase(w, { patientPhone: phone(), consentSms: true, ...over });
const audit = async (ref: string, w: Workspace = ws) => (await prisma.auditEvent.findMany({ where: { orgId: w.orgId, resourceId: ref }, orderBy: { id: 'asc' } }));
const notes = (ref: string, kind = 'HUMAN_FOLLOW_UP', w: Workspace = ws) => prisma.notification.findMany({ where: { orgId: w.orgId, caseRef: ref, kind } });
const log = async (id: string) => prisma.commsLog.findUniqueOrThrow({ where: { id } });
/** What the provider was actually asked to send for THIS case (the mock also sees other tests' messages when the worker runs). */
const sentFor = async (ref: string, w: Workspace = ws) => {
  const ids = (await prisma.commsLog.findMany({ where: { case: { orgId: w.orgId, refNumber: ref } }, select: { id: true } })).map((l) => l.id);
  return mockProvider().sent.filter((m) => ids.includes(m.reference));
};
const dpo = (ref: string, path: string, body: object, w: Workspace = ws) => request(app).put(`/api/cases/${ref}/${path}`).set(as(w.dpo)).send(body);

describe('queueing a message', () => {
  it('queues it (202), recording exactly what will be sent, but sends nothing yet', async () => {
    const c = await newCase({ facilityId: ws.facilityA.id });
    const res = await sms(c.id).expect(202);
    const body = res.body as SendMessageResponse;
    expect(body).toMatchObject({ accepted: true, message: 'Queued for delivery.', entry: { caseId: c.id, channel: 'SMS', templateName: 'Follow-up (EN)', status: 'QUEUED', attempts: 0, sentAt: null, failureReason: null } });
    expect(body.entry.scheduledFor).toBe(daytime(10).toISOString()); // allowed now

    const row = await log(body.entry.id);
    expect(row.body).toBe(`Hello, this is your care coordinator. Your follow-up slot is ready at ${ws.facilityA.name}. Reply 1 to confirm or call 0700 000 000 for support.`);
    expect(row.body).not.toMatch(/[{}]/); // every placeholder was filled
    expect(row.requestedAt.toISOString()).toBe(daytime(10).toISOString());
    expect(mockProvider().sent).toHaveLength(0);
  });

  it('is audited as the person who asked, without the number or the text', async () => {
    const c = await newCase({ patientName: 'Distinctive Person' });
    await sms(c.id).expect(202);
    const ev = (await audit(c.id)).find((e) => e.action === 'MESSAGE_QUEUED')!;
    expect(ev).toMatchObject({ actorId: ws.coordinator.id, actorLabel: 'Cora Coordinator' });
    expect(ev.detail).toBe('Queued SMS "Follow-up (EN)".');
    expect((await audit(c.id)).map((e) => `${e.actorLabel} ${e.detail}`).join(' ')).not.toMatch(/Distinctive|0711\d{6}|\+254711/);
  });

  it('the worker then delivers it exactly as recorded, to the normalised number', async () => {
    const number = phone();
    const c = await newCase({ patientPhone: number });
    const entry = ((await sms(c.id).expect(202)).body as SendMessageResponse).entry;
    expect(await processDue()).toBeGreaterThanOrEqual(1);
    const sent = mockProvider().sent.filter((m) => m.reference === entry.id);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: `+254${number.slice(1)}`, channel: 'SMS', text: (await log(entry.id)).body });
    const row = await log(entry.id);
    expect(row).toMatchObject({ status: 'SENT', attempts: 1 });
    expect(row.providerMessageId).toMatch(/^mock-/);
    expect(row.sentAt).toBeTruthy();
    const events = (await audit(c.id)).map((e) => e.action);
    expect(events).toEqual(['CASE_CREATED', 'MESSAGE_QUEUED', 'MESSAGE_SENT']);
    expect((await audit(c.id)).at(-1)).toMatchObject({ actorLabel: 'Messaging Service', actorRole: 'System' });
  });

  it('holds a message requested in quiet hours until 07:00, and releases it then', async () => {
    useClock(daytime(22, 30));
    const c = await newCase();
    const res = (await sms(c.id).expect(202)).body as SendMessageResponse;
    expect(res.message).toMatch(/outside sending hours.*07:00/);
    const release = new Date(daytime(7).getTime() + 24 * H); // 07:00 EAT the next day
    expect(res.entry.scheduledFor).toBe(release.toISOString());
    expect((await audit(c.id)).find((e) => e.action === 'MESSAGE_QUEUED')!.detail).toContain('held until 07:00');

    await processDue(50, daytime(23, 0));
    expect(await sentFor(c.id)).toHaveLength(0);                 // still night
    await processDue(50, new Date(release.getTime() - 1000));
    expect(await sentFor(c.id)).toHaveLength(0);                 // one second early
    await processDue(50, release);
    expect(await sentFor(c.id)).toHaveLength(1);                 // 07:00: released
  });

  it('a message in the small hours is released at 07:00 the SAME morning', async () => {
    useClock(daytime(3, 15));
    const c = await newCase();
    const res = (await sms(c.id).expect(202)).body as SendMessageResponse;
    expect(res.entry.scheduledFor).toBe(daytime(7).toISOString());
  });
});

describe('consent is enforced', () => {
  it('without SMS consent: nothing is sent, the refusal is recorded, and a person is told', async () => {
    const c = await newCase({ consentSms: false });
    const res = await sms(c.id).expect(200); // refused, but recorded
    const body = res.body as SendMessageResponse;
    expect(body).toMatchObject({ accepted: false, entry: { status: 'BLOCKED_OPTOUT', failureReason: 'No SMS consent is recorded for this patient.' } });
    expect(body.message).toMatch(/Nothing was sent.*contact the patient directly/);
    expect((await log(body.entry.id)).body).toBeNull(); // no text was ever prepared
    await processDue();
    expect(await sentFor(c.id)).toHaveLength(0);

    const ev = (await audit(c.id)).find((e) => e.action === 'MESSAGE_BLOCKED_OPTOUT')!;
    expect(ev).toMatchObject({ actorId: ws.coordinator.id });
    const [n] = await notes(c.id);
    expect(n).toMatchObject({ userId: ws.coordinator.id, title: `${c.id}: contact the patient directly` });
    expect(n.body).toContain('No SMS consent is recorded');
  });

  it('consent is PER CHANNEL: SMS consent does not allow WhatsApp', async () => {
    const wa = await approvedTemplate(ws, { name: 'Follow-up (WA)', channel: 'WHATSAPP' });
    const c = await newCase({ consentSms: true });
    const blocked = (await send(c.id, { templateId: wa.id, channel: 'WHATSAPP' }).expect(200)).body as SendMessageResponse;
    expect(blocked).toMatchObject({ accepted: false, entry: { status: 'BLOCKED_OPTOUT' } });
    expect(blocked.entry.failureReason).toContain('No WhatsApp consent');
    expect((await sms(c.id)).status).toBe(202); // SMS is still fine

    await dpo(c.id, 'consent', { channel: 'WHATSAPP', granted: true }).expect(200);
    expect((await send(c.id, { templateId: wa.id, channel: 'WHATSAPP' })).status).toBe(202);
  });

  it('an opt-out blocks every channel, and restoring consent re-enables only what was granted', async () => {
    const c = await newCase({ consentSms: true });
    await dpo(c.id, 'opt-out', { optedOut: true }).expect(200);
    const blocked = (await sms(c.id).expect(200)).body as SendMessageResponse;
    expect(blocked).toMatchObject({ accepted: false, entry: { status: 'BLOCKED_OPTOUT', failureReason: 'The patient has opted out of automated messages.' } });
    await dpo(c.id, 'opt-out', { optedOut: false }).expect(200);
    expect((await sms(c.id)).status).toBe(202);
  });

  it('a blocked attempt never reaches the provider, however many times it is retried', async () => {
    const c = await newCase({ consentSms: false });
    for (let i = 0; i < 5; i++) await sms(c.id).expect(200);
    await processDue();
    expect(await sentFor(c.id)).toHaveLength(0);
    expect(await prisma.commsLog.count({ where: { caseId: (await prisma.referralCase.findFirstOrThrow({ where: { orgId: ws.orgId, refNumber: c.id } })).id, status: 'BLOCKED_OPTOUT' } })).toBe(5);
  });
});

describe('reaching the patient', () => {
  it('no mobile number on file: handed to a person, not silently dropped', async () => {
    const c = await createCase(ws, { consentSms: true }); // consented, but no number
    const res = (await sms(c.id).expect(200)).body as SendMessageResponse;
    expect(res).toMatchObject({ accepted: false, entry: { status: 'HUMAN_ROUTED', failureReason: 'There is no mobile number on file for this patient.' } });
    expect((await audit(c.id)).map((e) => e.action)).toContain('MESSAGE_HUMAN_ROUTED');
    expect(await notes(c.id)).toHaveLength(1);
    await processDue();
    expect(await sentFor(c.id)).toHaveLength(0);
  });

  it('once a number is added the message can be sent', async () => {
    const c = await createCase(ws, { consentSms: true });
    await request(app).put(`/api/cases/${c.id}/contact`).set(as(ws.coordinator)).send({ phone: '0712 345 678' }).expect(200);
    expect((await sms(c.id)).status).toBe(202);
  });

  it('needs the support phone number if the template mentions {phone}', async () => {
    const w = await makeWorkspace(); // no support phone set
    const t = await approvedTemplate(w);
    const c = await createCase(w, { patientPhone: phone(), consentSms: true });
    const res = await send(c.id, { templateId: t.id, channel: 'SMS' }, w.coordinator);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SUPPORT_PHONE_REQUIRED');
    await setSupportPhone(w);
    expect((await send(c.id, { templateId: t.id, channel: 'SMS' }, w.coordinator)).status).toBe(202);
  });

  it('a template without {phone} does not need a support number', async () => {
    const w = await makeWorkspace();
    const t = await approvedTemplate(w, { body: 'Please visit {facility} for your follow-up when you can.' });
    const c = await createCase(w, { patientPhone: phone(), consentSms: true });
    expect((await send(c.id, { templateId: t.id, channel: 'SMS' }, w.coordinator)).status).toBe(202);
  });

  it('refuses a channel the provider cannot carry, by handing to a person', async () => {
    const { setProvider } = await import('../../messaging/provider');
    const { AfricasTalkingProvider } = await import('../../messaging/africastalking');
    setProvider(new AfricasTalkingProvider({ username: 'u', apiKey: 'k', fetchImpl: (async () => new Response('{}')) as never }));
    try {
      const wa = await approvedTemplate(ws, { name: 'WA via SMS provider', channel: 'WHATSAPP' });
      const c = await newCase();
      await dpo(c.id, 'consent', { channel: 'WHATSAPP', granted: true }).expect(200);
      const res = (await send(c.id, { templateId: wa.id, channel: 'WHATSAPP' }).expect(200)).body as SendMessageResponse;
      expect(res).toMatchObject({ accepted: false, entry: { status: 'HUMAN_ROUTED' } });
      expect(res.entry.failureReason).toMatch(/not available yet/);
    } finally {
      setProvider(undefined);
    }
  });
});

describe('which templates may be sent', () => {
  it('only approved ones', async () => {
    const draftT = (await request(app).post('/api/templates').set(as(ws.manager)).send({ name: `Draft ${Date.now()}`, pathway: null, channel: 'SMS', language: 'ENGLISH', body: DISCREET }).expect(201)).body;
    const c = await newCase();
    const res = await sms(c.id, draftT.id);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('TEMPLATE_NOT_APPROVED');
    expect((await sms(c.id, 'does-not-exist')).status).toBe(422);
  });

  it('not retired ones', async () => {
    const t = await approvedTemplate(ws);
    await request(app).post(`/api/templates/${t.id}/retire`).set(as(ws.manager)).expect(200);
    expect((await sms((await newCase()).id, t.id)).body.error.code).toBe('TEMPLATE_NOT_APPROVED');
  });

  it('whose channel and pathway match the request', async () => {
    const wa = await approvedTemplate(ws, { channel: 'WHATSAPP' });
    const ncd = await approvedTemplate(ws, { pathway: 'NCD_SCREENING' });
    const c = await newCase({ pathway: 'CANCER_SCREENING' });
    expect((await sms(c.id, wa.id)).body.error.code).toBe('CHANNEL_MISMATCH');
    expect((await sms(c.id, ncd.id)).body.error.code).toBe('PATHWAY_MISMATCH');
    expect((await sms((await newCase({ pathway: 'NCD_SCREENING' })).id, ncd.id)).status).toBe(202);
  });

  it('re-checks the wording at the moment of sending, so a template corrupted after approval is refused', async () => {
    const t = await approvedTemplate(ws);
    await prisma.messageTemplate.update({ where: { id: t.id }, data: { body: 'Your HIV result is ready at {facility}' } });
    const res = await sms((await newCase()).id, t.id);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('TEMPLATE_NOT_PERMITTED');
  });

  it('refuses a finished message that is too long once the facility name is filled in', async () => {
    const w = await makeWorkspace();
    await setSupportPhone(w);
    const long = await prisma.facility.update({ where: { id: w.facilityA.id }, data: { name: 'F'.repeat(160) } });
    const t = await approvedTemplate(w, { body: `${'a'.repeat(290)} {facility} {facility}` }); // 312 chars written, ~610 once the name is filled in twice
    const c = await createCase(w, { patientPhone: phone(), consentSms: true, facilityId: long.id });
    const res = await send(c.id, { templateId: t.id, channel: 'SMS' }, w.coordinator);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('MESSAGE_TOO_LONG');
  });
});

describe('limits', () => {
  it('stops at 3 automated messages per patient in 24 hours, then allows more once the window passes', async () => {
    const c = await newCase();
    for (let i = 0; i < 3; i++) await sms(c.id).expect(202);
    const fourth = await sms(c.id);
    expect(fourth.status).toBe(429);
    expect(fourth.body.error.code).toBe('MESSAGE_RATE_LIMITED');
    expect(fourth.body.error.message).toMatch(/3 messages/);
    useClock(new Date(daytime(10).getTime() + 25 * H));
    expect((await sms(c.id)).status).toBe(202);
  });

  it('refused attempts do not use up the allowance', async () => {
    const c = await newCase({ consentSms: false });
    for (let i = 0; i < 4; i++) await sms(c.id).expect(200); // four blocked attempts
    await dpo(c.id, 'consent', { channel: 'SMS', granted: true }).expect(200);
    for (let i = 0; i < 3; i++) await sms(c.id).expect(202); // all three real sends still available
  });

  it('holds under concurrency: six simultaneous requests yield exactly three', async () => {
    const c = await newCase();
    const results = await Promise.all(Array.from({ length: 6 }, () => sms(c.id)));
    expect(results.filter((r) => r.status === 202)).toHaveLength(3);
    expect(results.filter((r) => r.status === 429)).toHaveLength(3);
  });

  it('is per patient, not per organisation', async () => {
    const [a, b] = [await newCase(), await newCase()];
    for (let i = 0; i < 3; i++) await sms(a.id).expect(202);
    expect((await sms(a.id)).status).toBe(429);
    expect((await sms(b.id)).status).toBe(202);
  });
});

describe('other rules', () => {
  it('a closed referral is not messaged', async () => {
    const c = await newCase();
    await request(app).post(`/api/cases/${c.id}/acknowledge`).set(as(ws.focalA)).send({}).expect(200);
    await request(app).post(`/api/cases/${c.id}/attendance`).set(as(ws.focalA)).send({}).expect(200);
    await request(app).post(`/api/cases/${c.id}/close`).set(as(ws.focalA)).send({ closureReason: 'Care plan documented' }).expect(200);
    const res = await sms(c.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CASE_CLOSED');
  });

  it('a double-click with an Idempotency-Key queues one message', async () => {
    const c = await newCase();
    const post = () => request(app).post(`/api/cases/${c.id}/messages`).set(as(ws.coordinator)).set('Idempotency-Key', `msg-key-${c.id}`).send({ templateId: tpl.id, channel: 'SMS' });
    const [a, b] = [await post().expect(202), await post().expect(202)];
    expect(b.body.entry.id).toBe(a.body.entry.id);
    expect(await prisma.commsLog.count({ where: { case: { refNumber: c.id } } })).toBe(1);
  });

  it('only a manager or coordinator may send, within their own organisation', async () => {
    const c = await newCase();
    for (const a of [ws.manager, ws.coordinator]) expect((await sms((await newCase()).id, tpl.id, a)).status, a.name).toBe(202);
    for (const a of [ws.focalA, ws.dpo, ws.clinical]) expect((await sms(c.id, tpl.id, a)).status, a.name).toBe(403);
    expect((await request(app).post(`/api/cases/${c.id}/messages`).send({ templateId: tpl.id, channel: 'SMS' })).status).toBe(401);
    const other = await makeWorkspace();
    expect((await sms(c.id, tpl.id, other.manager)).status).toBe(404);
    expect((await sms('REF-2026-9999', tpl.id)).status).toBe(404);
    expect((await send(c.id, { templateId: tpl.id, channel: 'VOICE' })).status).toBe(400);
  });
});

describe('contact number', () => {
  const put = (ref: string, phone: string | null, actor: Actor = ws.coordinator) => request(app).put(`/api/cases/${ref}/contact`).set(as(actor)).send({ phone });

  it.each(['0712345678', '0712 345 678', '+254712345678', '254712345678', '712345678'])('accepts %s and stores one canonical number', async (raw) => {
    const c = await createCase(ws);
    expect((await put(c.id, raw).expect(200)).body).toEqual({ hasPhone: true });
    const p = await prisma.patient.findFirstOrThrow({ where: { orgId: ws.orgId, cases: { some: { refNumber: c.id } } } });
    const { decryptField, aad } = await import('../../lib/crypto');
    const { phoneHash } = await import('../../lib/phone');
    expect(decryptField(p.phoneEnc!, aad.patientPhone(ws.orgId))).toBe('+254712345678');
    expect(p.phoneHash).toBe(phoneHash('+254712345678'));
  });

  it('is stored encrypted, shown only as "a number is on file", and never audited', async () => {
    const c = await createCase(ws, { patientName: 'Phone Person' });
    await put(c.id, '0733 555 666').expect(200);
    const p = await prisma.patient.findFirstOrThrow({ where: { orgId: ws.orgId, cases: { some: { refNumber: c.id } } } });
    expect(Buffer.from(p.phoneEnc!).includes(Buffer.from('733555666'))).toBe(false);
    const dto = (await request(app).get(`/api/cases/${c.id}`).set(as(ws.manager)).expect(200)).body as CaseDto;
    expect(dto.hasPhone).toBe(true);
    expect(JSON.stringify(dto)).not.toMatch(/733555666|\+254733/);
    const ev = (await audit(c.id)).find((e) => e.action === 'PATIENT_CONTACT_UPDATED')!;
    expect(ev.detail).toBe('Patient mobile number added.');
  });

  it('can be changed and removed; removal clears the lookup hash too', async () => {
    const c = await createCase(ws);
    await put(c.id, '0712111222').expect(200);
    await put(c.id, '0712333444').expect(200);
    expect((await audit(c.id)).filter((e) => e.action === 'PATIENT_CONTACT_UPDATED').map((e) => e.detail)).toEqual(['Patient mobile number added.', 'Patient mobile number changed.']);
    expect((await put(c.id, null).expect(200)).body).toEqual({ hasPhone: false });
    const p = await prisma.patient.findFirstOrThrow({ where: { orgId: ws.orgId, cases: { some: { refNumber: c.id } } } });
    expect(p).toMatchObject({ phoneEnc: null, phoneHash: null });
    expect(((await request(app).get(`/api/cases/${c.id}`).set(as(ws.manager))).body as CaseDto).hasPhone).toBe(false);
  });

  it.each(['abc', '12345', '0202345678', '+25471234567'])('rejects %j with a field-level message', async (raw) => {
    const res = await put((await createCase(ws)).id, raw);
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: 'phone', message: expect.stringMatching(/valid mobile number/) }]);
  });

  it('can be set when the referral is created, and a bad number rejects the whole request', async () => {
    const c = await createCase(ws, { patientPhone: '0712 000 111' });
    expect(c.hasPhone).toBe(true);
    const bad = await request(app).post('/api/cases').set(as(ws.coordinator)).send({ patientName: 'X Y', pathway: 'CANCER_SCREENING', sourceProgram: 's', coordinatorId: ws.coordinator.id, facilityId: ws.facilityA.id, patientPhone: 'nope' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details[0].path).toBe('patientPhone');
  });

  it('can be supplied in a CSV import, and an invalid number rejects just that row', async () => {
    const csv = [
      `PH-1,c,Cancer Screening,Src,Cora Coordinator,${ws.facilityA.name},Pat One,0712 777 888`,
      `PH-2,c,Cancer Screening,Src,Cora Coordinator,${ws.facilityA.name},Pat Two,not-a-number`,
      `PH-3,c,Cancer Screening,Src,Cora Coordinator,${ws.facilityA.name},Pat Three,`,
    ].join('\n');
    const res = await request(app).post('/api/cases/import').set(as(ws.coordinator)).send({ csv, consentAttested: true }).expect(201);
    expect(res.body).toMatchObject({ imported: 2, rejected: 1 });
    expect(res.body.rows[1].error).toMatch(/Invalid mobile number/);
    const byCode = async (code: string) => (await prisma.patient.findFirstOrThrow({ where: { orgId: ws.orgId, patientCode: code } })).phoneEnc !== null;
    expect(await byCode('PH-1')).toBe(true);
    expect(await byCode('PH-3')).toBe(false);
  });

  it('only a manager or coordinator may change it, and only within their organisation', async () => {
    const c = await createCase(ws);
    for (const a of [ws.focalA, ws.dpo, ws.clinical]) expect((await put(c.id, '0712111222', a)).status, a.name).toBe(403);
    expect((await put(c.id, '0712111222', (await makeWorkspace()).manager)).status).toBe(404);
  });
});

describe('channel consent (Data Protection Contact)', () => {
  it('records and withdraws consent per channel, append-only, and audits it', async () => {
    const c = await createCase(ws, { consentSms: false });
    const get = async () => (await request(app).get(`/api/cases/${c.id}`).set(as(ws.manager)).expect(200)).body as CaseDto;
    expect(await get()).toMatchObject({ consentSms: false, consentWhatsApp: false });
    expect(((await dpo(c.id, 'consent', { channel: 'SMS', granted: true }).expect(200)).body as CaseDto)).toMatchObject({ consentSms: true, consentWhatsApp: false });
    await dpo(c.id, 'consent', { channel: 'SMS', granted: false }).expect(200);
    expect(await get()).toMatchObject({ consentSms: false });
    await dpo(c.id, 'consent', { channel: 'SMS', granted: true }).expect(200);
    expect(await get()).toMatchObject({ consentSms: true }); // the NEWEST row wins
    const pid = (await prisma.referralCase.findFirstOrThrow({ where: { orgId: ws.orgId, refNumber: c.id } })).patientId;
    expect(await prisma.consent.count({ where: { patientId: pid, channel: 'SMS' } })).toBe(3);
    expect((await audit(c.id)).filter((e) => e.action === 'CONSENT_UPDATED').map((e) => e.detail)).toEqual([
      'SMS consent recorded as granted.', 'SMS consent recorded as withdrawn.', 'SMS consent recorded as granted.',
    ]);
  });

  it('repeating the current state writes nothing', async () => {
    const c = await createCase(ws, { consentSms: true });
    await dpo(c.id, 'consent', { channel: 'SMS', granted: true }).expect(200);
    const pid = (await prisma.referralCase.findFirstOrThrow({ where: { orgId: ws.orgId, refNumber: c.id } })).patientId;
    expect(await prisma.consent.count({ where: { patientId: pid } })).toBe(1);
    expect((await audit(c.id)).filter((e) => e.action === 'CONSENT_UPDATED')).toHaveLength(0);
  });

  it('cannot grant consent while the patient is opted out', async () => {
    const c = await createCase(ws, { consentSms: true });
    await dpo(c.id, 'opt-out', { optedOut: true }).expect(200);
    const res = await dpo(c.id, 'consent', { channel: 'WHATSAPP', granted: true });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OPTED_OUT');
    expect((await dpo(c.id, 'consent', { channel: 'SMS', granted: false })).status).toBe(200); // withdrawing is always allowed
  });

  it('is restricted to the DPO, and validates the body', async () => {
    const c = await createCase(ws);
    for (const a of [ws.manager, ws.coordinator, ws.clinical, ws.focalA]) {
      expect((await request(app).put(`/api/cases/${c.id}/consent`).set(as(a)).send({ channel: 'SMS', granted: true })).status, a.name).toBe(403);
    }
    expect((await dpo(c.id, 'consent', { channel: 'VOICE', granted: true })).status).toBe(400);
    expect((await dpo(c.id, 'consent', { channel: 'SMS' })).status).toBe(400);
  });
});

describe('GET /api/comms-log', () => {
  it('lists what was sent and what became of it, newest first, with only safe fields', async () => {
    const w = await makeWorkspace();
    await setSupportPhone(w);
    const t = await approvedTemplate(w);
    const c = await createCase(w, { patientPhone: phone(), consentSms: true });
    const one = (await send(c.id, { templateId: t.id, channel: 'SMS' }, w.coordinator).expect(202)).body.entry as CommsLogDto;
    await processDue();
    const two = (await send(c.id, { templateId: t.id, channel: 'SMS' }, w.coordinator).expect(202)).body.entry as CommsLogDto;

    const res = (await request(app).get('/api/comms-log').set(as(w.manager)).expect(200)).body as CommsLogResponse;
    expect(res.entries.map((e) => e.id)).toEqual([two.id, one.id]);
    expect(res.entries[1]).toMatchObject({ status: 'SENT', attempts: 1, caseId: c.id, patientCode: expect.stringMatching(/^PT-/) });
    expect(Object.keys(res.entries[0]).sort()).toEqual(['attempts', 'caseId', 'channel', 'failureReason', 'id', 'patientCode', 'requestedAt', 'scheduledFor', 'sentAt', 'status', 'templateName']);
    expect(JSON.stringify(res)).not.toMatch(/Hello, this is|providerMessageId|\+254/); // neither the text nor the number
  });

  it('filters by case, paginates, and is limited to roles that may see communications', async () => {
    const w = await makeWorkspace();
    await setSupportPhone(w);
    const t = await approvedTemplate(w);
    const [a, b] = [await createCase(w, { patientPhone: phone(), consentSms: true }), await createCase(w, { patientPhone: phone(), consentSms: true })];
    for (const c of [a, a, b]) await send(c.id, { templateId: t.id, channel: 'SMS' }, w.coordinator).expect(202);
    const only = (await request(app).get(`/api/comms-log?caseId=${a.id}`).set(as(w.manager)).expect(200)).body as CommsLogResponse;
    expect(only.entries).toHaveLength(2);
    const p1 = (await request(app).get('/api/comms-log?limit=2').set(as(w.manager)).expect(200)).body as CommsLogResponse;
    const p2 = (await request(app).get(`/api/comms-log?limit=2&cursor=${p1.nextCursor}`).set(as(w.manager)).expect(200)).body as CommsLogResponse;
    expect([...p1.entries, ...p2.entries]).toHaveLength(3);
    expect(p2.nextCursor).toBeNull();
    for (const x of [w.manager, w.coordinator, w.clinical, w.dpo]) expect((await request(app).get('/api/comms-log').set(as(x))).status, x.name).toBe(200);
    expect((await request(app).get('/api/comms-log').set(as(w.focalA))).status).toBe(403);
    expect((await request(app).get('/api/comms-log?caseId=bad')).status).toBe(401);
    expect((await request(app).get('/api/comms-log').set(as((await makeWorkspace()).manager)).expect(200)).body.entries).toEqual([]);
  });
});
