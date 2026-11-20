import { useCallback, useEffect, useRef, useState } from 'react';
import type { NotificationDto } from '../../shared/types';
import * as api from '../api/rulepacks';

const REFRESH_MS = 60_000;

/** The signed-in user's own alerts (overdue and escalated referrals), refreshed in the background. */
export function useNotifications() {
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [unread, setUnread] = useState(0);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await api.listNotifications();
      if (!alive.current) return;
      setItems(res.notifications);
      setUnread(res.unread);
    } catch {
      /* alerts are secondary: keep showing the last good list */
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const markRead = useCallback(async (id: string) => {
    // Optimistic: the badge drops immediately; the next refresh reconciles with the server.
    setItems((prev) => prev.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n)));
    setUnread((u) => Math.max(0, u - 1));
    try {
      await api.markNotificationRead(id);
    } catch {
      void load();
    }
  }, [load]);

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })));
    setUnread(0);
    try {
      await api.markAllNotificationsRead();
    } catch {
      void load();
    }
  }, [load]);

  return { items, unread, markRead, markAllRead, reload: load };
}
