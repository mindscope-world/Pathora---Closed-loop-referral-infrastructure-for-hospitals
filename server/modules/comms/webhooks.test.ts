import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CaseDto, SendMessageResponse } from '../../../shared/types';
import { processDue } from '../../jobs/messageWorker';
import { prisma } from '../../test/helpers';
import { app, approvedTemplate, as, createCase, daytime, makeWorkspace, mockProvider, resetClock, setSupportPhone, uniquePhone, useClock, type Workspace } from '../../test/workspace';

const SECRET = process.env.MESSAGING_WEBHOOK_SECRET!;
const phone = () => uniquePhone('0713');
let ws: Workspace;
let tpl: Awaited<ReturnType<typeof approvedTemplate>>;
let seq = 0;

beforeAll(async () => {
  ws = await makeWorkspace();
  await setSupportPhone(ws);
  tpl = await approvedTemplate(ws);
});
afterAll(() => prisma.$disconnect());
beforeEach(() => {
  useClock(daytime(10));
  mockProvider().reset();
});
afterEach(() => resetClock());

const hook = (path: 'delivery' | 'inbound', body: Record<string, string>, query = `?secret=${SECRET}`) =>
  request(app).post(`/api/webhooks/messaging/${path}${query}`).type('form').send(body);
const reply = (from: string, text: string, id = `in-${++seq}-${Date.now()}`) => hook('inbound', { from, text, id });
const receipt = (providerMessageId: string, status: string, extra: Record<string, string> = {}) => hook('delivery', { id: providerMessageId, status, ...extra });

/** A consenting patient with a number, plus one message that has been delivered to the provider. */
async function patientWithSentMessage(w = ws, number = phone()) {
  const c = await createCase(w, { patientPhone: number, consentSms: true });
  const entry = ((await request(app).post(`/api/cases/${c.id}/messages`).set(as(w.coordinator)).send({ templateId: tpl.id, channel: 'SMS' }).expect(202)).body as SendMessageResponse).entry;
  await processDue();
  const log = await prisma.commsLog.findUniqueOrThrow({ where: { id: entry.id } });
  return { ref: c.id, number, logId: entry.id, providerId: log.providerMessageId! };
}
const caseDto = async (ref: string, w = ws) => (await request(app).get(`/api/cases/${ref}`).set(as(w.manager)).expect(200)).body as CaseDto;
const audit = (ref: string, w = ws) => prisma.auditEvent.findMany({ where: { orgId: w.orgId, resourceId: ref }, orderBy: { id: 'asc' } });
const notes = (ref: string, w = ws) => prisma.notification.findMany({ where: { orgId: w.orgId, caseRef: ref } });
const status = async (id: string) => (await prisma.commsLog.findUniqueOrThrow({ where: { id } })).status;

describe('authenticating the provider', () => {
  it('refuses requests with a missing or wrong secret, without touching anything', async () => {
    const p = await patientWithSentMessage();
    for (const q of ['', '?secret=', '?secret=wrong', `?secret=${SECRET}x`, `?Secret=${SECRET}`]) {
      expect((await hook('delivery', { id: p.providerId, status: 'Success' }, q)).status, q).toBe(401);
    }
    expect((await hook('inbound', { from: p.number, text: 'STOP', id: 'x1' }, '?secret=nope')).status).toBe(401);
    expect(await status(p.logId)).toBe('SENT'); // none of the refused calls changed anything
    expect((await caseDto(p.ref)).optedOut).toBe(false);
  });

  it('accepts the secret in a header too, and rejects non-POST requests', async () => {
    const p = await patientWithSentMessage();
    const viaHeader = await request(app).post('/api/webhooks/messaging/delivery').set('X-Webhook-Secret', SECRET).type('form').send({ id: p.providerId, status: 'Success' });
    expect(viaHeader.status).toBe(200);
    expect((await request(app).get(`/api/webhooks/messaging/delivery?secret=${SECRET}`)).status).toBe(404);
  });

  it('accepts JSON as well as forms', async () => {
    const p = await patientWithSentMessage();
    const res = await request(app).post(`/api/webhooks/messaging/delivery?secret=${SECRET}`).send({ id: p.providerId, status: 'Success' });
    expect(res.status).toBe(200);
    expect(await status(p.logId)).toBe('DELIVERED');
  });
});

describe('delivery receipts', () => {
  it.each([['Sent', 'SENT'], ['Submitted', 'SENT'], ['Buffered', 'SENT'], ['Success', 'DELIVERED'], ['delivered', 'DELIVERED'], ['READ', 'READ']])('"%s" means %s', async (word, expected) => {
    const p = await patientWithSentMessage();
    await prisma.commsLog.update({ where: { id: p.logId }, data: { status: 'SENT' } }); // reset to just-sent
    await receipt(p.providerId, word).expect(200);
    expect(await status(p.logId)).toBe(word === 'Sent' || word === 'Submitted' || word === 'Buffered' ? 'SENT' : expected);
  });

  it('only ever moves a message FORWARD: a late "Sent" cannot undo "Delivered", nor "Delivered" undo "Read"', async () => {
    const p = await patientWithSentMessage();
    await receipt(p.providerId, 'Success').expect(200);
    expect(await status(p.logId)).toBe('DELIVERED');
    await receipt(p.providerId, 'Sent').expect(200);
    expect(await status(p.logId)).toBe('DELIVERED');
    await receipt(p.providerId, 'Read').expect(200);
    expect(await status(p.logId)).toBe('READ');
    await receipt(p.providerId, 'Success').expect(200);
    await receipt(p.providerId, 'Sent').expect(200);
    expect(await status(p.logId)).toBe('READ');
  });

  it('the same receipt delivered twice changes nothing the second time', async () => {
    const p = await patientWithSentMessage();
    await receipt(p.providerId, 'Success').expect(200);
    const before = await prisma.commsLog.findUniqueOrThrow({ where: { id: p.logId } });
    await receipt(p.providerId, 'Success').expect(200);
    expect((await prisma.commsLog.findUniqueOrThrow({ where: { id: p.logId } })).updatedAt).toEqual(before.updatedAt);
  });

  it('a reported failure marks it failed and hands the patient to a person', async () => {
    const p = await patientWithSentMessage();
    await prisma.commsLog.update({ where: { id: p.logId }, data: { status: 'SENT' } });
    await receipt(p.providerId, 'Failed', { failureReason: 'UserInBlacklist' }).expect(200);
    const r = await prisma.commsLog.findUniqueOrThrow({ where: { id: p.logId } });
    expect(r).toMatchObject({ status: 'FAILED' });
    expect(r.failureReason).toBe('The network reported: UserInBlacklist.');
    expect((await notes(p.ref)).filter((n) => n.kind === 'HUMAN_FOLLOW_UP')).toHaveLength(1);
    expect((await audit(p.ref)).map((e) => e.action)).toContain('MESSAGE_FAILED');
  });

  it('a failure report cannot overturn a delivery that the patient’s phone confirmed', async () => {
    const p = await patientWithSentMessage();
    await receipt(p.providerId, 'Success').expect(200);
    await receipt(p.providerId, 'Failed').expect(200);
    expect(await status(p.logId)).toBe('DELIVERED');
    expect((await notes(p.ref)).filter((n) => n.kind === 'HUMAN_FOLLOW_UP')).toHaveLength(0);
  });

  it('unknown message ids and unknown statuses are acknowledged but ignored', async () => {
    const p = await patientWithSentMessage();
    expect((await receipt('no-such-message', 'Success')).status).toBe(200);
    expect((await receipt(p.providerId, 'TotallyNewStatus')).status).toBe(200);
    expect((await hook('delivery', {})).status).toBe(200);
    expect(await status(p.logId)).toBe('SENT');
  });
});

describe('a patient replies STOP', () => {
  it('opts them out at once: consent, queued messages, audit and a person are all dealt with', async () => {
    const p = await patientWithSentMessage();
    // another message is waiting to go out
    const waiting = ((await request(app).post(`/api/cases/${p.ref}/messages`).set(as(ws.coordinator)).send({ templateId: tpl.id, channel: 'SMS' }).expect(202)).body as SendMessageResponse).entry;

    const res = await reply(p.number, 'STOP').expect(200);
    expect(res.body).toEqual({ ok: true });
    expect(await caseDto(p.ref)).toMatchObject({ optedOut: true, consentSms: false, consentWhatsApp: false });

    const w = await prisma.commsLog.findUniqueOrThrow({ where: { id: waiting.id } });
    expect(w).toMatchObject({ status: 'BLOCKED_OPTOUT', failureReason: 'The patient replied STOP.', nextAttemptAt: null });
    await processDue();
    expect(mockProvider().sent.filter((m) => m.reference === waiting.id)).toHaveLength(0);

    const ev = (await audit(p.ref)).find((e) => e.action === 'CONSENT_OPTOUT_RECORDED')!;
    expect(ev).toMatchObject({ actorId: null, actorLabel: 'Patient (reply)', actorRole: 'Patient' });
    expect(ev.detail).toContain('replying STOP');
    const [n] = (await notes(p.ref)).filter((x) => x.kind === 'HUMAN_FOLLOW_UP');
    expect(n).toMatchObject({ userId: ws.coordinator.id });
    expect(n.body).toContain('replied STOP');
    expect(n.body).toContain('by phone only');

    // and a staff member trying to message them is now refused
    const blocked = (await request(app).post(`/api/cases/${p.ref}/messages`).set(as(ws.coordinator)).send({ templateId: tpl.id, channel: 'SMS' }).expect(200)).body as SendMessageResponse;
    expect(blocked.accepted).toBe(false);
  });

  it.each(['stop', ' Stop. ', 'ACHA', 'Unsubscribe', 'END', 'ＳＴＯＰ'])('recognises %j', async (text) => {
    const p = await patientWithSentMessage();
    await reply(p.number, text).expect(200);
    expect((await caseDto(p.ref)).optedOut).toBe(true);
  });

  it('matches the patient however the provider writes their number', async () => {
    const number = phone();
    const p = await patientWithSentMessage(ws, number);
    await reply(`+254${number.slice(1)}`, 'STOP').expect(200); // providers send E.164
    expect((await caseDto(p.ref)).optedOut).toBe(true);
  });

  it('stops EVERY programme that has been messaging that number', async () => {
    const other = await makeWorkspace();
    await setSupportPhone(other);
    const otherTpl = await approvedTemplate(other);
    const shared = phone();
    const a = await patientWithSentMessage(ws, shared);
    const c = await createCase(other, { patientPhone: shared, consentSms: true });
    await request(app).post(`/api/cases/${c.id}/messages`).set(as(other.coordinator)).send({ templateId: otherTpl.id, channel: 'SMS' }).expect(202);
    await processDue();

    await reply(shared, 'STOP').expect(200);
    expect((await caseDto(a.ref)).optedOut).toBe(true);
    expect((await caseDto(c.id, other)).optedOut).toBe(true);
    // each programme's own audit trail records it, and neither sees the other's
    expect((await audit(c.id, other)).map((e) => e.action)).toContain('CONSENT_OPTOUT_RECORDED');
  });

  it('a re-delivered webhook is a no-op (no duplicate consent rows)', async () => {
    const p = await patientWithSentMessage();
    const id = `dup-${Date.now()}`;
    await reply(p.number, 'STOP', id).expect(200);
    await reply(p.number, 'STOP', id).expect(200);
    const pid = (await prisma.referralCase.findFirstOrThrow({ where: { orgId: ws.orgId, refNumber: p.ref } })).patientId;
    expect(await prisma.consent.count({ where: { patientId: pid, event: 'OPTED_OUT' } })).toBe(3);
    expect((await audit(p.ref)).filter((e) => e.action === 'CONSENT_OPTOUT_RECORDED')).toHaveLength(1);
  });

  it('STOP from someone already opted out adds nothing', async () => {
    const p = await patientWithSentMessage();
    await reply(p.number, 'STOP').expect(200);
    await reply(p.number, 'STOP').expect(200); // different webhook id
    const pid = (await prisma.referralCase.findFirstOrThrow({ where: { orgId: ws.orgId, refNumber: p.ref } })).patientId;
    expect(await prisma.consent.count({ where: { patientId: pid, event: 'OPTED_OUT' } })).toBe(3);
  });

  it('an unknown or malformed number is acknowledged and changes nothing', async () => {
    const p = await patientWithSentMessage();
    expect((await reply('0799999999', 'STOP')).status).toBe(200);
    expect((await reply('not a number', 'STOP')).status).toBe(200);
    expect((await hook('inbound', {})).status).toBe(200);
    expect((await caseDto(p.ref)).optedOut).toBe(false);
  });
});

describe('a patient replies START', () => {
  it('restores only what they had actually consented to', async () => {
    const p = await patientWithSentMessage();
    await reply(p.number, 'STOP').expect(200);
    await reply(p.number, 'START').expect(200);
    expect(await caseDto(p.ref)).toMatchObject({ optedOut: false, consentSms: true, consentWhatsApp: false });
    expect((await audit(p.ref)).map((e) => e.action)).toContain('CONSENT_RESTORED');
  });

  it('cannot create consent that never existed, and does nothing for someone who has not opted out', async () => {
    const number = phone();
    const c = await createCase(ws, { patientPhone: number, consentSms: false }); // never consented
    await request(app).put(`/api/cases/${c.id}/opt-out`).set(as(ws.dpo)).send({ optedOut: true }).expect(200);
    await reply(number, 'START').expect(200);
    expect((await caseDto(c.id)).optedOut).toBe(true); // still opted out: nothing to restore

    const p = await patientWithSentMessage();
    await reply(p.number, 'START').expect(200); // not opted out
    expect(await caseDto(p.ref)).toMatchObject({ optedOut: false, consentSms: true });
  });
});

describe('a patient confirms or replies in their own words', () => {
  it.each(['1', 'YES', 'Ndiyo', 'ok'])('%j confirms a message they were sent', async (text) => {
    const p = await patientWithSentMessage();
    await reply(p.number, text).expect(200);
    expect((await audit(p.ref)).map((e) => e.action)).toContain('PATIENT_CONFIRMED');
    const n = (await notes(p.ref)).find((x) => x.kind === 'PATIENT_REPLY')!;
    expect(n).toMatchObject({ userId: ws.coordinator.id, title: `${p.ref}: patient confirmed` });
    expect((await caseDto(p.ref)).optedOut).toBe(false);
  });

  it('a bare "1" from a patient we never messaged does nothing', async () => {
    const number = phone();
    const c = await createCase(ws, { patientPhone: number, consentSms: true });
    await reply(number, '1').expect(200);
    expect((await audit(c.id)).map((e) => e.action)).not.toContain('PATIENT_CONFIRMED');
  });

  it('anything else goes to a person, and the words themselves are never stored anywhere', async () => {
    const p = await patientWithSentMessage();
    const secret = `my sister had cancer too and I am worried ${Date.now()}`;
    await reply(p.number, secret).expect(200);
    expect((await audit(p.ref)).map((e) => e.action)).toContain('PATIENT_REPLIED');
    const n = (await notes(p.ref)).find((x) => x.kind === 'PATIENT_REPLY' && x.title.endsWith('patient replied'))!;
    expect(n.body).toContain('needs a personal response');

    const everything = JSON.stringify([
      await prisma.auditEvent.findMany({ where: { orgId: ws.orgId, resourceId: p.ref }, select: { detail: true, actorLabel: true } }),
      await prisma.notification.findMany({ where: { orgId: ws.orgId, caseRef: p.ref } }),
      await prisma.inboundMessage.findMany({ where: { orgId: ws.orgId } }),
      await prisma.commsLog.findMany({ where: { orgId: ws.orgId } }),
    ]);
    expect(everything).not.toContain('sister');
    expect(everything).not.toContain('worried');
    expect((await caseDto(p.ref)).optedOut).toBe(false);
  });

  it('records what each reply was understood as, once', async () => {
    const p = await patientWithSentMessage();
    const id = `kind-${Date.now()}`;
    await reply(p.number, 'maybe tomorrow', id).expect(200);
    await reply(p.number, 'maybe tomorrow', id).expect(200);
    const pid = (await prisma.referralCase.findFirstOrThrow({ where: { orgId: ws.orgId, refNumber: p.ref } })).patientId;
    const rows = await prisma.inboundMessage.findMany({ where: { patientId: pid, providerMessageId: id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('OTHER');
    expect(Object.keys(rows[0]).sort()).toEqual(['caseId', 'channel', 'id', 'kind', 'orgId', 'patientId', 'providerMessageId', 'receivedAt']); // no text column
  });
});
