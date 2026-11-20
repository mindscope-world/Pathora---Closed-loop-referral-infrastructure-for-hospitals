import type { AuditEvent } from '../../db/generated/client';
import type { AuditEventDto } from '../../../shared/types';

export const toAuditEventDto = (e: AuditEvent): AuditEventDto => ({
  id: String(e.id),
  at: e.at.toISOString(),
  actor: e.actorLabel,
  role: e.actorRole,
  action: e.action,
  resourceType: e.resourceType,
  resourceId: e.resourceId,
  detail: e.detail,
  hash: e.hash,
});
