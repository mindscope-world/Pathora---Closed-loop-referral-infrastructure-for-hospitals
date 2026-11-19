import type { NotificationDto, NotificationsResponse } from '../../../shared/types';
import type { Notification } from '../../db/generated/client';
import { forOrg } from '../../db/tenant';
import { HttpError } from '../../lib/errors';
import type { AuthContext } from '../../types';

const LIST_LIMIT = 30;

const toDto = (n: Notification): NotificationDto => ({
  id: n.id, kind: n.kind, title: n.title, body: n.body, caseRef: n.caseRef, createdAt: n.createdAt.toISOString(), readAt: n.readAt?.toISOString() ?? null,
});

/** Your own notifications only: they are addressed to individuals, never shared across the organisation. */
export async function listNotifications(auth: AuthContext): Promise<NotificationsResponse> {
  const db = forOrg(auth.orgId);
  const [rows, unread] = await Promise.all([
    db.notification.findMany({ where: { userId: auth.userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: LIST_LIMIT }),
    db.notification.count({ where: { userId: auth.userId, readAt: null } }),
  ]);
  return { notifications: rows.map(toDto), unread };
}

export async function markRead(auth: AuthContext, id: string): Promise<void> {
  const { count } = await forOrg(auth.orgId).notification.updateMany({ where: { id, userId: auth.userId, readAt: null }, data: { readAt: new Date() } });
  if (count === 0) {
    // Distinguish "already read" (fine) from "not yours / does not exist" (404). Both look the same to other people's ids.
    const mine = await forOrg(auth.orgId).notification.findFirst({ where: { id, userId: auth.userId }, select: { id: true } });
    if (!mine) throw HttpError.notFound('Notification not found');
  }
}

export async function markAllRead(auth: AuthContext): Promise<number> {
  const { count } = await forOrg(auth.orgId).notification.updateMany({ where: { userId: auth.userId, readAt: null }, data: { readAt: new Date() } });
  return count;
}
