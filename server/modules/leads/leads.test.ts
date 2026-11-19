import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { env } from '../../config/env';
import { setMailer, type Mailer, type MailMessage } from '../../lib/mailer';
import { prisma, uniqueEmail } from '../../test/helpers';
import { app } from '../../test/workspace';

class Capture implements Mailer {
  readonly configured = true;
  sent: MailMessage[] = [];
  fail = false;
  async send(m: MailMessage) {
    if (this.fail) throw new Error('smtp down');
    this.sent.push(m);
  }
}
let mail: Capture;
beforeEach(() => {
  mail = new Capture();
  setMailer(mail);
  (env as { LEADS_NOTIFY_EMAIL?: string }).LEADS_NOTIFY_EMAIL = 'team@pathora.test';
});
afterEach(() => {
  setMailer(undefined);
  (env as { LEADS_NOTIFY_EMAIL?: string }).LEADS_NOTIFY_EMAIL = undefined;
});
afterAll(() => prisma.$disconnect());

const body = (over: Record<string, unknown> = {}) => ({ name: 'Pauline Kamau', organization: 'Nairobi Screening Network', email: uniqueEmail('lead'), pathway: 'Cancer Screening', ...over });
const post = (b: object) => request(app).post('/api/leads').send(b);
const stored = (email: string) => prisma.lead.findMany({ where: { email: email.toLowerCase() } });
const flush = () => new Promise((r) => setTimeout(r, 50)); // the team email is sent after the response

describe('POST /api/leads', () => {
  it('needs no sign-in, stores the request, and tells the team', async () => {
    const b = body({ email: 'Mixed.Case@Org.Example' });
    const res = await post(b);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers['cache-control']).toBe('no-store');
    const [lead] = await stored(b.email);
    expect(lead).toMatchObject({ name: b.name, organization: b.organization, pathway: 'Cancer Screening', email: 'mixed.case@org.example' });
    await flush();
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: 'team@pathora.test' });
    expect(mail.sent[0].text).toContain('Nairobi Screening Network');
  });

  it('still succeeds, and keeps the lead, when email is not configured or fails', async () => {
    mail.fail = true;
    const a = body();
    expect((await post(a)).status).toBe(202);
    expect(await stored(a.email)).toHaveLength(1);
    (env as { LEADS_NOTIFY_EMAIL?: string }).LEADS_NOTIFY_EMAIL = undefined;
    mail.fail = false;
    const b = body();
    expect((await post(b)).status).toBe(202);
    await flush();
    expect(mail.sent).toHaveLength(0);
    expect(await stored(b.email)).toHaveLength(1);
  });

  it.each([
    ['missing name', { name: '' }],
    ['missing organization', { organization: '   ' }],
    ['bad email', { email: 'not-an-email' }],
    ['email with a space', { email: 'a b@c.org' }],
    ['over-long email', { email: `${'a'.repeat(250)}@x.org` }],
    ['missing pathway', { pathway: '' }],
    ['line break in name (header injection)', { name: 'Eve\nBcc: victim@example.org' }],
    ['line break in organization', { organization: 'Org\r\nSubject: x' }],
    ['over-long name', { name: 'x'.repeat(121) }],
    ['non-string name', { name: { $ne: 1 } }],
  ])('rejects %s', async (_l, over) => {
    const before = await prisma.lead.count();
    const res = await post(body(over));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.lead.count()).toBe(before);
    expect(mail.sent).toHaveLength(0);
  });

  it('honeypot: looks successful but stores and sends nothing', async () => {
    const b = body({ website: 'http://spam.example' });
    const res = await post(b);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true });
    expect(await stored(b.email)).toHaveLength(0);
    await flush();
    expect(mail.sent).toHaveLength(0);
  });

  it('a repeat of the same request within a day is dropped; a different pathway or a day later is not', async () => {
    const b = body();
    await post(b).expect(202);
    await post(b).expect(202);
    await post({ ...b, email: b.email.toUpperCase() }).expect(202);
    expect(await stored(b.email)).toHaveLength(1);
    await flush();
    expect(mail.sent).toHaveLength(1);

    await post({ ...b, pathway: 'NCD Screening' }).expect(202);
    expect(await stored(b.email)).toHaveLength(2);

    await prisma.lead.updateMany({ where: { email: b.email }, data: { createdAt: new Date(Date.now() - 25 * 3_600_000) } });
    await post(b).expect(202);
    expect(await stored(b.email)).toHaveLength(3);
  });

  it('is rate limited per IP', async () => {
    const limited = createApp({ leads: { maxPerIp: 3 } });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await request(limited).post('/api/leads').send(body())).status);
    expect(statuses).toEqual([202, 202, 202, 429, 429]);
  });

  it('only accepts POST', async () => {
    expect((await request(app).get('/api/leads')).status).toBe(404);
  });
});
