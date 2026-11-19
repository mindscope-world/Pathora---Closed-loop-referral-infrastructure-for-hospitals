import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '../../db/generated/client';
import { authenticate, requirePermission } from '../../middleware/auth';
import { caseScope } from '../../middleware/tenant';
import { errorHandler } from '../../middleware/errorHandler';
import { prisma } from '../../test/helpers';
import { can, PERMISSIONS, type Permission } from './permissions';
import { signAccessToken } from './tokens';
import type { AuthContext } from '../../types';

const ROLES: Role[] = ['PROGRAMME_MANAGER', 'PROGRAMME_COORDINATOR', 'FACILITY_FOCAL', 'CLINICAL_LEAD', 'DPO'];
const [MGR, COORD, FOCAL, CLIN, DPO] = ROLES;

/** The matrix from plan.md Phase 2, written out independently of permissions.ts so a typo there fails here. */
const EXPECTED: Record<string, Role[]> = {
  'cases.create': [MGR, COORD],
  'cases.import': [MGR, COORD],
  'cases.acknowledge': [FOCAL],
  'cases.attend': [FOCAL],
  'cases.close': [FOCAL],
  'cases.escalate': [MGR, COORD, CLIN],
  'cases.barrier': [MGR, COORD, CLIN],
  'cases.reassign': [MGR],
  'comms.send': [MGR, COORD],
  'templates.manage': [MGR, COORD],
  'templates.approve': [CLIN],
  'rulepacks.edit': [CLIN],
  'consent.manage': [DPO],
  'audit.read': [MGR, CLIN, DPO],
  'exports.create': [MGR, CLIN, DPO],
  'team.manage': [MGR],
};

describe('permission matrix', () => {
  it.each(Object.entries(EXPECTED))('%s is granted to exactly the planned roles', (permission, allowed) => {
    for (const role of ROLES) {
      expect(can(role, permission as Permission), `${role} → ${permission}`).toBe(allowed.includes(role));
    }
  });

  it('keeps patient-data permissions away from the roles that should not have them', () => {
    expect(can(FOCAL, 'comms.read')).toBe(false);
    expect(can(FOCAL, 'comms.send')).toBe(false);
    expect(can(FOCAL, 'audit.read')).toBe(false);
    expect(can(COORD, 'rulepacks.edit')).toBe(false);
    expect(can(MGR, 'rulepacks.edit')).toBe(false); // clinical governance stays with the clinical lead
    expect(can(MGR, 'cases.close')).toBe(false); // outcomes come from the receiving facility
  });

  it('every permission is granted to at least one role, and every role has at least one permission', () => {
    for (const [p, roles] of Object.entries(PERMISSIONS)) expect(roles.length, p).toBeGreaterThan(0);
    for (const r of ROLES) expect(Object.keys(PERMISSIONS).some((p) => can(r, p as Permission)), r).toBe(true);
  });
});

describe('requirePermission middleware', () => {
  const app = express();
  app.get('/rules', authenticate, requirePermission('rulepacks.edit'), (_req, res) => res.json({ ok: true }));
  app.get('/cases', authenticate, requirePermission('cases.read'), (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);

  const tokens = new Map<Role, string>();
  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: `RBAC ${Date.now()}` } });
    const facility = await prisma.facility.create({
      data: { orgId: org.id, name: 'F', type: 'PUBLIC_REFERRAL', city: 'Nairobi', interopMethod: 'PORTAL_CSV' },
    });
    for (const role of ROLES) {
      const u = await prisma.user.create({
        data: {
          orgId: org.id, email: `${role.toLowerCase()}.${Date.now()}@test.example`, passwordHash: 'x', name: role, role, accessScope: 's',
          facilityId: role === 'FACILITY_FOCAL' ? facility.id : undefined,
        },
      });
      tokens.set(role, signAccessToken(u.id, org.id));
    }
  });
  afterAll(() => prisma.$disconnect());

  it('401 without a token, 403 for the wrong role, 200 for the right one', async () => {
    expect((await request(app).get('/rules')).status).toBe(401);
    for (const role of ROLES) {
      const res = await request(app).get('/rules').set('Authorization', `Bearer ${tokens.get(role)}`);
      expect(res.status, role).toBe(role === CLIN ? 200 : 403);
      if (role !== CLIN) expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('every role can read cases', async () => {
    for (const role of ROLES) {
      expect((await request(app).get('/cases').set('Authorization', `Bearer ${tokens.get(role)}`)).status, role).toBe(200);
    }
  });

  it('uses the role in the database, not anything the client claims', async () => {
    const org = await prisma.organization.create({ data: { name: `RoleChange ${Date.now()}` } });
    const u = await prisma.user.create({
      data: { orgId: org.id, email: `rc.${Date.now()}@test.example`, passwordHash: 'x', name: 'RC', role: 'CLINICAL_LEAD', accessScope: 's' },
    });
    const token = signAccessToken(u.id, org.id);
    expect((await request(app).get('/rules').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    await prisma.user.update({ where: { id: u.id }, data: { role: 'PROGRAMME_COORDINATOR' } });
    expect((await request(app).get('/rules').set('Authorization', `Bearer ${token}`)).status).toBe(403);
  });
});

describe('caseScope', () => {
  const base: AuthContext = { userId: 'u', orgId: 'org1', role: 'PROGRAMME_MANAGER', facilityId: null, name: 'n', email: 'e' };

  it('scopes everyone to their organisation', () => {
    for (const role of [MGR, COORD, CLIN, DPO]) expect(caseScope({ ...base, role })).toEqual({ orgId: 'org1' });
  });

  it('scopes facility focals to their own facility', () => {
    expect(caseScope({ ...base, role: FOCAL, facilityId: 'fac1' })).toEqual({ orgId: 'org1', facilityId: 'fac1' });
  });

  it('shows a facility focal with no facility nothing, rather than everything', () => {
    expect(caseScope({ ...base, role: FOCAL, facilityId: null })).toEqual({ orgId: 'org1', facilityId: '__none__' });
  });
});
