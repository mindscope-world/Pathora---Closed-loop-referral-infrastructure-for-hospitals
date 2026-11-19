import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CaseDto, NotificationsResponse } from '../../../shared/types';
import { runSlaMonitor } from '../../jobs/slaMonitor';
import { prisma } from '../../test/helpers';
import { app, as, createCase, makeWorkspace, type Actor, type Workspace } from '../../test/workspace';

const H = 3_600_000;
let ws: Workspace;
beforeAll(async () => {
  ws = await makeWorkspace();
  for (let i = 0; i < 3; i++) await createCase(ws);
  await runSlaMonitor(new Date(Date.now() + 25 * H), { orgId: ws.orgId });
});
afterAll(() => prisma.$disconnect());

const get = async (actor: Actor) => (await request(app).get('/api/notifications').set(as(actor)).expect(200)).body as NotificationsResponse;

describe('GET /api/notifications', () => {
  it('returns your own notifications, newest first, with an unread count', async () => {
    const mine = await get(ws.coordinator);
    expect(mine.unread).toBe(3);
    expect(mine.notifications).toHaveLength(3);
    expect(mine.notifications.every((n) => !('userId' in n) && n.readAt === null && n.kind === 'SLA_BREACH')).toBe(true); // recipients are never exposed
    const times = mine.notifications.map((n) => Date.parse(n.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(mine.notifications[0]).toEqual({ id: expect.any(String), kind: 'SLA_BREACH', title: expect.stringMatching(/ is overdue$/), body: expect.any(String), caseRef: expect.stringMatching(/^REF-/), createdAt: expect.any(String), readAt: null });
  });

  it('is personal: you never see anyone else’s, in or out of your organisation', async () => {
    const lead = await get(ws.clinical);
    const mine = new Set((await get(ws.coordinator)).notifications.map((n) => n.id));
    expect(lead.notifications.some((n) => mine.has(n.id))).toBe(false); // same events, but each person has their own row
    expect((await get(ws.manager)).notifications).toEqual([]);
    const other = await makeWorkspace();
    expect((await get(other.coordinator)).notifications).toEqual([]);
  });

  it('requires sign-in and is never cached', async () => {
    expect((await request(app).get('/api/notifications')).status).toBe(401);
    expect((await request(app).get('/api/notifications').set(as(ws.coordinator))).headers['cache-control']).toBe('no-store');
  });
});

describe('marking read', () => {
  it('marks one as read (idempotently) and lowers the unread count', async () => {
    const w = await makeWorkspace();
    await createCase(w); await createCase(w);
    await runSlaMonitor(new Date(Date.now() + 25 * H), { orgId: w.orgId });
    const [first] = (await get(w.coordinator)).notifications;
    await request(app).post(`/api/notifications/${first.id}/read`).set(as(w.coordinator)).expect(204);
    await request(app).post(`/api/notifications/${first.id}/read`).set(as(w.coordinator)).expect(204); // already read: still fine
    const after = await get(w.coordinator);
    expect(after.unread).toBe(1);
    expect(after.notifications.find((n) => n.id === first.id)!.readAt).toBeTruthy();
  });

  it('cannot mark someone else’s notification: it simply does not exist for you', async () => {
    const w = await makeWorkspace();
    await createCase(w);
    await runSlaMonitor(new Date(Date.now() + 25 * H), { orgId: w.orgId });
    const [theirs] = (await get(w.clinical)).notifications;
    expect((await request(app).post(`/api/notifications/${theirs.id}/read`).set(as(w.coordinator))).status).toBe(404);
    expect((await get(w.clinical)).unread).toBe(1); // untouched
    expect((await request(app).post('/api/notifications/nope/read').set(as(w.coordinator))).status).toBe(404);
    expect((await request(app).post(`/api/notifications/${theirs.id}/read`)).status).toBe(401);
  });

  it('read-all clears only your own', async () => {
    const w = await makeWorkspace();
    await createCase(w); await createCase(w);
    await runSlaMonitor(new Date(Date.now() + 25 * H), { orgId: w.orgId });
    const res = await request(app).post('/api/notifications/read-all').set(as(w.coordinator)).expect(200);
    expect(res.body.marked).toBe(2);
    expect((await get(w.coordinator)).unread).toBe(0);
    expect((await get(w.clinical)).unread).toBe(2); // the clinical lead's are still unread
  });
});

void (null as unknown as CaseDto);
