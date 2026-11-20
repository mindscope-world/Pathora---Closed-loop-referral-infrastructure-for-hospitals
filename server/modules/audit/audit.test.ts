import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuditListResponse, AuditVerifyResponse } from '../../../shared/types';
import { computeAuditHash, GENESIS_HASH } from '../../lib/auditHash';
import { prisma } from '../../test/helpers';
import { act, app, as, createCase, makeWorkspace, type Workspace } from '../../test/workspace';
import { appendAudit, appendAuditBatch } from './append';

let ws: Workspace;
beforeAll(async () => {
  ws = await makeWorkspace();
});
afterAll(() => prisma.$disconnect());

const list = (qs = '', actor = ws.manager) => request(app).get(`/api/audit${qs}`).set(as(actor));
const ok = async (qs = '', actor = ws.manager) => (await list(qs, actor).expect(200)).body as AuditListResponse;

describe('GET /api/audit', () => {
  let ref: string;
  beforeAll(async () => {
    const c = await createCase(ws);
    ref = c.id;
    await act(ws.focalA, ref, 'acknowledge').expect(200);
    await act(ws.coordinator, ref, 'escalate', { reason: 'Facility has not responded' }).expect(200);
  });

  it('returns newest first with every field a reviewer needs', async () => {
    const { events } = await ok();
    expect(events.length).toBeGreaterThanOrEqual(4);
    const ids = events.map((e) => BigInt(e.id));
    expect([...ids].sort((a, b) => (a > b ? -1 : 1))).toEqual(ids);
    expect(events[0]).toEqual({
      id: expect.stringMatching(/^\d+$/), at: expect.any(String), actor: 'Cora Coordinator', role: 'Programme Coordinator',
      action: 'CASE_ESCALATED', resourceType: 'ReferralCase', resourceId: ref, detail: 'Facility has not responded',
      hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('filters by resource, action and actor', async () => {
    expect((await ok(`?resourceId=${ref}`)).events.map((e) => e.action).reverse()).toEqual(['CASE_CREATED', 'FACILITY_ACKNOWLEDGED', 'CASE_ESCALATED']);
    expect((await ok('?action=FACILITY_ACKNOWLEDGED')).events.every((e) => e.action === 'FACILITY_ACKNOWLEDGED')).toBe(true);
    expect((await ok(`?actorId=${ws.focalA.id}`)).events.map((e) => e.action)).toContain('FACILITY_ACKNOWLEDGED');
    expect((await ok(`?actorId=${ws.focalA.id}`)).events.every((e) => e.actor === 'Fiona Focal')).toBe(true);
  });

  it('free-text search matches actor, action, resource id and detail, case-insensitively', async () => {
    const hit = async (q: string) => (await ok(`?q=${encodeURIComponent(q)}`)).events.map((e) => e.resourceId);
    expect(await hit('fiona')).toContain(ref);
    expect(await hit('case_escalated')).toContain(ref);
    expect(await hit(ref.toLowerCase())).toContain(ref);
    expect(await hit('not responded')).toContain(ref);
    expect(await hit('zzz-no-such-thing')).toEqual([]);
  });

  it('filters by time range (inclusive) and rejects malformed or reversed ranges', async () => {
    const all = (await ok('?limit=200')).events;
    const mid = all[Math.floor(all.length / 2)];
    const afterMid = (await ok(`?from=${encodeURIComponent(mid.at)}&limit=200`)).events;
    expect(afterMid.every((e) => e.at >= mid.at)).toBe(true);
    const beforeMid = (await ok(`?to=${encodeURIComponent(mid.at)}&limit=200`)).events;
    expect(beforeMid.every((e) => e.at <= mid.at)).toBe(true);
    expect((await ok('?from=2999-01-01T00:00:00Z')).events).toEqual([]);
    expect((await list('?from=yesterday')).status).toBe(400);
    expect((await list('?from=2026-13-45')).status).toBe(400);
  });

  it('paginates with an opaque keyset cursor: no gaps, no repeats, stable under new writes', async () => {
    const total = (await ok('?limit=200')).events.length;
    const seen: string[] = [];
    let cursor: string | null = null;
    let first = true;
    do {
      const page = await ok(`?limit=3${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...page.events.map((e) => e.id));
      cursor = page.nextCursor;
      if (first) { // a new event arriving mid-pagination must not shift later pages
        await createCase(ws);
        first = false;
      }
    } while (cursor);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(total);
    expect((await list('?cursor=garbage')).status).toBe(400);
    expect((await list('?limit=0')).status).toBe(400);
    expect((await list('?limit=999')).status).toBe(400);
  });

  it('never exposes patient names (details carry codes only)', async () => {
    const detail = (await ok(`?resourceId=${ref}`)).events.map((e) => e.detail).join(' ');
    expect(detail).not.toMatch(/Wanjiru|Kamau/);
  });

  it('is limited to roles that may read audit (manager, clinical lead, DPO)', async () => {
    for (const a of [ws.manager, ws.clinical, ws.dpo]) expect((await list('', a)).status, a.name).toBe(200);
    for (const a of [ws.coordinator, ws.focalA]) expect((await list('', a)).status, a.name).toBe(403);
    expect((await request(app).get('/api/audit')).status).toBe(401);
  });

  it('is isolated per organisation and never cached', async () => {
    const other = await makeWorkspace();
    const mine = await ok('?limit=200');
    const theirs = (await list('?limit=200', other.manager).expect(200)).body as AuditListResponse;
    const theirIds = new Set(theirs.events.map((e) => e.id));
    expect(mine.events.some((e) => theirIds.has(e.id))).toBe(false);
    expect(theirs.events.every((e) => e.resourceType === 'Organization' || e.actor === 'Mona Manager')).toBe(true);
    expect((await list()).headers['cache-control']).toBe('no-store');
  });
});

describe('GET /api/audit/verify', () => {
  it('confirms an intact chain and reports its tip hash', async () => {
    const w = await makeWorkspace();
    await createCase(w);
    const res = await request(app).get('/api/audit/verify').set(as(w.manager)).expect(200);
    const body = res.body as AuditVerifyResponse;
    expect(body.ok).toBe(true);
    expect(body.count).toBeGreaterThanOrEqual(2);
    const newest = await prisma.auditEvent.findFirstOrThrow({ where: { orgId: w.orgId }, orderBy: { id: 'desc' } });
    expect(body.tipHash).toBe(newest.hash);
    expect(Date.parse(body.verifiedAt)).toBeGreaterThan(Date.now() - 60_000);
  });

  it('detects a forged event slipped into the chain and says where', async () => {
    const w = await makeWorkspace();
    await createCase(w);
    const tip = await prisma.auditEvent.findFirstOrThrow({ where: { orgId: w.orgId }, orderBy: { id: 'desc' } });
    // An attacker with INSERT access (the one thing the append-only trigger allows) tries to add history.
    const forged = await prisma.auditEvent.create({
      data: { orgId: w.orgId, actorLabel: 'Attacker', actorRole: 'x', action: 'CASE_VIEWED', resourceType: 'ReferralCase', resourceId: 'REF-0000-0000', detail: 'backdated', prevHash: tip.hash, hash: 'f'.repeat(64) },
    });
    const body = (await request(app).get('/api/audit/verify').set(as(w.manager)).expect(200)).body as AuditVerifyResponse;
    expect(body).toMatchObject({ ok: false, brokenAtId: String(forged.id) });
    expect(body.reason).toMatch(/hash does not match/);
  });

  it('an empty chain is trivially valid', async () => {
    const empty = await prisma.organization.create({ data: { name: `Empty ${Date.now()}` } });
    const u = await prisma.user.create({ data: { orgId: empty.id, email: `e${Date.now()}@test.example`, passwordHash: 'x', name: 'E', role: 'DPO', accessScope: 's' } });
    const { signAccessToken } = await import('../auth/tokens');
    const res = await request(app).get('/api/audit/verify').set({ Authorization: `Bearer ${signAccessToken(u.id, empty.id)}` }).expect(200);
    expect(res.body).toMatchObject({ ok: true, count: 0, tipHash: null });
  });

  it('is restricted like the audit log itself', async () => {
    expect((await request(app).get('/api/audit/verify').set(as(ws.coordinator))).status).toBe(403);
    expect((await request(app).get('/api/audit/verify')).status).toBe(401);
  });
});

describe('batch append', () => {
  it('produces exactly the chain that one-at-a-time appends would', async () => {
    const mk = async () => (await prisma.organization.create({ data: { name: `Batch ${Date.now()}-${Math.random()}` } })).id;
    const [a, b] = [await mk(), await mk()];
    const at = new Date('2026-11-19T10:00:00.000Z');
    const ev = (orgId: string, n: number) => ({ orgId, at, actorId: null, actorLabel: 'T', actorRole: 'T', action: 'X', resourceType: 'R', resourceId: `R${n}`, detail: `d${n}` });

    for (let n = 0; n < 5; n++) await prisma.$transaction((tx) => appendAudit(tx, ev(a, n)));
    await prisma.$transaction((tx) => appendAuditBatch(tx, Array.from({ length: 5 }, (_, n) => ev(b, n))));

    const hashes = async (org: string) => (await prisma.auditEvent.findMany({ where: { orgId: org }, orderBy: { id: 'asc' } })).map((e) => e.hash);
    // Different orgs hash differently (orgId is hashed), so compare the structure: link-by-link validity.
    for (const org of [a, b]) {
      const rows = await prisma.auditEvent.findMany({ where: { orgId: org }, orderBy: { id: 'asc' } });
      let prev = GENESIS_HASH;
      for (const r of rows) {
        expect(r.prevHash).toBe(prev);
        expect(r.hash).toBe(computeAuditHash(prev, r));
        prev = r.hash;
      }
    }
    expect((await hashes(a)).length).toBe((await hashes(b)).length);
  });

  it('rejects a batch that mixes organisations', async () => {
    const at = new Date();
    const e = (orgId: string) => ({ orgId, at, actorId: null, actorLabel: 'T', actorRole: 'T', action: 'X', resourceType: 'R', resourceId: 'R', detail: 'd' });
    await expect(prisma.$transaction((tx) => appendAuditBatch(tx, [e('a'), e('b')]))).rejects.toThrow(/one organisation/);
  });
});

describe('the audit log has exactly one write path', () => {
  /** A guard against drift: any new code that creates audit rows must go through appendAudit/appendAuditBatch. */
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = path.join(dir, f);
      if (f === 'generated' || f === 'node_modules') return [];
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
    });

  it('only audit/append.ts writes AuditEvent rows', () => {
    const offenders = walk('server').filter((f) => {
      if (f.endsWith(path.join('audit', 'append.ts'))) return false;
      return /auditEvent\s*\.\s*(create|createMany|createManyAndReturn|upsert|update|updateMany|delete|deleteMany)\b/.test(readFileSync(f, 'utf8'))
        || /INSERT\s+INTO\s+"AuditEvent"/i.test(readFileSync(f, 'utf8'));
    });
    expect(offenders).toEqual([]);
  });
});
