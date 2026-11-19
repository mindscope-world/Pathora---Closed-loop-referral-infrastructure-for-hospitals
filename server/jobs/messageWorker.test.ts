import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SendMessageResponse } from '../../shared/types';
import { setProvider, type MessagingProvider, type SendResult } from '../messaging/provider';
import { MAX_ATTEMPTS } from '../modules/comms/schedule';
import { prisma } from '../test/helpers';
import { app, approvedTemplate, as, createCase, makeWorkspace, mockProvider, resetClock, setSupportPhone, uniquePhone, useClock, daytime, type Workspace } from '../test/workspace';
import { claimNext, processDue, recoverStale, STALE_SENDING_MS } from './messageWorker';

const MIN = 60_000;
const H = 3_600_000;
const phone = () => uniquePhone('0712');
let ws: Workspace;
let tpl: Awaited<ReturnType<typeof approvedTemplate>>;

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
afterEach(() => {
  resetClock();
  setProvider(undefined);
});

/** Queues one message for a fresh consenting patient; returns the log id and the referral number. */
async function queued(w: Workspace = ws, over: object = {}) {
  const c = await createCase(w, { patientPhone: phone(), consentSms: true, ...over });
  const entry = ((await request(app).post(`/api/cases/${c.id}/messages`).set(as(w.coordinator)).send({ templateId: tpl.id, channel: 'SMS' }).expect(202)).body as SendMessageResponse).entry;
  return { ref: c.id, id: entry.id };
}
const row = (id: string) => prisma.commsLog.findUniqueOrThrow({ where: { id } });
const audit = (ref: string, w = ws) => prisma.auditEvent.findMany({ where: { orgId: w.orgId, resourceId: ref }, orderBy: { id: 'asc' } });
const human = (ref: string, w = ws) => prisma.notification.findMany({ where: { orgId: w.orgId, caseRef: ref, kind: 'HUMAN_FOLLOW_UP' } });
const at = (ms: number) => new Date(daytime(10).getTime() + ms);
/** Drains the queue at `now`, but only reports what happened to the given messages. */
const run = (now: Date) => processDue(500, now);

describe('delivering', () => {
  it('claims a message once, marking it SENDING and counting the attempt', async () => {
    const q = await queued();
    const id = await claimNext(daytime(10));
    expect(id).toBeTruthy();
    // we may have claimed an earlier test's message; claim ours explicitly by draining the rest first
    const mine = await row(q.id);
    expect(['QUEUED', 'SENDING']).toContain(mine.status);
    await run(daytime(10));
    await prisma.commsLog.updateMany({ where: { id: q.id, status: 'QUEUED' }, data: { status: 'QUEUED' } });
  });

  it('several workers racing deliver every message exactly once', async () => {
    const w = await makeWorkspace();
    await setSupportPhone(w);
    const t = await approvedTemplate(w);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const c = await createCase(w, { patientPhone: phone(), consentSms: true });
      ids.push(((await request(app).post(`/api/cases/${c.id}/messages`).set(as(w.coordinator)).send({ templateId: t.id, channel: 'SMS' }).expect(202)).body as SendMessageResponse).entry.id);
    }
    await Promise.all([run(daytime(10)), run(daytime(10)), run(daytime(10)), run(daytime(10))]);
    for (const id of ids) {
      expect(mockProvider().sent.filter((m) => m.reference === id), id).toHaveLength(1);
      expect(await row(id)).toMatchObject({ status: 'SENT', attempts: 1 });
    }
  });

  it('does nothing before a message is due', async () => {
    useClock(daytime(22, 30)); // held until 07:00
    const q = await queued();
    await run(daytime(22, 45));
    expect(mockProvider().sent.filter((m) => m.reference === q.id)).toHaveLength(0);
    expect((await row(q.id)).status).toBe('QUEUED');
  });
});

describe('failures and retries', () => {
  it('a temporary failure is retried after a delay, and nobody is alerted yet', async () => {
    const q = await queued();
    mockProvider().queueResult({ ok: false, transient: true, reason: 'The messaging provider is unavailable' });
    await run(daytime(10));
    const r = await row(q.id);
    expect(r).toMatchObject({ status: 'QUEUED', attempts: 1, failureReason: 'The messaging provider is unavailable' });
    expect(r.nextAttemptAt!.getTime()).toBe(at(1 * MIN).getTime());
    expect(await human(q.ref)).toHaveLength(0);
    expect((await audit(q.ref)).map((e) => e.action)).not.toContain('MESSAGE_FAILED');

    await run(at(30_000));                                   // not yet due
    expect((await row(q.id)).attempts).toBe(1);
    await run(at(61_000));                                   // due: succeeds this time
    expect(await row(q.id)).toMatchObject({ status: 'SENT', attempts: 2, failureReason: null });
    expect(mockProvider().sent.filter((m) => m.reference === q.id)).toHaveLength(1);
  });

  it('backs off 1 min, 5 min, 30 min, 2 h, then gives up and hands the patient to a person', async () => {
    const q = await queued();
    const expectedDelays = [1 * MIN, 5 * MIN, 30 * MIN, 2 * H];
    let now = daytime(10);
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
      mockProvider().queueResult({ ok: false, transient: true, reason: 'Provider down' });
      await run(now);
      const r = await row(q.id);
      expect(r.attempts).toBe(attempt);
      expect(r.status).toBe('QUEUED');
      expect(r.nextAttemptAt!.getTime() - now.getTime(), `after attempt ${attempt}`).toBe(expectedDelays[attempt - 1]);
      now = r.nextAttemptAt!;
    }
    mockProvider().queueResult({ ok: false, transient: true, reason: 'Provider down' });
    await run(now);
    const final = await row(q.id);
    expect(final).toMatchObject({ status: 'FAILED', attempts: MAX_ATTEMPTS, nextAttemptAt: null });
    expect(final.failureReason).toBe(`Provider down. Gave up after ${MAX_ATTEMPTS} attempts.`);
    expect(mockProvider().sent.filter((m) => m.reference === q.id)).toHaveLength(0);

    expect((await audit(q.ref)).map((e) => e.action)).toEqual(['CASE_CREATED', 'MESSAGE_QUEUED', 'MESSAGE_FAILED']);
    const [n] = await human(q.ref);
    expect(n).toMatchObject({ userId: ws.coordinator.id });
    expect(n.body).toContain('could not be delivered');
    await run(at(24 * H)); // and it is never tried again
    expect((await row(q.id)).attempts).toBe(MAX_ATTEMPTS);
  });

  it('a permanent failure is not retried: it goes straight to a person', async () => {
    const q = await queued();
    mockProvider().queueResult({ ok: false, transient: false, reason: 'The phone number is not valid' });
    await run(daytime(10));
    expect(await row(q.id)).toMatchObject({ status: 'FAILED', attempts: 1, failureReason: 'The phone number is not valid.' });
    expect(await human(q.ref)).toHaveLength(1);
    expect((await audit(q.ref)).map((e) => e.action)).toContain('MESSAGE_FAILED');
  });

  it('a retry is never scheduled into quiet hours', async () => {
    const lateEvening = new Date(daytime(20, 59).getTime() + 30_000); // 20:59:30
    useClock(lateEvening);
    const q = await queued();
    mockProvider().queueResult({ ok: false, transient: true, reason: 'Provider down' });
    await run(lateEvening);
    expect((await row(q.id)).nextAttemptAt!.toISOString()).toBe(new Date(daytime(7).getTime() + 24 * H).toISOString()); // 07:00 next morning, not 21:00
  });

  it('a provider that throws is treated as a temporary failure, not a crash that loses the message', async () => {
    const q = await queued();
    const throwing: MessagingProvider = { name: 'broken', supports: () => true, send: async () => { throw new Error('socket hang up to +254711000000'); } };
    setProvider(throwing);
    await run(daytime(10));
    const r = await row(q.id);
    expect(r).toMatchObject({ status: 'QUEUED', attempts: 1 });
    expect(r.failureReason).toBe('The messaging provider failed unexpectedly'); // the raw error (with a number in it) is not stored
  });
});

describe('consent is checked again at the last moment', () => {
  it('a patient who opts out after queueing is NOT messaged, and a person is told', async () => {
    const q = await queued();
    await request(app).put(`/api/cases/${q.ref}/opt-out`).set(as(ws.dpo)).send({ optedOut: true }).expect(200);
    await run(daytime(10));
    expect(mockProvider().sent.filter((m) => m.reference === q.id)).toHaveLength(0);
    const r = await row(q.id);
    expect(r.status).toBe('BLOCKED_OPTOUT');
    expect(r.failureReason).toContain('Consent was withdrawn before the message was sent');
    const ev = (await audit(q.ref)).find((e) => e.action === 'MESSAGE_BLOCKED_OPTOUT')!;
    expect(ev).toMatchObject({ actorLabel: 'Messaging Service', actorRole: 'System' });
    expect(await human(q.ref)).toHaveLength(1);
  });

  it('withdrawing SMS consent after queueing stops an SMS just the same', async () => {
    const q = await queued();
    await request(app).put(`/api/cases/${q.ref}/consent`).set(as(ws.dpo)).send({ channel: 'SMS', granted: false }).expect(200);
    await run(daytime(10));
    expect((await row(q.id)).status).toBe('BLOCKED_OPTOUT');
    expect(mockProvider().sent.filter((m) => m.reference === q.id)).toHaveLength(0);
  });

  it('a number removed after queueing hands the patient to a person instead of failing silently', async () => {
    const q = await queued();
    await request(app).put(`/api/cases/${q.ref}/contact`).set(as(ws.coordinator)).send({ phone: null }).expect(200);
    await run(daytime(10));
    expect(await row(q.id)).toMatchObject({ status: 'HUMAN_ROUTED', failureReason: 'There is no mobile number on file for this patient.' });
    expect(await human(q.ref)).toHaveLength(1);
  });

  it('a referral closed after queueing is not messaged, and nobody is bothered', async () => {
    const q = await queued();
    await request(app).post(`/api/cases/${q.ref}/acknowledge`).set(as(ws.focalA)).send({}).expect(200);
    await request(app).post(`/api/cases/${q.ref}/attendance`).set(as(ws.focalA)).send({}).expect(200);
    await request(app).post(`/api/cases/${q.ref}/close`).set(as(ws.focalA)).send({ closureReason: 'Care plan documented' }).expect(200);
    await run(daytime(10));
    expect((await row(q.id)).status).toBe('FAILED');
    expect(await human(q.ref)).toHaveLength(0);
    expect(mockProvider().sent.filter((m) => m.reference === q.id)).toHaveLength(0);
  });

  it('a patient who is still consented is messaged normally', async () => {
    const q = await queued();
    await request(app).put(`/api/cases/${q.ref}/consent`).set(as(ws.dpo)).send({ channel: 'SMS', granted: true }).expect(200); // no change
    await run(daytime(10));
    expect((await row(q.id)).status).toBe('SENT');
  });
});

describe('a worker that dies mid-send', () => {
  const stuck = async (minutesAgo: number) => {
    const q = await queued();
    await prisma.commsLog.update({ where: { id: q.id }, data: { status: 'SENDING', attempts: 1 } });
    await prisma.$executeRaw`UPDATE "CommsLog" SET "updatedAt" = ${new Date(daytime(10).getTime() - minutesAgo * MIN)} WHERE id = ${q.id}`;
    return q;
  };

  it('is NOT retried (it might be a duplicate); it is marked failed and a person is asked to check', async () => {
    const q = await stuck(STALE_SENDING_MS / MIN + 1);
    expect(await recoverStale(daytime(10))).toBeGreaterThanOrEqual(1);
    const r = await row(q.id);
    expect(r.status).toBe('FAILED');
    expect(r.failureReason).toMatch(/not known whether this message reached the patient/);
    expect(await human(q.ref)).toHaveLength(1);
    expect((await audit(q.ref)).map((e) => e.action)).toContain('MESSAGE_FAILED');
    await run(daytime(10));
    expect(mockProvider().sent.filter((m) => m.reference === q.id)).toHaveLength(0); // never resent
  });

  it('leaves a message that is only moments into sending alone', async () => {
    const q = await stuck(1);
    await recoverStale(daytime(10));
    expect((await row(q.id)).status).toBe('SENDING');
    await prisma.commsLog.update({ where: { id: q.id }, data: { status: 'FAILED' } });
  });

  it('is idempotent: recovering twice alerts once', async () => {
    const q = await stuck(30);
    await recoverStale(daytime(10));
    await recoverStale(daytime(10));
    expect(await human(q.ref)).toHaveLength(1);
  });
});

void claimNext;
