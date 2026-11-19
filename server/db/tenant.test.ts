import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from './client';
import { forOrg } from './tenant';
import { encryptField, aad } from '../lib/crypto';

let a: string, b: string;
let facA: string, facB: string, patB: string;

beforeAll(async () => {
  const stamp = Date.now();
  a = (await prisma.organization.create({ data: { name: `Tenant A ${stamp}` } })).id;
  b = (await prisma.organization.create({ data: { name: `Tenant B ${stamp}` } })).id;
  const mk = (orgId: string, name: string) =>
    prisma.facility.create({ data: { orgId, name, type: 'PUBLIC_REFERRAL', city: 'X', interopMethod: 'PORTAL_CSV' } });
  facA = (await mk(a, 'A-1')).id;
  await mk(a, 'A-2');
  facB = (await mk(b, 'B-1')).id;
  patB = (await prisma.patient.create({
    data: { orgId: b, patientCode: 'PT-B', nameEnc: encryptField('B Patient', aad.patientName(b)), label: 'l' },
  })).id;
});
afterAll(() => prisma.$disconnect());

describe('forOrg tenant isolation', () => {
  it('lists only the caller’s rows', async () => {
    const rows = await forOrg(a).facility.findMany();
    expect(rows.map((r) => r.name).sort()).toEqual(['A-1', 'A-2']);
    expect(await forOrg(b).facility.count()).toBe(1);
  });

  it('cannot read another tenant’s row by id', async () => {
    expect(await forOrg(a).facility.findUnique({ where: { id: facB } })).toBeNull();
    expect(await forOrg(a).facility.findFirst({ where: { id: facB } })).toBeNull();
    await expect(forOrg(a).facility.findUniqueOrThrow({ where: { id: facB } })).rejects.toThrow();
    expect(await forOrg(a).patient.findUnique({ where: { id: patB } })).toBeNull();
  });

  it('keeps the caller’s own filters (scope is ANDed, not replaced)', async () => {
    expect(await forOrg(a).facility.findMany({ where: { name: 'A-1' } })).toHaveLength(1);
    expect(await forOrg(a).facility.findMany({ where: { name: 'B-1' } })).toHaveLength(0);
  });

  it('cannot update or delete another tenant’s row', async () => {
    await expect(forOrg(a).facility.update({ where: { id: facB }, data: { city: 'Hacked' } })).rejects.toThrow();
    expect((await forOrg(a).facility.updateMany({ where: { id: facB }, data: { city: 'Hacked' } })).count).toBe(0);
    await expect(forOrg(a).facility.delete({ where: { id: facB } })).rejects.toThrow();
    expect((await forOrg(a).facility.deleteMany({ where: { id: facB } })).count).toBe(0);
    expect((await prisma.facility.findUniqueOrThrow({ where: { id: facB } })).city).toBe('X');
  });

  it('a bulk update/delete with no filter only touches the caller’s tenant', async () => {
    await forOrg(a).facility.updateMany({ data: { city: 'Mombasa' } });
    expect((await prisma.facility.findMany({ where: { orgId: a } })).every((f) => f.city === 'Mombasa')).toBe(true);
    expect((await prisma.facility.findUniqueOrThrow({ where: { id: facB } })).city).toBe('X');
  });

  it('stamps orgId on create, and refuses to create into another org', async () => {
    const created = await forOrg(a).facility.create({
      data: { name: 'Stamped', type: 'FAITH_BASED', city: 'Y', interopMethod: 'API_READY' } as any,
    });
    expect(created.orgId).toBe(a);
    await expect(
      forOrg(a).facility.create({ data: { orgId: b, name: 'Smuggled', type: 'FAITH_BASED', city: 'Y', interopMethod: 'API_READY' } }),
    ).rejects.toMatchObject({ code: 'CROSS_TENANT' });
    expect(await prisma.facility.count({ where: { orgId: b, name: 'Smuggled' } })).toBe(0);
  });

  it('refuses to move a row to another org via update', async () => {
    await expect(forOrg(a).facility.update({ where: { id: facA }, data: { orgId: b } })).rejects.toMatchObject({ code: 'CROSS_TENANT' });
    expect((await prisma.facility.findUniqueOrThrow({ where: { id: facA } })).orgId).toBe(a);
  });

  it('scopes createMany, upsert, aggregate and groupBy', async () => {
    await forOrg(a).facility.createMany({
      data: [{ name: 'Bulk-1', type: 'PUBLIC_REFERRAL', city: 'Z', interopMethod: 'PORTAL_CSV' } as any],
    });
    expect(await prisma.facility.count({ where: { orgId: a, name: 'Bulk-1' } })).toBe(1);
    await expect(
      forOrg(a).facility.createMany({ data: [{ orgId: b, name: 'Bulk-X', type: 'PUBLIC_REFERRAL', city: 'Z', interopMethod: 'PORTAL_CSV' }] }),
    ).rejects.toMatchObject({ code: 'CROSS_TENANT' });

    const up = await forOrg(a).facility.upsert({
      where: { id: facB }, // another tenant's id: must NOT match, so it creates in A instead of updating B
      create: { name: 'Upserted', type: 'PUBLIC_REFERRAL', city: 'Q', interopMethod: 'PORTAL_CSV' } as any,
      update: { city: 'Hacked' },
    }).catch((e) => e);
    expect((await prisma.facility.findUniqueOrThrow({ where: { id: facB } })).city).toBe('X');
    if (!(up instanceof Error)) expect(up.orgId).toBe(a);

    const agg = await forOrg(b).facility.aggregate({ _count: true });
    expect(agg._count).toBe(1);
    const groups = await forOrg(a).facility.groupBy({ by: ['city'], _count: true });
    expect(groups.reduce((n, g) => n + g._count, 0)).toBe(await prisma.facility.count({ where: { orgId: a } }));
  });

  it('applies to every org-owned model, not just facilities', async () => {
    expect(await forOrg(a).patient.count()).toBe(0);
    expect(await forOrg(b).patient.count()).toBe(1);
    expect(await forOrg(a).user.count()).toBe(0);
    expect(await forOrg(a).auditEvent.count()).toBe(0);
    expect(await forOrg(a).referralCase.findMany()).toEqual([]);
  });

  it('requires an org id', () => {
    expect(() => forOrg('')).toThrow();
  });
});
