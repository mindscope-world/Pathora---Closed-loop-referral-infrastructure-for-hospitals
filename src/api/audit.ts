import type { AuditListResponse, AuditVerifyResponse, CreateExportRequest, ExportJobDto } from '../../shared/types';
import { api } from '../lib/api';

export interface AuditFilters {
  q?: string;
  cursor?: string;
  limit?: number;
}

export function listAudit({ q, cursor, limit = 50 }: AuditFilters = {}): Promise<AuditListResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (q?.trim()) params.set('q', q.trim());
  if (cursor) params.set('cursor', cursor);
  return api<AuditListResponse>(`/audit?${params}`);
}

export const verifyAuditChain = () => api<AuditVerifyResponse>('/audit/verify');

/** `idempotencyKey` makes a double-click queue one export, not two. */
export const requestExport = (body: CreateExportRequest, idempotencyKey: string) =>
  api<ExportJobDto>('/exports', { method: 'POST', json: body, headers: { 'Idempotency-Key': idempotencyKey } });

export const getExport = (id: string) => api<ExportJobDto>(`/exports/${encodeURIComponent(id)}`);
export const listExports = async () => (await api<{ exports: ExportJobDto[] }>('/exports')).exports;
