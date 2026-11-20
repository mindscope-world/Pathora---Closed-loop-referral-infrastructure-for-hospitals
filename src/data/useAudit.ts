import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuditEventDto } from '../../shared/types';
import * as auditApi from '../api/audit';
import { describeApiError } from './useWorkspace';

const DEBOUNCE_MS = 300;

/**
 * The server-side audit trail, newest first, with free-text search and "load more".
 * Searching is debounced, and a response that arrives after a newer request was made is discarded
 * so a slow earlier search can never overwrite the results of a later one.
 */
export function useAuditLog(search: string) {
  const [events, setEvents] = useState<AuditEventDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const load = useCallback(async (query: string, cursor?: string) => {
    const seq = ++latest.current;
    try {
      const page = await auditApi.listAudit({ q: query, cursor });
      if (seq !== latest.current) return; // superseded
      setEvents((prev) => (cursor ? [...prev, ...page.events] : page.events));
      setNextCursor(page.nextCursor);
      setError(null);
      setStatus('ready');
    } catch (err) {
      if (seq !== latest.current) return;
      setError(describeApiError(err));
      setStatus('error');
    } finally {
      if (seq === latest.current) setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    const timer = window.setTimeout(() => void load(search), search ? DEBOUNCE_MS : 0);
    return () => window.clearTimeout(timer);
  }, [search, load]);

  return {
    events,
    status,
    error,
    hasMore: nextCursor !== null,
    loadingMore,
    loadMore: () => {
      if (!nextCursor || loadingMore) return;
      setLoadingMore(true);
      void load(search, nextCursor);
    },
    reload: () => load(search),
  };
}
