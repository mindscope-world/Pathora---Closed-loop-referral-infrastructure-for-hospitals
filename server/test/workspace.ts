import request from 'supertest';
import type { CaseDto, CreateCaseRequest, UserRole } from '../../shared/types';
import { signAccessToken } from '../modules/auth/tokens';
import { makeApp, prisma, signupBody, uniqueEmail } from './helpers';

export const app = makeApp();

export interface Actor {
  id: string;
  name: string;
  token: string;
}

export interface Workspace {
  orgId: string;
  facilityA: { id: string; name: string };
  facilityB: { id: string; name: string };
  manager: Actor;
  coordinator: Actor;
  coordinator2: Actor;
  focalA: Actor; // receiving-facility focal at facility A
  focalB: Actor;
  clinical: Actor;
  dpo: Actor;
}

let n = 0;

/** A fresh organisation: manager (via real signup, so default rule packs exist) + one user per role. */
export async function makeWorkspace(): Promise<Workspace> {
  const signup = await request(app).post('/api/auth/signup').send(signupBody({ fullName: 'Mona Manager' })).expect(201);
  const orgId: string = signup.body.user.organization.id;
  const manager: Actor = { id: signup.body.user.id, name: 'Mona Manager', token: signup.body.accessToken };

  const mkFacility = (name: string) =>
    prisma.facility.create({ data: { orgId, name, type: 'PUBLIC_REFERRAL', city: 'Nairobi', interopMethod: 'PORTAL_CSV' }, select: { id: true, name: true } });
  const facilityA = await mkFacility(`Alpha Referral Desk ${++n}`);
  const facilityB = await mkFacility(`Bravo Diagnostic Centre ${n}`);

  const mkUser = async (name: string, role: UserRole, facilityId?: string): Promise<Actor> => {
    const u = await prisma.user.create({
      data: { orgId, email: uniqueEmail(role.toLowerCase()), passwordHash: 'x', name, role, accessScope: 's', facilityId },
    });
    return { id: u.id, name, token: signAccessToken(u.id, orgId) };
  };

  return {
    orgId, facilityA, facilityB, manager,
    coordinator: await mkUser('Cora Coordinator', 'PROGRAMME_COORDINATOR'),
    coordinator2: await mkUser('Cal Coordinator', 'PROGRAMME_COORDINATOR'),
    focalA: await mkUser('Fiona Focal', 'FACILITY_FOCAL', facilityA.id),
    focalB: await mkUser('Felix Focal', 'FACILITY_FOCAL', facilityB.id),
    clinical: await mkUser('Clara Clinical', 'CLINICAL_LEAD'),
    dpo: await mkUser('Dan DPO', 'DPO'),
  };
}

export const as = (actor: Actor) => ({ Authorization: `Bearer ${actor.token}` });

export function caseBody(ws: Workspace, over: Partial<CreateCaseRequest> = {}): CreateCaseRequest {
  return {
    patientName: 'Wanjiru Kamau',
    pathway: 'CANCER_SCREENING',
    sourceProgram: 'Mobile screening',
    coordinatorId: ws.coordinator.id,
    facilityId: ws.facilityA.id,
    consentSms: true,
    ...over,
  };
}

/** Creates a case as the coordinator and returns its DTO. */
export async function createCase(ws: Workspace, over: Partial<CreateCaseRequest> = {}): Promise<CaseDto> {
  const res = await request(app).post('/api/cases').set(as(ws.coordinator)).send(caseBody(ws, over));
  if (res.status !== 201) throw new Error(`createCase failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export const act = (actor: Actor, ref: string, action: string, body: object = {}) =>
  request(app).post(`/api/cases/${ref}/${action}`).set(as(actor)).send(body);

/** Drives a case to a given point through the real endpoints. */
export async function advance(ws: Workspace, ref: string, to: 'ack' | 'attended' | 'closed'): Promise<CaseDto> {
  let last = (await request(app).get(`/api/cases/${ref}`).set(as(ws.manager))).body as CaseDto;
  const focal = last.facility.id === ws.facilityA.id ? ws.focalA : ws.focalB;
  if (to === 'ack' || to === 'attended' || to === 'closed') last = (await act(focal, ref, 'acknowledge').expect(200)).body;
  if (to === 'attended' || to === 'closed') last = (await act(focal, ref, 'attendance').expect(200)).body;
  if (to === 'closed') last = (await act(focal, ref, 'close', { closureReason: 'Clinical evaluation completed' }).expect(200)).body;
  return last;
}
