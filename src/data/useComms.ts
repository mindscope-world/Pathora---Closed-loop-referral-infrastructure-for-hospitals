import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommsLogDto, TemplateDto } from '../../shared/types';
import * as api from '../api/comms';
import { describeApiError } from './useWorkspace';

/** Delivery moves on by itself (queued → sent → delivered → read), so the log is refreshed while the screen is open. */
const LOG_REFRESH_MS = 10_000;

export function useComms() {
  const [templates, setTemplates] = useState<TemplateDto[]>([]);
  const [log, setLog] = useState<CommsLogDto[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const loadTemplates = useCallback(async () => {
    try {
      const t = await api.listTemplates();
      if (alive.current) setTemplates(t);
    } catch (err) {
      if (alive.current) setError(describeApiError(err));
    }
  }, []);

  const loadLog = useCallback(async () => {
    try {
      const res = await api.listCommsLog();
      if (!alive.current) return;
      setLog(res.entries);
      setStatus('ready');
      setError(null);
    } catch (err) {
      if (!alive.current) return;
      setError(describeApiError(err));
      setStatus((s) => (s === 'ready' ? s : 'error'));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void loadTemplates();
    void loadLog();
    const timer = window.setInterval(() => void loadLog(), LOG_REFRESH_MS);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
    };
  }, [loadTemplates, loadLog]);

  return { templates, log, status, error, reloadTemplates: loadTemplates, reloadLog: loadLog };
}
