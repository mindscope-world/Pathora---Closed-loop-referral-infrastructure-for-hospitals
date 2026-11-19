import type {
  CaseDto,
  CommsLogResponse,
  SendMessageRequest,
  SendMessageResponse,
  TemplateDto,
  TemplateInput,
  UpdateConsentRequest,
} from '../../shared/types';
import { api } from '../lib/api';

const enc = encodeURIComponent;

export const listTemplates = async () => (await api<{ templates: TemplateDto[] }>('/templates')).templates;
export const createTemplate = (body: TemplateInput) => api<TemplateDto>('/templates', { method: 'POST', json: body });
export const updateTemplate = (id: string, body: Partial<TemplateInput>) => api<TemplateDto>(`/templates/${enc(id)}`, { method: 'PATCH', json: body });
export const approveTemplate = (id: string) => api<TemplateDto>(`/templates/${enc(id)}/approve`, { method: 'POST' });
export const retireTemplate = (id: string) => api<TemplateDto>(`/templates/${enc(id)}/retire`, { method: 'POST' });

export const listCommsLog = (limit = 50) => api<CommsLogResponse>(`/comms-log?limit=${limit}`);

/** `idempotencyKey` makes a double-click queue one message. */
export const sendMessage = (ref: string, body: SendMessageRequest, idempotencyKey: string) =>
  api<SendMessageResponse>(`/cases/${enc(ref)}/messages`, { method: 'POST', json: body, headers: { 'Idempotency-Key': idempotencyKey } });

export const setContact = (ref: string, phone: string | null) => api<{ hasPhone: boolean }>(`/cases/${enc(ref)}/contact`, { method: 'PUT', json: { phone } });
export const setChannelConsent = (ref: string, body: UpdateConsentRequest) => api<CaseDto>(`/cases/${enc(ref)}/consent`, { method: 'PUT', json: body });
