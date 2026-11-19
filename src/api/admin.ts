import type {
  FacilityDto,
  FacilityInput,
  InviteCreatedResponse,
  InviteRequest,
  OrganizationDto,
  TeamMemberDto,
  TeamResponse,
  UpdateMemberRequest,
  UpdateOrganizationRequest,
} from '../../shared/types';
import { api } from '../lib/api';

const enc = encodeURIComponent;

// ── team ──
export const getTeam = () => api<TeamResponse>('/users');

/** `idempotencyKey` makes a double-click send one invitation. */
export const inviteMember = (body: InviteRequest, idempotencyKey: string) =>
  api<InviteCreatedResponse>('/users/invite', { method: 'POST', json: body, headers: { 'Idempotency-Key': idempotencyKey } });

export const revokeInvite = (id: string) => api<void>(`/users/invites/${enc(id)}/revoke`, { method: 'POST' });
export const updateMember = (id: string, body: UpdateMemberRequest) => api<TeamMemberDto>(`/users/${enc(id)}`, { method: 'PATCH', json: body });

// ── organisation ──
export const getOrganization = () => api<OrganizationDto>('/organization');
export const updateOrganization = (body: UpdateOrganizationRequest) => api<OrganizationDto>('/organization', { method: 'PATCH', json: body });

// ── facilities ──
export const createFacility = (body: FacilityInput) => api<FacilityDto>('/facilities', { method: 'POST', json: body });
export const updateFacility = (id: string, body: Partial<FacilityInput>) => api<FacilityDto>(`/facilities/${enc(id)}`, { method: 'PATCH', json: body });
