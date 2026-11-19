import type {
  AssigneeDto,
  BarrierResolutionRequest,
  CaseDto,
  CaseListResponse,
  CloseCaseRequest,
  CreateCaseRequest,
  EscalateCaseRequest,
  FacilityDto,
  ImportCasesRequest,
  ImportCasesResponse,
} from '../../shared/types';
import { api } from '../lib/api';

const enc = encodeURIComponent;
const post = <T>(path: string, json: unknown, headers?: Record<string, string>) => api<T>(path, { method: 'POST', json, headers });

/** Every page of cases (the pilot's volume fits comfortably; capped so a bug cannot loop forever). */
export async function listAllCases(): Promise<CaseDto[]> {
  const all: CaseDto[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const res: CaseListResponse = await api<CaseListResponse>(`/cases?limit=200${cursor ? `&cursor=${enc(cursor)}` : ''}`);
    all.push(...res.cases);
    cursor = res.nextCursor;
    if (!cursor) break;
  }
  return all;
}

export const listFacilities = async () => (await api<{ facilities: FacilityDto[] }>('/facilities')).facilities;
export const listAssignees = async () => (await api<{ assignees: AssigneeDto[] }>('/cases/assignees')).assignees;

/** `idempotencyKey` makes a retried submit (double-click, dropped response) return the original case. */
export const createCase = (body: CreateCaseRequest, idempotencyKey: string) =>
  post<CaseDto>('/cases', body, { 'Idempotency-Key': idempotencyKey });

export const importCases = (body: ImportCasesRequest, idempotencyKey?: string) =>
  post<ImportCasesResponse>('/cases/import', body, idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined);

const act = <T extends object>(id: string, action: string, body: T, expectedVersion?: number) =>
  post<CaseDto>(`/cases/${enc(id)}/${action}`, { ...body, ...(expectedVersion ? { expectedVersion } : {}) });

export const acknowledgeCase = (id: string, v?: number) => act(id, 'acknowledge', {}, v);
export const confirmAttendance = (id: string, v?: number) => act(id, 'attendance', {}, v);
export const closeCase = (id: string, body: Omit<CloseCaseRequest, 'expectedVersion'>, v?: number) => act(id, 'close', body, v);
export const escalateCase = (id: string, body: Omit<EscalateCaseRequest, 'expectedVersion'>, v?: number) => act(id, 'escalate', body, v);
export const resolveBarrier = (id: string, body: Omit<BarrierResolutionRequest, 'expectedVersion'>, v?: number) => act(id, 'barrier-resolution', body, v);
export const reassignCase = (id: string, coordinatorId: string, v?: number) => act(id, 'reassign', { coordinatorId }, v);
export const setOptOut = (id: string, optedOut: boolean) =>
  api<CaseDto>(`/cases/${enc(id)}/opt-out`, { method: 'PUT', json: { optedOut } });
