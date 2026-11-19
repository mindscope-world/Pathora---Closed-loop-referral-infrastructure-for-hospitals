import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ROLE_SCOPES, type AuthSessionResponse, type CaseDto, type InviteCreatedResponse, type InviteRequest, type TeamMemberDto, type TeamResponse } from '../../../shared/types';
import { createApp } from '../../app';
import { setMailer, type MailMessage, type Mailer } from '../../lib/mailer';
import { cookieFrom, prisma, rawSetCookie, uniqueEmail } from '../../test/helpers';
import { act, app, as, createCase, makeWorkspace, type Actor, type Workspace } from '../../test/workspace';
import { verifyAuditChain } from '../audit/append';
import { MAX_PENDING_INVITES } from './service';

let ws: Workspace;
beforeAll(async () => {
  ws = await makeWorkspace();
});
afterAll(() => prisma.$disconnect());
afterEach(() => setMailer(undefined));

const GOOD_PASSWORD = 'correct horse battery staple';

const inviteBody = (over: Partial<InviteRequest> = {}): InviteRequest => ({ email: uniqueEmail('invitee'), name: 'Ivy Invitee', role: 'PROGRAMME_COORDINATOR', ...over });
const invite = (over: Partial<InviteRequest> = {}, actor: Actor = ws.manager, w: Workspace = ws) =>
  request(app).post('/api/users/invite').set(as(actor)).send({ ...inviteBody(), ...(w === ws ? {} : {}), ...over });
const tokenOf = (inviteUrl: string) => new URL(inviteUrl).searchParams.get('invite')!;
const lookup = (token: string) => request(app).post('/api/invites/lookup').send({ token });
const accept = (token: string, body: object = {}) => request(app).post('/api/invites/accept').send({ token, password: GOOD_PASSWORD, ...body });
const team = async (actor: Actor = ws.manager) => (await request(app).get('/api/users').set(as(actor)).expect(200)).body as TeamResponse;
const patch = (id: string, body: object, actor: Actor = ws.manager) => request(app).patch(`/api/users/${id}`).set(as(actor)).send(body);
const actions = async (orgId: string, resourceId: string) => (await prisma.auditEvent.findMany({ where: { orgId, resourceId }, orderBy: { id: 'asc' } })).map((e) => e.action);

/** Invite + accept: returns a real, signed-in new member. */
async function join(w: Workspace, over: Partial<InviteRequest> = {}) {
  const created = (await invite(over, w.manager, w).expect(201)).body as InviteCreatedResponse;
  const res = await accept(tokenOf(created.inviteUrl)).expect(201);
  const session = res.body as AuthSessionResponse;
  return { session, cookie: cookieFrom(res)!, actor: { id: session.user.id, name: session.user.name, token: session.accessToken } as Actor, email: created.invite.email };
}

describe('GET /api/users', () => {
  it('lists members with role, facility, scope, status and the open referrals they own', async () => {
    const a = await createCase(ws); await createCase(ws);
    await advance_close(a.id);
    const { members, invites } = await team();
    const cora = members.find((m) => m.id === ws.coordinator.id)!;
    expect(cora).toMatchObject({ name: 'Cora Coordinator', role: 'PROGRAMME_COORDINATOR', active: true, facility: null, openCases: 1 });
    expect(members.find((m) => m.id === ws.focalA.id)!.facility).toEqual({ id: ws.facilityA.id, name: ws.facilityA.name });
    expect(members.find((m) => m.id === ws.manager.id)!.openCases).toBe(0);
    expect(members.length).toBe(7);
    expect(invites).toEqual([]);
  });

  async function advance_close(ref: string) {
    await act(ws.focalA, ref, 'acknowledge').expect(200);
    await act(ws.focalA, ref, 'attendance').expect(200);
    await act(ws.focalA, ref, 'close', { closureReason: 'Care plan documented' }).expect(200);
  }

  it('is readable by manager, clinical lead and DPO only, never leaks credentials, and is private to the organisation', async () => {
    for (const a of [ws.manager, ws.clinical, ws.dpo]) expect((await request(app).get('/api/users').set(as(a))).status, a.name).toBe(200);
    for (const a of [ws.coordinator, ws.focalA]) expect((await request(app).get('/api/users').set(as(a))).status, a.name).toBe(403);
    expect((await request(app).get('/api/users')).status).toBe(401);
    const body = JSON.stringify(await team());
    expect(body).not.toMatch(/passwordHash|tokenHash|argon2/);
    const other = await makeWorkspace();
    expect((await team(other.manager)).members.map((m) => m.id)).not.toContain(ws.manager.id);
  });
});

describe('creating invitations', () => {
  it('creates a pending invitation with a single-use link, and records it', async () => {
    const body = inviteBody({ email: 'Mixed.Case@Example.ORG', name: 'Mixed Case' });
    const res = await invite(body).expect(201);
    const { invite: inv, inviteUrl, emailed } = res.body as InviteCreatedResponse;
    expect(emailed).toBe(false); // no mailer configured: the inviter shares the link
    expect(inv).toMatchObject({ email: 'mixed.case@example.org', name: 'Mixed Case', role: 'PROGRAMME_COORDINATOR', status: 'PENDING', invitedBy: 'Mona Manager', facility: null });
    expect(Date.parse(inv.expiresAt) - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    expect(inviteUrl).toMatch(/^http:\/\/localhost:3000\/\?invite=[A-Za-z0-9_-]{43}$/);

    // Only a hash is stored: the token appears nowhere in the database.
    const token = tokenOf(inviteUrl);
    const row = await prisma.invite.findUniqueOrThrow({ where: { id: inv.id } });
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { orgId: ws.orgId, resourceId: inv.id } });
    expect(ev).toMatchObject({ action: 'USER_INVITED', actorId: ws.manager.id });
    expect(ev.detail).toBe('Invited Mixed Case (mixed.case@example.org) as Programme Coordinator.');
    expect((await team()).invites.map((i) => i.id)).toContain(inv.id);
    expect(JSON.stringify(await team())).not.toContain(token);
  });

  it('ties a facility focal to a facility', async () => {
    const res = await invite({ role: 'FACILITY_FOCAL', facilityId: ws.facilityB.id }).expect(201);
    expect(res.body.invite.facility).toEqual({ id: ws.facilityB.id, name: ws.facilityB.name });
  });

  it.each([
    ['bad email', { email: 'nope' }, 400],
    ['name too short', { name: 'A' }, 400],
    ['name with a line break (header injection)', { name: 'Evil\nBcc: attacker@example.org' }, 400],
    ['unknown role', { role: 'ADMIN' as never }, 400],
    ['focal without a facility', { role: 'FACILITY_FOCAL' as const }, 400],
    ['facility on a non-focal role', { facilityId: 'x'.repeat(25) }, 400],
    ['unknown facility', { role: 'FACILITY_FOCAL' as const, facilityId: 'c'.repeat(25) }, 422],
  ])('rejects %s', async (_l, over, status) => {
    expect((await invite(over)).status).toBe(status);
  });

  it('cannot use another organisation’s facility', async () => {
    const other = await makeWorkspace();
    expect((await invite({ role: 'FACILITY_FOCAL', facilityId: other.facilityA.id })).status).toBe(422);
  });

  it('refuses an address that already has an account, in this or ANY organisation, with an identical answer', async () => {
    const other = await makeWorkspace();
    const otherEmail = (await prisma.user.findUniqueOrThrow({ where: { id: other.coordinator.id } })).email;
    const mine = (await prisma.user.findUniqueOrThrow({ where: { id: ws.coordinator.id } })).email;
    const a = await invite({ email: mine });
    const b = await invite({ email: otherEmail });
    const c = await invite({ email: mine.toUpperCase() });
    for (const r of [a, b, c]) {
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('EMAIL_UNAVAILABLE');
    }
    expect({ ...a.body.error, requestId: 0 }).toEqual({ ...b.body.error, requestId: 0 }); // does not reveal which case it was
  });

  it('re-inviting replaces the earlier link, which stops working', async () => {
    const email = uniqueEmail('twice');
    const first = tokenOf((await invite({ email }).expect(201)).body.inviteUrl);
    const second = tokenOf((await invite({ email }).expect(201)).body.inviteUrl);
    expect((await lookup(first)).status).toBe(410);
    expect((await lookup(second)).status).toBe(200);
    expect((await team()).invites.filter((i) => i.email === email)).toHaveLength(1);
  });

  it('caps the number of waiting invitations', async () => {
    const w = await makeWorkspace();
    await prisma.invite.createMany({
      data: Array.from({ length: MAX_PENDING_INVITES }, (_, i) => ({
        orgId: w.orgId, email: `cap${i}.${Date.now()}@test.example`, name: 'Cap', role: 'DPO' as const, invitedById: w.manager.id,
        tokenHash: `${i}`.padStart(64, 'a'), expiresAt: new Date(Date.now() + 86_400_000),
      })),
    });
    const res = await invite({}, w.manager, w);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('TOO_MANY_INVITES');
  });

  it('is limited to the Programme Manager', async () => {
    for (const a of [ws.clinical, ws.dpo, ws.coordinator, ws.focalA]) expect((await invite({}, a)).status, a.name).toBe(403);
    expect((await request(app).post('/api/users/invite').send(inviteBody())).status).toBe(401);
  });

  it('a double-click with an Idempotency-Key creates one invitation', async () => {
    const body = inviteBody();
    const send = () => request(app).post('/api/users/invite').set(as(ws.manager)).set('Idempotency-Key', 'invite-key-0001').send(body);
    const [a, b] = [await send().expect(201), await send().expect(201)];
    expect(b.body.inviteUrl).toBe(a.body.inviteUrl);
    expect(await prisma.invite.count({ where: { orgId: ws.orgId, email: body.email } })).toBe(1);
  });

  describe('email delivery', () => {
    const capturing = () => {
      const sent: MailMessage[] = [];
      const mailer: Mailer = { configured: true, send: async (m) => void sent.push(m) };
      return { sent, mailer };
    };

    it('emails the link when a mailer is configured', async () => {
      const { sent, mailer } = capturing();
      setMailer(mailer);
      const res = await invite({ email: 'real.person@example.org', name: 'Real Person', role: 'CLINICAL_LEAD' }).expect(201);
      expect(res.body.emailed).toBe(true);
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe('real.person@example.org');
      expect(sent[0].subject).toContain('Mona Manager invited you to join');
      expect(sent[0].text).toContain(res.body.inviteUrl);
      expect(sent[0].text).toContain('Partner Clinical Lead');
      expect(sent[0].text).toMatch(/expires in 7 days/);
    });

    it('still creates the invitation (and says it was not emailed) if the mail server fails', async () => {
      setMailer({ configured: true, send: async () => { throw new Error('SMTP down'); } });
      const res = await invite().expect(201);
      expect(res.body.emailed).toBe(false);
      expect((await lookup(tokenOf(res.body.inviteUrl))).status).toBe(200);
    });

    it('sends nothing when no mailer is configured', async () => {
      const { sent } = capturing();
      const res = await invite().expect(201);
      expect(res.body.emailed).toBe(false);
      expect(sent).toHaveLength(0);
    });
  });
});

describe('revoking invitations', () => {
  it('kills the link, records it, and cannot be repeated', async () => {
    const created = (await invite().expect(201)).body as InviteCreatedResponse;
    const token = tokenOf(created.inviteUrl);
    await request(app).post(`/api/users/invites/${created.invite.id}/revoke`).set(as(ws.manager)).expect(204);
    expect((await lookup(token)).status).toBe(410);
    expect((await accept(token)).status).toBe(410);
    expect(await actions(ws.orgId, created.invite.id)).toEqual(['USER_INVITED', 'USER_INVITE_REVOKED']);
    expect((await team()).invites.map((i) => i.id)).not.toContain(created.invite.id);
    expect((await request(app).post(`/api/users/invites/${created.invite.id}/revoke`).set(as(ws.manager))).status).toBe(404);
  });

  it('is restricted to managers of the same organisation', async () => {
    const created = (await invite().expect(201)).body as InviteCreatedResponse;
    const other = await makeWorkspace();
    expect((await request(app).post(`/api/users/invites/${created.invite.id}/revoke`).set(as(other.manager))).status).toBe(404);
    expect((await request(app).post(`/api/users/invites/${created.invite.id}/revoke`).set(as(ws.coordinator))).status).toBe(403);
    expect((await request(app).post('/api/users/invites/nope/revoke').set(as(ws.manager))).status).toBe(404);
    expect((await lookup(tokenOf(created.inviteUrl))).status).toBe(200); // untouched
  });
});

describe('accepting an invitation (public)', () => {
  it('shows who invited you, to what, without revealing anything else', async () => {
    const created = (await invite({ name: 'Look Up', role: 'DPO' }).expect(201)).body as InviteCreatedResponse;
    const res = await lookup(tokenOf(created.inviteUrl)).expect(200);
    expect(res.body).toEqual({ email: created.invite.email, name: 'Look Up', role: 'DPO', organization: expect.any(String), invitedBy: 'Mona Manager', expiresAt: created.invite.expiresAt });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('creates the account, signs the person in, and applies the role’s defaults', async () => {
    const f = await join(ws, { role: 'FACILITY_FOCAL', facilityId: ws.facilityA.id, name: 'Focal Newcomer' });
    expect(f.session.user).toMatchObject({ name: 'Focal Newcomer', role: 'FACILITY_FOCAL', facilityId: ws.facilityA.id });
    expect(f.session.user.organization.id).toBe(ws.orgId);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: f.actor.id } });
    expect(user).toMatchObject({ accessScope: ROLE_SCOPES.FACILITY_FOCAL, affiliation: ws.facilityA.name, active: true, orgId: ws.orgId });
    expect(user.lastLoginAt).toBeTruthy();
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(GOOD_PASSWORD);

    const cookie = rawSetCookie(await accept(tokenOf((await invite({ name: 'Another One' }).expect(201)).body.inviteUrl)).expect(201))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);

    const me = await request(app).get('/api/auth/me').set(as(f.actor)).expect(200);
    expect(me.body.user.email).toBe(f.email);
    // and they can sign in later with the password they chose
    expect((await request(app).post('/api/auth/login').send({ email: f.email, password: GOOD_PASSWORD })).status).toBe(200);
  });

  it('lets the invitee correct their name, and audits the acceptance under their own name', async () => {
    const created = (await invite({ name: 'Typo Nmae' }).expect(201)).body as InviteCreatedResponse;
    const res = await accept(tokenOf(created.inviteUrl), { name: 'Correct Name' }).expect(201);
    expect(res.body.user.name).toBe('Correct Name');
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { orgId: ws.orgId, action: 'USER_INVITE_ACCEPTED', resourceId: res.body.user.id } });
    expect(ev).toMatchObject({ actorId: res.body.user.id, actorLabel: 'Correct Name' });
    expect(await verifyAuditChain(prisma, ws.orgId)).toMatchObject({ ok: true });
  });

  it('a new facility focal immediately sees only their own facility’s referrals', async () => {
    const c = await createCase(ws, { facilityId: ws.facilityA.id });
    const other = await createCase(ws, { facilityId: ws.facilityB.id });
    const f = await join(ws, { role: 'FACILITY_FOCAL', facilityId: ws.facilityA.id });
    const list = (await request(app).get('/api/cases?limit=200').set(as(f.actor)).expect(200)).body.cases as CaseDto[];
    expect(list.map((x) => x.id)).toContain(c.id);
    expect(list.map((x) => x.id)).not.toContain(other.id);
  });

  it('works exactly once, even when accepted simultaneously', async () => {
    const created = (await invite().expect(201)).body as InviteCreatedResponse;
    const token = tokenOf(created.inviteUrl);
    const results = await Promise.all([accept(token), accept(token), accept(token)]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 410)).toHaveLength(2);
    expect(await prisma.user.count({ where: { email: created.invite.email } })).toBe(1);
    expect((await accept(token)).status).toBe(410);
  });

  it('treats unknown, expired, revoked and used links identically, so nothing can be learned from them', async () => {
    const expired = tokenOf((await invite().expect(201)).body.inviteUrl);
    await prisma.invite.updateMany({ where: { tokenHash: (await import('../auth/tokens')).hashToken(expired) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const used = tokenOf((await invite().expect(201)).body.inviteUrl);
    await accept(used).expect(201);
    const results = await Promise.all([expired, used, 'A'.repeat(43)].map((t) => lookup(t)));
    for (const r of results) {
      expect(r.status).toBe(410);
      expect(r.body.error.code).toBe('INVITE_INVALID');
    }
    expect(new Set(results.map((r) => r.body.error.message)).size).toBe(1);
    expect((await accept(expired)).status).toBe(410);
  });

  it('rejects malformed tokens and weak passwords, and an unregistered-in-between email conflict leaves the invite usable', async () => {
    const created = (await invite().expect(201)).body as InviteCreatedResponse;
    const token = tokenOf(created.inviteUrl);
    expect((await lookup('short')).status).toBe(400);
    expect((await request(app).post('/api/invites/lookup').send({})).status).toBe(400);
    const weak = await accept(token, { password: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe('VALIDATION_ERROR');

    // the address gets registered elsewhere between invite and acceptance
    await prisma.user.create({ data: { orgId: (await makeWorkspace()).orgId, email: created.invite.email, passwordHash: 'x', name: 'Squatter', role: 'DPO', accessScope: 's' } });
    const clash = await accept(token);
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('EMAIL_UNAVAILABLE');
    expect((await prisma.invite.findUniqueOrThrow({ where: { id: created.invite.id } })).acceptedAt).toBeNull(); // rolled back
  });

  it('never accepts the token in a URL (so it cannot reach access logs)', async () => {
    const created = (await invite().expect(201)).body as InviteCreatedResponse;
    const token = tokenOf(created.inviteUrl);
    expect((await request(app).get(`/api/invites/lookup?token=${token}`)).status).toBe(404);
    expect((await request(app).get(`/api/invites/${token}`)).status).toBe(404);
    expect((await request(app).post(`/api/invites/accept?token=${token}`).send({ password: GOOD_PASSWORD })).status).toBe(400);
  });

  it('is rate limited per IP', async () => {
    const strict = createApp({ invites: { maxPerIp: 3 }, exports: { kick: () => undefined } });
    for (let i = 0; i < 3; i++) expect((await request(strict).post('/api/invites/lookup').send({ token: 'A'.repeat(43) })).status).toBe(410);
    const blocked = await request(strict).post('/api/invites/lookup').send({ token: 'A'.repeat(43) });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('managing members', () => {
  it('deactivating signs the person out everywhere at once, and is reversible', async () => {
    const w = await makeWorkspace();
    const m = await join(w, { name: 'Soon Gone' });
    expect((await request(app).get('/api/auth/me').set(as(m.actor))).status).toBe(200);

    const res = await patch(m.actor.id, { active: false }, w.manager).expect(200);
    expect(res.body).toMatchObject({ id: m.actor.id, active: false });

    expect((await request(app).get('/api/auth/me').set(as(m.actor))).status).toBe(401); // existing access token: dead immediately
    expect((await request(app).post('/api/auth/refresh').set('Cookie', `pathora_rt=${m.cookie}`)).status).toBe(401); // refresh token: dead
    expect((await request(app).post('/api/auth/login').send({ email: m.email, password: GOOD_PASSWORD })).status).toBe(401); // cannot sign in
    expect(await prisma.refreshToken.count({ where: { userId: m.actor.id, revokedAt: null } })).toBe(0);
    expect(await actions(w.orgId, m.actor.id)).toContain('USER_DEACTIVATED');

    await patch(m.actor.id, { active: true }, w.manager).expect(200);
    expect((await request(app).post('/api/auth/login').send({ email: m.email, password: GOOD_PASSWORD })).status).toBe(200);
    expect(await actions(w.orgId, m.actor.id)).toContain('USER_REACTIVATED');
  });

  it('reports referrals a deactivated person still owns, and removes them from the assignable owners', async () => {
    const w = await makeWorkspace();
    await createCase(w); await createCase(w);
    const res = await patch(w.coordinator.id, { active: false }, w.manager).expect(200);
    expect(res.body.openCases).toBe(2); // the UI uses this to prompt a reassignment
    const owners = (await request(app).get('/api/cases/assignees').set(as(w.manager)).expect(200)).body.assignees as { id: string }[];
    expect(owners.map((o) => o.id)).not.toContain(w.coordinator.id);
  });

  it('refuses to let you deactivate or re-role yourself', async () => {
    for (const body of [{ active: false }, { role: 'DPO' }]) {
      const r = await patch(ws.manager.id, body);
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('CANNOT_CHANGE_SELF');
    }
    expect((await patch(ws.manager.id, { name: 'Mona Renamed' })).status).toBe(200); // other edits are fine
    await patch(ws.manager.id, { name: 'Mona Manager' }).expect(200);
  });

  it('role changes apply immediately, update the access scope, and are audited', async () => {
    const w = await makeWorkspace();
    expect((await request(app).get('/api/audit').set(as(w.coordinator))).status).toBe(403);
    const res = await patch(w.coordinator.id, { role: 'CLINICAL_LEAD' }, w.manager).expect(200);
    expect(res.body).toMatchObject({ role: 'CLINICAL_LEAD', accessScope: ROLE_SCOPES.CLINICAL_LEAD });
    expect((await request(app).get('/api/audit').set(as(w.coordinator))).status).toBe(200); // same token, new powers
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { orgId: w.orgId, resourceId: w.coordinator.id, action: 'USER_ROLE_CHANGED' } });
    expect(ev.detail).toBe('Cora Coordinator: role Programme Coordinator → Partner Clinical Lead.');
  });

  it('a facility focal must keep a facility; moving away from the role clears it', async () => {
    const w = await makeWorkspace();
    const toFocal = await patch(w.coordinator.id, { role: 'FACILITY_FOCAL' }, w.manager);
    expect(toFocal.status).toBe(422);
    expect((await patch(w.coordinator.id, { role: 'FACILITY_FOCAL', facilityId: 'c'.repeat(25) }, w.manager)).status).toBe(422);
    expect((await patch(w.coordinator.id, { role: 'FACILITY_FOCAL', facilityId: (await makeWorkspace()).facilityA.id }, w.manager)).status).toBe(422); // another org's facility
    const ok = await patch(w.coordinator.id, { role: 'FACILITY_FOCAL', facilityId: w.facilityB.id }, w.manager).expect(200);
    expect(ok.body.facility).toEqual({ id: w.facilityB.id, name: w.facilityB.name });

    const moved = await patch(w.coordinator.id, { facilityId: w.facilityA.id }, w.manager).expect(200);
    expect(moved.body.facility.id).toBe(w.facilityA.id);
    expect(await actions(w.orgId, w.coordinator.id)).toContain('USER_UPDATED');

    const back = await patch(w.coordinator.id, { role: 'PROGRAMME_COORDINATOR' }, w.manager).expect(200);
    expect(back.body.facility).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: w.coordinator.id } })).facilityId).toBeNull();
  });

  it('a no-op change writes nothing and leaves no audit entry', async () => {
    const w = await makeWorkspace();
    const before = await prisma.auditEvent.count({ where: { orgId: w.orgId } });
    await patch(w.coordinator.id, { active: true, role: 'PROGRAMME_COORDINATOR', name: 'Cora Coordinator' }, w.manager).expect(200);
    expect(await prisma.auditEvent.count({ where: { orgId: w.orgId } })).toBe(before);
  });

  it('validates input and restricts the endpoint to managers of the same organisation', async () => {
    const other = await makeWorkspace();
    expect((await patch(ws.coordinator.id, {})).status).toBe(400);
    expect((await patch(ws.coordinator.id, { role: 'GOD' })).status).toBe(400);
    expect((await patch(ws.coordinator.id, { name: 'x' })).status).toBe(400);
    expect((await patch(ws.coordinator.id, { name: 'Line\nBreak' })).status).toBe(400);
    expect((await patch(other.coordinator.id, { active: false })).status).toBe(404); // another org's user does not exist for you
    expect((await patch('nope', { active: false })).status).toBe(404);
    for (const a of [ws.clinical, ws.dpo, ws.coordinator, ws.focalA]) expect((await patch(ws.coordinator2.id, { active: false }, a)).status, a.name).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: other.coordinator.id } })).active).toBe(true);
  });

  describe('the organisation can never be left without a manager', () => {
    it('two managers demoting each other at the same moment: exactly one succeeds', async () => {
      for (let round = 0; round < 3; round++) {
        const w = await makeWorkspace();
        const second = await join(w, { role: 'PROGRAMME_MANAGER', name: 'Second Manager' });
        const results = await Promise.all([
          patch(second.actor.id, { role: 'DPO' }, w.manager),
          patch(w.manager.id, { role: 'DPO' }, second.actor),
        ]);
        const codes = results.map((r) => r.status).sort();
        expect(codes, JSON.stringify(results.map((r) => r.body))).toEqual([200, 409]);
        expect(results.find((r) => r.status === 409)!.body.error.code).toBe('LAST_MANAGER');
        expect(await prisma.user.count({ where: { orgId: w.orgId, role: 'PROGRAMME_MANAGER', active: true } })).toBe(1);
      }
    });

    it('two managers deactivating each other at the same moment: exactly one succeeds', async () => {
      const w = await makeWorkspace();
      const second = await join(w, { role: 'PROGRAMME_MANAGER', name: 'Second Manager' });
      const results = await Promise.all([patch(second.actor.id, { active: false }, w.manager), patch(w.manager.id, { active: false }, second.actor)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await prisma.user.count({ where: { orgId: w.orgId, role: 'PROGRAMME_MANAGER', active: true } })).toBe(1);
    });

    it('a manager may demote another while one remains', async () => {
      const w = await makeWorkspace();
      const second = await join(w, { role: 'PROGRAMME_MANAGER', name: 'Second Manager' });
      await patch(second.actor.id, { role: 'PROGRAMME_COORDINATOR' }, w.manager).expect(200);
      expect(await prisma.user.count({ where: { orgId: w.orgId, role: 'PROGRAMME_MANAGER', active: true } })).toBe(1);
    });
  });
});

void (null as unknown as TeamMemberDto);
