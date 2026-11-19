import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CaseDto, CreatedApiKeyResponse } from '../../../shared/types';
import { createApp } from '../../app';
import { generateApiKey, hashSecret, parseApiKey, secretMatches, signBody, verifySignature } from '../../integrations/apiKeys';
import { parseTask, TaskMappingError, toTask } from '../../integrations/fhir/task';
import { operationOutcome, toServiceRequest } from '../../integrations/fhir/serviceRequest';
import { prisma } from '../../test/helpers';
import { advance, app, as, createCase, makeWorkspace, type Workspace } from '../../test/workspace';
import { MAX_ACTIVE_KEYS_PER_FACILITY } from './keys';

let ws: Workspace;
let other: Workspace;
beforeAll(async () => {
  ws = await makeWorkspace();
  other = await makeWorkspace();
});
afterAll(() => prisma.$disconnect());

type Scope = 'referrals:read' | 'referrals:identify' | 'status:write';
const V1 = '/api/integrations/v1';

/** Keeps the facility under the per-facility key cap by revoking all but its two newest keys first (the cap has its own test). */
async function newKey(w: Workspace, facilityId: string, scopes: Scope[] = ['referrals:read', 'status:write'], extra: object = {}, prune = true): Promise<CreatedApiKeyResponse> {
  if (prune) {
    const keep = await prisma.facilityApiKey.findMany({ where: { facilityId, revokedAt: null }, orderBy: { createdAt: 'desc' }, take: 2, select: { id: true } });
    await prisma.facilityApiKey.updateMany({ where: { facilityId, revokedAt: null, id: { notIn: keep.map((k) => k.id) } }, data: { revokedAt: new Date() } });
  }
  const res = await request(app).post(`/api/facilities/${facilityId}/api-keys`).set(as(w.manager)).send({ name: `Key ${Math.random().toString(36).slice(2, 7)}`, scopes, ...extra });
  if (res.status !== 201) throw new Error(`createKey failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
const bearer = (k: { apiKey: string }) => ({ Authorization: `Bearer ${k.apiKey}` });
/** A correctly signed POST, the way a facility system would send it. */
const signedPost = (k: CreatedApiKeyResponse, path: string, body: object | string = {}, opts: { at?: Date; secret?: string; a?: typeof app } = {}) => {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return request(opts.a ?? app).post(`${V1}${path}`).set(bearer(k)).set('Content-Type', 'application/json').set('X-Pathora-Signature', signBody(opts.secret ?? k.signingSecret, raw, opts.at)).send(raw);
};
const get = (k: { apiKey: string }, path: string) => request(app).get(`${V1}${path}`).set(bearer(k));

describe('key primitives', () => {
  it('generates well-formed keys whose secret is never the stored value', () => {
    const k = generateApiKey();
    expect(k.apiKey).toMatch(/^pk_[a-z0-9]{12}\.[A-Za-z0-9_-]{43}$/);
    const p = parseApiKey(k.apiKey)!;
    expect(p.keyId).toBe(k.keyId);
    expect(k.secretHash).toBe(hashSecret(p.secret));
    expect(k.secretHash).not.toContain(p.secret);
    expect(secretMatches(p.secret, k.secretHash)).toBe(true);
    expect(secretMatches(`${p.secret.slice(0, -1)}x`, k.secretHash)).toBe(false);
    expect(generateApiKey().apiKey).not.toBe(k.apiKey);
  });

  it.each(['', 'pk_', 'pk_abc.def', 'sk_aaaaaaaaaaaa.' + 'a'.repeat(43), 'pk_aaaaaaaaaaaa.' + 'a'.repeat(42), 'pk_aaaaaaaaaaaa.' + 'a'.repeat(43) + 'x'])('rejects malformed key %#', (raw) => {
    expect(parseApiKey(raw)).toBeNull();
  });

  it('signatures: valid, tampered body, wrong secret, stale, future, malformed, missing', () => {
    const now = new Date('2026-11-20T10:00:00Z');
    const body = Buffer.from('{"a":1}');
    const sig = signBody('whsec_x', body, now);
    expect(verifySignature('whsec_x', body, sig, now)).toBe('ok');
    expect(verifySignature('whsec_x', Buffer.from('{"a":2}'), sig, now)).toBe('mismatch');
    expect(verifySignature('whsec_y', body, sig, now)).toBe('mismatch');
    expect(verifySignature('whsec_x', body, sig, new Date(now.getTime() + 301_000))).toBe('stale');
    expect(verifySignature('whsec_x', body, sig, new Date(now.getTime() - 301_000))).toBe('stale');
    expect(verifySignature('whsec_x', body, sig, new Date(now.getTime() + 299_000))).toBe('ok');
    expect(verifySignature('whsec_x', body, 'v1=abc', now)).toBe('malformed');
    expect(verifySignature('whsec_x', body, `t=1,v1=${'0'.repeat(63)}`, now)).toBe('malformed');
    expect(verifySignature('whsec_x', body, undefined, now)).toBe('missing');
    // The timestamp is part of what is signed: swapping it invalidates the signature.
    expect(verifySignature('whsec_x', body, sig.replace(/t=\d+/, `t=${Math.floor(now.getTime() / 1000) + 5}`), now)).toBe('mismatch');
  });
});

describe('FHIR adapter (pure)', () => {
  const base = {
    refNumber: 'REF-2026-0001', pathway: 'CANCER_SCREENING' as const, stage: 'HANDOFF_SENT', redFlag: false, issuedAt: new Date('2026-11-01T08:00:00Z'),
    dueDate: new Date('2026-11-10T00:00:00Z'), slaDueAt: new Date('2026-11-03T08:00:00Z'), updatedAt: new Date('2026-11-01T09:00:00Z'), patientCode: 'PT-1001',
    facility: { id: 'fac1', name: 'Kenyatta Desk' }, organisationName: 'Network',
  };

  it('maps a referral to a R4 ServiceRequest with the patient code only by default', () => {
    const sr = toServiceRequest(base);
    expect(sr).toMatchObject({
      resourceType: 'ServiceRequest', id: 'REF-2026-0001', status: 'active', intent: 'order', priority: 'routine', code: { text: 'Cancer Screening' },
      subject: { identifier: { system: 'urn:pathora:patient-code', value: 'PT-1001' } }, authoredOn: '2026-11-01T08:00:00.000Z',
      performer: [{ identifier: { value: 'fac1' }, display: 'Kenyatta Desk' }],
    });
    expect(JSON.stringify(sr)).not.toContain('display":"Wanjiru');
    expect((sr.subject as { display?: string }).display).toBeUndefined();
    expect(toServiceRequest({ ...base, patientName: 'Wanjiru Kamau' }).subject).toMatchObject({ display: 'Wanjiru Kamau' });
    expect(toServiceRequest({ ...base, redFlag: true }).priority).toBe('urgent');
    expect(toServiceRequest({ ...base, stage: 'CLOSED' })).toMatchObject({ status: 'completed', extension: [] });
  });

  it('Task statuses: accepted/received acknowledge, in-progress attends, completed closes (with a reason)', () => {
    const t = (status: string, extra: object = {}) => ({ resourceType: 'Task', status, focus: { reference: 'ServiceRequest/REF-2026-0001' }, ...extra });
    expect(parseTask(t('accepted'))).toEqual({ ref: 'REF-2026-0001', event: 'ACKNOWLEDGED' });
    expect(parseTask(t('received')).event).toBe('ACKNOWLEDGED');
    expect(parseTask(t('in-progress')).event).toBe('ATTENDED');
    expect(parseTask(t('completed', { statusReason: { text: 'Evaluated; benign' } }))).toEqual({ ref: 'REF-2026-0001', event: 'CLOSED', closureReason: 'Evaluated; benign' });
    expect(() => parseTask(t('completed'))).toThrow(/statusReason/);
    expect(() => parseTask(t('rejected'))).toThrow(/not supported/);
    expect(() => parseTask(t('banana'))).toThrow(/Unknown Task status/);
    expect(() => parseTask({ ...t('accepted'), focus: { reference: 'Patient/1' } })).toThrow(TaskMappingError);
    expect(() => parseTask({ ...t('accepted'), focus: { reference: 'ServiceRequest/../etc' } })).toThrow(TaskMappingError);
    expect(() => parseTask({ resourceType: 'Observation' })).toThrow(TaskMappingError);
    expect(() => parseTask('nope')).toThrow(TaskMappingError);
    expect(toTask({ refNumber: 'R', stage: 'ATTENDED', updatedAt: new Date(0) }).status).toBe('in-progress');
    expect(operationOutcome('error', 'invalid', 'x').issue[0]).toEqual({ severity: 'error', code: 'invalid', diagnostics: 'x' });
  });
});

describe('managing keys', () => {
  it('shows the secret and signing secret once; only hashes/ciphertext are stored; the audit trail never contains them', async () => {
    const k = await newKey(ws, ws.facilityA.id, ['referrals:read', 'status:write'], { expiresInDays: 90 });
    expect(k.apiKey).toMatch(/^pk_/);
    expect(k.signingSecret).toMatch(/^whsec_/);
    expect(k.keyPrefix).toBe(k.apiKey.split('.')[0]);
    expect(k.expiresAt).not.toBeNull();

    const list = (await request(app).get(`/api/facilities/${ws.facilityA.id}/api-keys`).set(as(ws.manager)).expect(200)).body.keys;
    const listed = list.find((x: { id: string }) => x.id === k.id);
    expect(listed).toBeDefined();
    expect(JSON.stringify(listed)).not.toContain(k.apiKey.split('.')[1]);
    expect(JSON.stringify(listed)).not.toContain(k.signingSecret);
    expect(listed).not.toHaveProperty('apiKey');

    const row = await prisma.facilityApiKey.findUniqueOrThrow({ where: { id: k.id } });
    const secret = k.apiKey.split('.')[1];
    expect(row.secretHash).toBe(hashSecret(secret));
    expect(Buffer.from(row.signingSecretEnc).includes(Buffer.from(k.signingSecret))).toBe(false);

    const events = await prisma.auditEvent.findMany({ where: { orgId: ws.orgId, action: 'API_KEY_CREATED', resourceId: ws.facilityA.id } });
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(e.detail + e.actorLabel).not.toMatch(/whsec_|\.[A-Za-z0-9_-]{43}/);
  });

  it('is manager-only and invisible across organisations', async () => {
    const url = `/api/facilities/${ws.facilityA.id}/api-keys`;
    for (const a of [ws.coordinator, ws.focalA, ws.clinical, ws.dpo]) {
      expect((await request(app).get(url).set(as(a))).status).toBe(403);
      expect((await request(app).post(url).set(as(a)).send({ name: 'Nope', scopes: ['status:write'] })).status).toBe(403);
    }
    await request(app).get(url).expect(401);
    // Another organisation's manager cannot see or use this facility.
    expect((await request(app).get(url).set(as(other.manager))).status).toBe(404);
    expect((await request(app).post(url).set(as(other.manager)).send({ name: 'Intruder', scopes: ['status:write'] })).status).toBe(404);
  });

  it.each([
    ['no scopes', { scopes: [] }],
    ['unknown scope', { scopes: ['admin:all'] }],
    ['missing name', { name: '' }],
    ['line break in name', { name: 'Bad\nname' }],
    ['non-positive expiry', { expiresInDays: 0 }],
  ])('rejects %s', async (_l, over) => {
    const res = await request(app).post(`/api/facilities/${ws.facilityB.id}/api-keys`).set(as(ws.manager)).send({ name: 'Valid name', scopes: ['status:write'], ...over });
    expect(res.status).toBe(400);
  });

  it('the database refuses unknown or empty scopes', async () => {
    const k = await newKey(ws, ws.facilityB.id);
    await expect(prisma.facilityApiKey.update({ where: { id: k.id }, data: { scopes: ['admin:all'] } })).rejects.toThrow(/facilityapikey_scopes_valid/);
    await expect(prisma.facilityApiKey.update({ where: { id: k.id }, data: { scopes: [] } })).rejects.toThrow(/facilityapikey_scopes_valid/);
  });

  it('caps active keys per facility and revoking frees a slot', async () => {
    const w = await makeWorkspace();
    const made: CreatedApiKeyResponse[] = [];
    for (let i = 0; i < MAX_ACTIVE_KEYS_PER_FACILITY; i++) made.push(await newKey(w, w.facilityA.id, undefined, {}, false));
    const over = await request(app).post(`/api/facilities/${w.facilityA.id}/api-keys`).set(as(w.manager)).send({ name: 'One too many', scopes: ['status:write'] });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('TOO_MANY_KEYS');
    await request(app).delete(`/api/facilities/${w.facilityA.id}/api-keys/${made[0].id}`).set(as(w.manager)).expect(204);
    await newKey(w, w.facilityA.id, undefined, {}, false);
  });

  it('revoking stops the key immediately, is idempotent, and is audited', async () => {
    const k = await newKey(ws, ws.facilityA.id);
    await get(k, '/fhir/ServiceRequest').expect(200);
    await request(app).delete(`/api/facilities/${ws.facilityA.id}/api-keys/${k.id}`).set(as(ws.manager)).expect(204);
    await request(app).delete(`/api/facilities/${ws.facilityA.id}/api-keys/${k.id}`).set(as(ws.manager)).expect(204);
    expect((await get(k, '/fhir/ServiceRequest')).status).toBe(401);
    expect((await signedPost(k, '/referrals/REF-X/acknowledge')).status).toBe(401);
    expect(await prisma.auditEvent.count({ where: { orgId: ws.orgId, action: 'API_KEY_REVOKED', detail: { contains: k.name } } })).toBe(1);
    expect((await request(app).delete(`/api/facilities/${ws.facilityB.id}/api-keys/${k.id}`).set(as(ws.manager))).status).toBe(404); // wrong facility
  });
});

describe('authenticating a facility system', () => {
  it('refuses missing, malformed, unknown, wrong-secret, revoked and expired keys with one identical answer', async () => {
    const good = await newKey(ws, ws.facilityA.id);
    const [id, secret] = good.apiKey.split('.');
    const expired = await newKey(ws, ws.facilityA.id);
    await prisma.facilityApiKey.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const attempts = [
      request(app).get(`${V1}/fhir/ServiceRequest`),
      request(app).get(`${V1}/fhir/ServiceRequest`).set('Authorization', 'Bearer garbage'),
      request(app).get(`${V1}/fhir/ServiceRequest`).set('Authorization', `Basic ${good.apiKey}`),
      request(app).get(`${V1}/fhir/ServiceRequest`).set('Authorization', `Bearer ${id}.${secret.slice(0, -1)}x`),
      request(app).get(`${V1}/fhir/ServiceRequest`).set('Authorization', `Bearer pk_${'a'.repeat(12)}.${secret}`),
      get(expired, '/fhir/ServiceRequest'),
    ];
    const bodies = [] as unknown[];
    for (const a of attempts) {
      const res = await a;
      expect(res.status).toBe(401);
      bodies.push(JSON.parse(res.text).issue[0].diagnostics);
    }
    expect(new Set(bodies).size).toBe(1); // a caller cannot tell which part was wrong
    // And a user's dashboard token is not an API key.
    expect((await request(app).get(`${V1}/fhir/ServiceRequest`).set(as(ws.manager))).status).toBe(401);
  });

  it('enforces scopes: a read-only key cannot post, a write-only key cannot read', async () => {
    const readOnly = await newKey(ws, ws.facilityA.id, ['referrals:read']);
    const writeOnly = await newKey(ws, ws.facilityA.id, ['status:write']);
    const res = await signedPost(readOnly, '/referrals/REF-2026-0001/acknowledge');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_SCOPE');
    expect((await get(writeOnly, '/fhir/ServiceRequest')).status).toBe(403);
    expect((await get(writeOnly, '/referrals.csv')).status).toBe(403);
  });

  it('records last use', async () => {
    const k = await newKey(ws, ws.facilityA.id);
    expect((await prisma.facilityApiKey.findUniqueOrThrow({ where: { id: k.id } })).lastUsedAt).toBeNull();
    await get(k, '/fhir/ServiceRequest').expect(200);
    await new Promise((r) => setTimeout(r, 100));
    expect((await prisma.facilityApiKey.findUniqueOrThrow({ where: { id: k.id } })).lastUsedAt).not.toBeNull();
  });
});

describe('pulling referrals (FHIR and CSV)', () => {
  let keyA: CreatedApiKeyResponse, keyB: CreatedApiKeyResponse, keyAident: CreatedApiKeyResponse;
  let a1: CaseDto, a2: CaseDto, a3: CaseDto, b1: CaseDto;
  beforeAll(async () => {
    keyA = await newKey(ws, ws.facilityA.id, ['referrals:read']);
    keyAident = await newKey(ws, ws.facilityA.id, ['referrals:read', 'referrals:identify']);
    keyB = await newKey(ws, ws.facilityB.id, ['referrals:read']);
    a1 = await createCase(ws, { patientName: 'Zawadi Achieng', patientCode: 'PT-FHIR1' });
    a2 = await createCase(ws, { patientName: 'Baraka Otieno', redFlag: true } as never);
    a3 = await createCase(ws, { patientName: 'Closed Person' });
    await advance(ws, a3.id, 'closed');
    b1 = await createCase(ws, { facilityId: ws.facilityB.id, patientName: 'Other Facility Patient' });
    await prisma.referralCase.create({
      data: {
        refNumber: 'REF-9999-0100', orgId: ws.orgId, isSynthetic: true, pathway: 'CANCER_SCREENING', sourceProgram: 'synthetic', stage: 'HANDOFF_SENT',
        patientId: (await prisma.referralCase.findFirstOrThrow({ where: { orgId: ws.orgId } })).patientId,
        rulePackId: (await prisma.rulePack.findFirstOrThrow({ where: { orgId: ws.orgId } })).id,
        coordinatorId: ws.coordinator.id, facilityId: ws.facilityA.id, issuedAt: new Date(), slaDueAt: new Date(Date.now() + 36e5), dueDate: new Date(),
      },
    });
  });

  const refsOf = (res: request.Response) => (JSON.parse(res.text).entry as Array<{ resource: { id: string } }>).map((e) => e.resource.id);

  it('returns a FHIR searchset of ONLY this facility\'s open referrals, without simulations or patient names', async () => {
    const res = await get(keyA, '/fhir/ServiceRequest').expect(200);
    expect(res.headers['content-type']).toContain('application/fhir+json');
    expect(res.headers['cache-control']).toBe('no-store');
    const bundle = JSON.parse(res.text);
    expect(bundle).toMatchObject({ resourceType: 'Bundle', type: 'searchset' });
    const refs = refsOf(res);
    expect(refs).toContain(a1.id);
    expect(refs).toContain(a2.id);
    expect(refs).not.toContain(a3.id); // closed
    expect(refs).not.toContain(b1.id); // another facility
    expect(refs).not.toContain('REF-9999-0100'); // synthetic
    expect(res.text).not.toMatch(/Zawadi|Baraka|Other Facility Patient/);
    const sr = bundle.entry.find((e: { resource: { id: string } }) => e.resource.id === a2.id).resource;
    expect(sr).toMatchObject({ priority: 'urgent', subject: { identifier: { system: 'urn:pathora:patient-code' } } });
    expect(sr.subject.display).toBeUndefined();

    expect(refsOf(await get(keyB, '/fhir/ServiceRequest').expect(200))).toEqual([b1.id]);
  });

  it('status=completed returns closed referrals', async () => {
    expect(refsOf(await get(keyA, '/fhir/ServiceRequest?status=completed').expect(200))).toEqual([a3.id]);
  });

  it('pages with _count and a next link that continues exactly where it stopped', async () => {
    const first = await get(keyA, '/fhir/ServiceRequest?_count=1').expect(200);
    const b1st = JSON.parse(first.text);
    expect(b1st.entry).toHaveLength(1);
    expect(b1st.link[0].relation).toBe('next');
    const second = await get(keyA, `/fhir/${b1st.link[0].url}`).expect(200);
    const seen = [...refsOf(first), ...refsOf(second)];
    expect(new Set(seen).size).toBe(2);
    expect(JSON.parse(second.text).link).toEqual([]);
  });

  it.each([['status=banana'], ['_count=0'], ['_count=101'], ['_count=abc'], ['_cursor=%%%']])('rejects bad search %s with an OperationOutcome', async (q) => {
    const res = await get(keyA, `/fhir/ServiceRequest?${q}`);
    expect(res.status).toBe(422);
    expect(JSON.parse(res.text)).toMatchObject({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'invalid' }] });
  });

  it('reads one referral; another facility\'s or an unknown one is a plain 404 OperationOutcome', async () => {
    const one = await get(keyA, `/fhir/ServiceRequest/${a1.id}`).expect(200);
    expect(JSON.parse(one.text)).toMatchObject({ resourceType: 'ServiceRequest', id: a1.id });
    for (const ref of [b1.id, 'REF-0000-0000', 'x/../y']) {
      const res = await get(keyA, `/fhir/ServiceRequest/${encodeURIComponent(ref)}`);
      expect(res.status).toBe(404);
      expect(JSON.parse(res.text).resourceType).toBe('OperationOutcome');
    }
    const task = JSON.parse((await get(keyA, `/fhir/Task/${a1.id}`).expect(200)).text);
    expect(task).toMatchObject({ resourceType: 'Task', status: 'requested', focus: { reference: `ServiceRequest/${a1.id}` } });
  });

  it('the identify scope adds patient names, and every such release is recorded in the audit trail', async () => {
    const before = await prisma.auditEvent.count({ where: { orgId: ws.orgId, action: 'REFERRALS_RELEASED_IDENTIFIED' } });
    const res = await get(keyAident, '/fhir/ServiceRequest').expect(200);
    const sr = JSON.parse(res.text).entry.find((e: { resource: { id: string } }) => e.resource.id === a1.id).resource;
    expect(sr.subject.display).toBe('Zawadi Achieng');
    await get(keyAident, `/fhir/ServiceRequest/${a1.id}`).expect(200);
    await get(keyAident, '/referrals.csv').expect(200);
    const events = await prisma.auditEvent.findMany({ where: { orgId: ws.orgId, action: 'REFERRALS_RELEASED_IDENTIFIED' }, orderBy: { id: 'desc' }, take: 3 });
    expect(await prisma.auditEvent.count({ where: { orgId: ws.orgId, action: 'REFERRALS_RELEASED_IDENTIFIED' } })).toBe(before + 3);
    expect(events[0].actorRole).toBe('Facility system (API)');
    expect(events.map((e) => e.detail).join()).not.toMatch(/Zawadi/); // the record says THAT names were released, not which
    // A key without the scope releases no names and leaves no such event.
    const n = await prisma.auditEvent.count({ where: { orgId: ws.orgId, action: 'REFERRALS_RELEASED_IDENTIFIED' } });
    await get(keyA, '/fhir/ServiceRequest').expect(200);
    expect(await prisma.auditEvent.count({ where: { orgId: ws.orgId, action: 'REFERRALS_RELEASED_IDENTIFIED' } })).toBe(n);
  });

  it('CSV pull lists open referrals for the facility, with names only for an identify key', async () => {
    const plain = await get(keyA, '/referrals.csv').expect(200);
    expect(plain.headers['content-type']).toContain('text/csv');
    expect(plain.headers['content-disposition']).toContain('attachment');
    const lines = plain.text.replace(/^﻿/, '').trim().split(/\r?\n/);
    expect(lines[0]).toBe('Referral ID,Patient Code,Pathway,Referred On,Due Date,Priority,Status');
    expect(plain.text).toContain(a1.id);
    expect(plain.text).not.toContain(a3.id);
    expect(plain.text).not.toContain(b1.id);
    expect(plain.text).not.toMatch(/Zawadi/);
    const ident = await get(keyAident, '/referrals.csv').expect(200);
    expect(ident.text.replace(/^﻿/, '').split(/\r?\n/)[0]).toContain('Patient Name');
    expect(ident.text).toContain('Zawadi Achieng');
  });

  it('serves the capability statement without a key and discloses no data', async () => {
    const res = await request(app).get(`${V1}/fhir/metadata`).expect(200);
    expect(JSON.parse(res.text)).toMatchObject({ resourceType: 'CapabilityStatement', fhirVersion: '4.0.1' });
  });
});

describe('returning status', () => {
  const fresh = () => createCase(ws, { patientName: 'Status Return Patient' });
  const stageOf = async (ref: string) => (await prisma.referralCase.findFirstOrThrow({ where: { orgId: ws.orgId, refNumber: ref } })).stage;

  it('acknowledge → attendance → outcome through the JSON API; each repeat is a harmless no-op', async () => {
    const c = await fresh();
    const k = await newKey(ws, ws.facilityA.id);
    const ack = await signedPost(k, `/referrals/${c.id}/acknowledge`).expect(200);
    expect(ack.body).toMatchObject({ ref: c.id, event: 'ACKNOWLEDGED', result: 'applied', stage: 'ACKNOWLEDGED' });
    expect((await signedPost(k, `/referrals/${c.id}/acknowledge`).expect(200)).body.result).toBe('already_recorded');

    expect((await signedPost(k, `/referrals/${c.id}/attendance`).expect(200)).body).toMatchObject({ result: 'applied', stage: 'ATTENDED' });
    expect((await signedPost(k, `/referrals/${c.id}/attendance`).expect(200)).body.result).toBe('already_recorded');

    const out = await signedPost(k, `/referrals/${c.id}/outcome`, { closureReason: 'Evaluation complete; benign finding', outcomeSource: 'Dr. N. Wafula, MD' }).expect(200);
    expect(out.body).toMatchObject({ result: 'applied', stage: 'CLOSED' });
    expect((await signedPost(k, `/referrals/${c.id}/outcome`, { closureReason: 'Evaluation complete; benign finding' }).expect(200)).body.result).toBe('already_recorded');

    // The dashboard sees it as an ordinary verified closure.
    const dto = (await request(app).get(`/api/cases/${c.id}`).set(as(ws.manager)).expect(200)).body as CaseDto;
    expect(dto).toMatchObject({ stage: 'CLOSED', status: 'CLOSED_VERIFIED', outcomeSource: 'Dr. N. Wafula, MD' });
    expect(dto.milestones.facilityAcknowledgedAt && dto.milestones.patientAttendedAt && dto.milestones.outcomeDocumentedAt).toBeTruthy();
  });

  it('is attributed to the facility system in the audit trail and milestones, never to a person', async () => {
    const c = await fresh();
    const k = await newKey(ws, ws.facilityA.id);
    await signedPost(k, `/referrals/${c.id}/acknowledge`).expect(200);
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { orgId: ws.orgId, resourceId: c.id, action: 'FACILITY_ACKNOWLEDGED' } });
    expect(ev).toMatchObject({ actorId: null, actorRole: 'Facility system (API)', actorLabel: `API key "${k.name}"` });
    const ms = await prisma.caseMilestone.findFirstOrThrow({ where: { type: 'FACILITY_ACKNOWLEDGED', case: { orgId: ws.orgId, refNumber: c.id } } });
    expect(ms.recordedBy).toBeNull();
  });

  it('never back-fills history: an outcome before acknowledgement or attendance is refused', async () => {
    const c = await fresh();
    const k = await newKey(ws, ws.facilityA.id);
    const early = await signedPost(k, `/referrals/${c.id}/outcome`, { closureReason: 'Done' });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('ILLEGAL_TRANSITION');
    expect((await signedPost(k, `/referrals/${c.id}/attendance`)).status).toBe(409);
    await signedPost(k, `/referrals/${c.id}/acknowledge`).expect(200);
    expect((await signedPost(k, `/referrals/${c.id}/outcome`, { closureReason: 'Done' })).status).toBe(409);
    expect(await stageOf(c.id)).toBe('ACKNOWLEDGED');
  });

  it('a facility cannot touch another facility\'s referral (404), and the other facility\'s case is unchanged', async () => {
    const c = await createCase(ws, { facilityId: ws.facilityB.id });
    const kA = await newKey(ws, ws.facilityA.id);
    const res = await signedPost(kA, `/referrals/${c.id}/acknowledge`);
    expect(res.status).toBe(404);
    expect(await stageOf(c.id)).toBe('HANDOFF_SENT');
    // Nor another organisation's.
    // (Reference numbers are per organisation, so pick one that exists ONLY in the other organisation.)
    let oc = await createCase(other);
    while ((await prisma.referralCase.count({ where: { orgId: ws.orgId, refNumber: oc.id } })) > 0) oc = await createCase(other);
    expect((await signedPost(kA, `/referrals/${oc.id}/acknowledge`)).status).toBe(404);
    expect((await prisma.referralCase.findFirstOrThrow({ where: { orgId: other.orgId, refNumber: oc.id } })).stage).toBe('HANDOFF_SENT');
  });

  it('requires a valid signature on every POST', async () => {
    const c = await fresh();
    const k = await newKey(ws, ws.facilityA.id);
    const path = `${V1}/referrals/${c.id}/acknowledge`;
    const bodyOf = JSON.stringify({});

    const code = async (r: request.Test) => {
      const res = await r;
      return [res.status, res.body.error?.code, res.body.error?.message as string];
    };
    const unsigned = await code(request(app).post(path).set(bearer(k)).set('Content-Type', 'application/json').send(bodyOf));
    expect(unsigned.slice(0, 2)).toEqual([401, 'INVALID_SIGNATURE']);
    expect(unsigned[2]).toContain('missing');
    expect((await code(request(app).post(path).set(bearer(k)).set('X-Pathora-Signature', 'nonsense').send(bodyOf)))[2]).toContain('malformed');
    expect((await code(request(app).post(path).set(bearer(k)).set('X-Pathora-Signature', signBody('whsec_wrong', bodyOf)).send(bodyOf)))[2]).toContain('does not match');
    expect((await code(request(app).post(path).set(bearer(k)).set('X-Pathora-Signature', signBody(k.signingSecret, bodyOf, new Date(Date.now() - 10 * 60_000))).send(bodyOf)))[2]).toContain('too old');
    // Signed for one body, sent with another.
    const tampered = await code(request(app).post(`${V1}/referrals/${c.id}/outcome`).set(bearer(k)).set('Content-Type', 'application/json').set('X-Pathora-Signature', signBody(k.signingSecret, '{"closureReason":"fine"}')).send('{"closureReason":"HACKED"}'));
    expect(tampered.slice(0, 2)).toEqual([401, 'INVALID_SIGNATURE']);
    // A signature made with ANOTHER key's signing secret is no good either.
    const k2 = await newKey(ws, ws.facilityA.id);
    expect((await signedPost(k, `/referrals/${c.id}/acknowledge`, {}, { secret: k2.signingSecret })).status).toBe(401);
    expect(await stageOf(c.id)).toBe('HANDOFF_SENT'); // none of the above changed anything
    await signedPost(k, `/referrals/${c.id}/acknowledge`).expect(200);
  });

  it('two simultaneous returns of the same step apply it once and both succeed', async () => {
    const c = await fresh();
    const k = await newKey(ws, ws.facilityA.id);
    const [r1, r2, r3] = await Promise.all([1, 2, 3].map(() => signedPost(k, `/referrals/${c.id}/acknowledge`)));
    expect([r1.status, r2.status, r3.status]).toEqual([200, 200, 200]);
    expect([r1, r2, r3].filter((r) => r.body.result === 'applied')).toHaveLength(1);
    expect(await prisma.caseMilestone.count({ where: { type: 'FACILITY_ACKNOWLEDGED', case: { orgId: ws.orgId, refNumber: c.id } } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { orgId: ws.orgId, resourceId: c.id, action: 'FACILITY_ACKNOWLEDGED' } })).toBe(1);
  });

  it('validates the outcome body', async () => {
    const c = await fresh();
    const k = await newKey(ws, ws.facilityA.id);
    await signedPost(k, `/referrals/${c.id}/acknowledge`).expect(200);
    await signedPost(k, `/referrals/${c.id}/attendance`).expect(200);
    for (const body of [{}, { closureReason: '' }, { closureReason: 'x'.repeat(501) }, { closureReason: 'ok', outcomeSource: '' }]) {
      expect((await signedPost(k, `/referrals/${c.id}/outcome`, body)).status).toBe(400);
    }
    expect((await signedPost(k, `/referrals/${c.id}/outcome`, '[1,2]')).status).toBe(400);
    expect((await signedPost(k, `/referrals/${c.id}/outcome`, 'not json')).status).toBe(400);
    expect(await stageOf(c.id)).toBe('ATTENDED');
  });

  it('FHIR Task: accepted → in-progress → completed; replays return 200; bad tasks return OperationOutcomes', async () => {
    const c = await fresh();
    const k = await newKey(ws, ws.facilityA.id);
    const task = (status: string, extra: object = {}) => ({ resourceType: 'Task', status, intent: 'order', focus: { reference: `ServiceRequest/${c.id}` }, ...extra });

    const accepted = await signedPost(k, '/fhir/Task', task('accepted'));
    expect(accepted.status).toBe(201);
    expect(JSON.parse(accepted.text)).toMatchObject({ resourceType: 'Task', status: 'accepted' });
    expect((await signedPost(k, '/fhir/Task', task('accepted'))).status).toBe(200); // replay
    expect((await signedPost(k, '/fhir/Task', task('in-progress'))).status).toBe(201);

    const noReason = await signedPost(k, '/fhir/Task', task('completed'));
    expect(noReason.status).toBe(422);
    expect(JSON.parse(noReason.text)).toMatchObject({ resourceType: 'OperationOutcome', issue: [{ code: 'invalid' }] });
    const done = await signedPost(k, '/fhir/Task', task('completed', { statusReason: { text: 'Biopsy negative' } }));
    expect(done.status).toBe(201);
    expect(JSON.parse(done.text).status).toBe('completed');
    expect(await stageOf(c.id)).toBe('CLOSED');

    const rej = await signedPost(k, '/fhir/Task', task('rejected'));
    expect(rej.status).toBe(422);
    expect(rej.headers['content-type']).toContain('application/fhir+json');
    expect((await signedPost(k, '/fhir/Task', { resourceType: 'Task', status: 'accepted', focus: { reference: 'ServiceRequest/REF-0000-0000' } })).status).toBe(404);
    expect((await signedPost(k, '/fhir/Task', 'garbage')).status).toBe(400);
    const unsigned = await request(app).post(`${V1}/fhir/Task`).set(bearer(k)).send(JSON.stringify(task('accepted')));
    expect(unsigned.status).toBe(401);
    expect(JSON.parse(unsigned.text).resourceType).toBe('OperationOutcome');
  });
});

describe('CSV status upload', () => {
  const csv = (rows: string[]) => ['Referral ID,Status,Closure Reason,Outcome Source', ...rows].join('\r\n') + '\r\n';
  const upload = (k: CreatedApiKeyResponse, body: string, opts: { sign?: boolean } = {}) => {
    const r = request(app).post(`${V1}/status-returns.csv`).set(bearer(k)).set('Content-Type', 'text/csv');
    if (opts.sign !== false) r.set('X-Pathora-Signature', signBody(k.signingSecret, body));
    return r.send(body);
  };

  it('applies each row independently and reports per-row results', async () => {
    const k = await newKey(ws, ws.facilityA.id);
    const c1 = await createCase(ws), c2 = await createCase(ws), c3 = await createCase(ws);
    const otherFacility = await createCase(ws, { facilityId: ws.facilityB.id });
    await advance(ws, c3.id, 'ack');
    const res = await upload(k, csv([
      `${c1.id},ACKNOWLEDGED,,`,
      `${c2.id},acknowledged,,`,                          // case-insensitive
      `${c3.id},ACKNOWLEDGED,,`,                          // already acknowledged
      `${c2.id},CLOSED,Too early,`,                       // out of order
      `${otherFacility.id},ACKNOWLEDGED,,`,               // not this facility's
      `REF-0000-0000,ACKNOWLEDGED,,`,                     // unknown
      `${c1.id},TELEPORTED,,`,                            // bad status
      `x/../y,ACKNOWLEDGED,,`,                            // bad id
    ])).expect(200);
    expect(res.body.summary).toEqual({ rows: 8, applied: 2, alreadyRecorded: 1, failed: 5 });
    expect(res.body.results.map((r: { result: string }) => r.result)).toEqual(['applied', 'applied', 'already_recorded', 'error', 'error', 'error', 'error', 'error']);
    expect(res.body.results[0].row).toBe(2);
    expect(res.body.results[3].message).toMatch(/acknowledge|attend/i);
    expect(res.body.results[4].message).toBe('Referral not found');
    expect((await prisma.referralCase.findFirstOrThrow({ where: { orgId: ws.orgId, refNumber: otherFacility.id } })).stage).toBe('HANDOFF_SENT');
  });

  it('can carry a full journey: quoted closure reasons with commas, one row per step', async () => {
    const k = await newKey(ws, ws.facilityA.id);
    const c = await createCase(ws);
    const res = await upload(k, csv([`${c.id},ACKNOWLEDGED,,`, `${c.id},ATTENDED,,`, `${c.id},CLOSED,"Evaluated, no malignancy",Dr. A`])).expect(200);
    expect(res.body.summary).toMatchObject({ applied: 3, failed: 0 });
    expect((await request(app).get(`/api/cases/${c.id}`).set(as(ws.manager))).body).toMatchObject({ stage: 'CLOSED', closureReason: 'Evaluated, no malignancy', outcomeSource: 'Dr. A' });
  });

  it('refuses a bad file as a whole', async () => {
    const k = await newKey(ws, ws.facilityA.id);
    expect((await upload(k, 'Referral ID,Outcome\r\nREF-1,x\r\n')).status).toBe(422);          // missing Status column
    expect((await upload(k, 'Referral ID,Status\r\n')).status).toBe(422);                        // no rows
    expect((await upload(k, 'Referral ID,Status\r\n"unterminated,ACKNOWLEDGED\r\n')).status).toBe(422);
    expect((await upload(k, csv(Array.from({ length: 501 }, (_, i) => `REF-0-${i},ACKNOWLEDGED,,`)))).status).toBe(422); // over the row cap
    const unsigned = await upload(k, csv(['REF-1,ACKNOWLEDGED,,']), { sign: false });
    expect(unsigned.status).toBe(401);
    expect(unsigned.body.error.code).toBe('INVALID_SIGNATURE');
  });
});

describe('abuse limits', () => {
  it('throttles repeated FAILED authentication per IP, but not successful traffic', async () => {
    const limited = createApp({ integrations: { maxFailedPerIp: 3, maxPerKey: 1000 } });
    const k = await newKey(ws, ws.facilityA.id);
    for (let i = 0; i < 6; i++) await request(limited).get(`${V1}/fhir/ServiceRequest`).set(bearer(k)).expect(200); // successes never count
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await request(limited).get(`${V1}/fhir/ServiceRequest`).set('Authorization', 'Bearer pk_aaaaaaaaaaaa.' + 'a'.repeat(43))).status);
    expect(statuses).toEqual([401, 401, 401, 429, 429]);
  });

  it('caps each key\'s request rate separately', async () => {
    const limited = createApp({ integrations: { maxFailedPerIp: 1000, maxPerKey: 3 } });
    const k1 = await newKey(ws, ws.facilityA.id);
    const k2 = await newKey(ws, ws.facilityB.id);
    const run = async (k: CreatedApiKeyResponse) => {
      const out: number[] = [];
      for (let i = 0; i < 5; i++) out.push((await request(limited).get(`${V1}/fhir/ServiceRequest`).set(bearer(k))).status);
      return out;
    };
    expect(await run(k1)).toEqual([200, 200, 200, 429, 429]);
    expect(await run(k2)).toEqual([200, 200, 200, 429, 429]); // a different key has its own budget
  });
});

