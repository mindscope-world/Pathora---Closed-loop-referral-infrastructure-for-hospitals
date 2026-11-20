import { api } from '../lib/api';

export interface LeadRequest {
  name: string;
  organization: string;
  email: string;
  pathway: string;
  /** Honeypot: always empty for real visitors. */
  website: string;
}

export const submitLead = (body: LeadRequest) => api<{ ok: true }>('/leads', { method: 'POST', json: body });
