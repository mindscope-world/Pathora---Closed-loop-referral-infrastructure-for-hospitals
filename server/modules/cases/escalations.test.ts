import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CaseDto } from '../../../shared/types';
import { prisma } from '../../test/helpers';
import { act, app, as, createCase, makeWorkspace, type Actor, type Workspace } from '../../test/workspace';

const H = 3_600_000;
let ws: Workspace;
const ids: Record<string, string> = {};

/** The attention rule exactly as the dashboard's Escalations screen applies it client-side. */
const dashboardRule = (c: CaseDto) =>
  c.status !== 'CLOSED_VERIFIED' && (c.status === 'OVERDUE_SLA' || c.stage === 'ESCALATED' || c.redFlag || c.slaHoursRemaining <= 12);

/** Moves a case's deadline; issuedAt moves with it because the database requires slaDueAt >= issuedAt. */
const setDeadline = (ref: string, hoursFromNow: number) => {
  const due = Date.now() + hoursFromNow * H;
  return prisma.referralCase.updateMany({
    where: { orgId: ws.orgId, refNumber: ref },
    data: { issuedAt: new Date(Math.min(Date.now(), due) - H), slaDueAt: new Date(due) },
  });
};

beforeAll(async () => {
  ws = await makeWorkspace();
  ids.overdue = (await createCase(ws)).id;               await setDeadline(ids.overdue, -5);
  ids.soon = (await createCase(ws)).id;                  await setDeadline(ids.soon, 10);
  ids.edge = (await createCase(ws)).id;                  await setDeadline(ids.edge, 12.2); // rounds to 12h: still in the window
  ids.later = (await createCase(ws)).id;                 await setDeadline(ids.later, 13);   // 13h: outside
  ids.redFlag = (await createCase(ws, { redFlag: true })).id; await setDeadline(ids.redFlag, 100);
  ids.escalated = (await createCase(ws)).id;             await setDeadline(ids.escalated, 100);
  await act(ws.coordinator, ids.escalated, 'escalate', { reason: 'No response' }).expect(200);
  ids.closed = (await createCase(ws)).id;
  await act(ws.focalA, ids.closed, 'acknowledge').expect(200);
  await act(ws.focalA, ids.closed, 'attendance').expect(200);
  await act(ws.focalA, ids.closed, 'close', { closureReason: 'Care plan documented' }).expect(200);
  await setDeadline(ids.closed, -50);
  ids.calm = (await createCase(ws)).id;                  await setDeadline(ids.calm, 100);
});
afterAll(() => prisma.$disconnect());

const get = async (actor: Actor = ws.manager) => (await request(app).get('/api/escalations').set(as(actor)).expect(200)).body.cases as CaseDto[];

describe('GET /api/escalations', () => {
  it('returns exactly the referrals that need attention', async () => {
    const got = (await get()).map((c) => c.id).sort();
    expect(got).toEqual([ids.overdue, ids.soon, ids.edge, ids.redFlag, ids.escalated].sort());
    expect(got).not.toContain(ids.later);   // 13h away
    expect(got).not.toContain(ids.calm);    // nothing wrong
    expect(got).not.toContain(ids.closed);  // closed, however late
  });

  it('agrees with the dashboard’s own rule on the full case list (no screen disagrees with the API)', async () => {
    const all = (await request(app).get('/api/cases?limit=200').set(as(ws.manager)).expect(200)).body.cases as CaseDto[];
    expect((await get()).map((c) => c.id).sort()).toEqual(all.filter(dashboardRule).map((c) => c.id).sort());
  });

  it('puts the most urgent first (earliest deadline)', async () => {
    const deadlines = (await get()).map((c) => Date.parse(c.slaDueAt!));
    expect([...deadlines].sort((a, b) => a - b)).toEqual(deadlines);
    expect((await get())[0].id).toBe(ids.overdue);
  });

  it('excludes synthetic fixtures', async () => {
    await prisma.referralCase.updateMany({ where: { orgId: ws.orgId, refNumber: ids.overdue }, data: { isSynthetic: true } });
    expect((await get()).map((c) => c.id)).not.toContain(ids.overdue);
    await prisma.referralCase.updateMany({ where: { orgId: ws.orgId, refNumber: ids.overdue }, data: { isSynthetic: false } });
  });

  it('shows a facility focal only their own facility’s referrals, and other organisations see nothing of it', async () => {
    const mine = await createCase(ws, { facilityId: ws.facilityB.id });
    await setDeadline(mine.id, -2);
    expect((await get(ws.focalB)).map((c) => c.id)).toEqual([mine.id]);
    expect((await get(ws.focalA)).map((c) => c.id)).not.toContain(mine.id);
    expect(await get((await makeWorkspace()).manager)).toEqual([]);
  });

  it('every role can read it; anonymous callers cannot; it is never cached', async () => {
    for (const a of [ws.manager, ws.coordinator, ws.focalA, ws.clinical, ws.dpo]) expect((await request(app).get('/api/escalations').set(as(a))).status, a.name).toBe(200);
    expect((await request(app).get('/api/escalations')).status).toBe(401);
    expect((await request(app).get('/api/escalations').set(as(ws.manager))).headers['cache-control']).toBe('no-store');
  });
});
