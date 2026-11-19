import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { can } from '../../shared/permissions';
import type { AssigneeDto, CaseDto, FacilityDto, UserRole } from '../../shared/types';
import * as workspaceApi from '../api/workspace';
import { ApiError } from '../lib/api';
import { toViewCase, toViewFacility } from './caseViewModel';

/** Deadlines pass with the clock, so the derived status/SLA must be refreshed even when nobody clicks. */
const REFRESH_MS = 60_000;

export function describeApiError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'VALIDATION_ERROR') {
      const fields = Object.values(err.fieldErrors);
      if (fields.length > 0) return fields.join(' ');
    }
    if (err.status === 403) return 'You do not have permission to do that.';
    if (err.status === 401) return 'Your session has expired. Please sign in again.';
    if (err.status >= 500) return 'Something went wrong on our side. Please try again.';
    return err.message;
  }
  return 'Could not reach the server. Check your connection and try again.';
}

/** Server-backed referral workspace: cases, facilities and assignable owners. */
export function useWorkspace(role: UserRole | undefined) {
  const [rawCases, setRawCases] = useState<CaseDto[]>([]);
  const [rawFacilities, setRawFacilities] = useState<FacilityDto[]>([]);
  const [assignees, setAssignees] = useState<AssigneeDto[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const load = useCallback(
    async (silent = false) => {
      if (!role) return;
      if (!silent) setStatus('loading');
      try {
        const [cases, facilities, owners] = await Promise.all([
          can(role, 'cases.read') ? workspaceApi.listAllCases() : Promise.resolve([]),
          can(role, 'facilities.read') ? workspaceApi.listFacilities() : Promise.resolve([]),
          can(role, 'cases.create') || can(role, 'cases.reassign') ? workspaceApi.listAssignees() : Promise.resolve([]),
        ]);
        if (!alive.current) return;
        setRawCases(cases);
        setRawFacilities(facilities);
        setAssignees(owners);
        setError(null);
        setStatus('ready');
      } catch (err) {
        if (!alive.current) return;
        // A failed background refresh keeps showing the last good data.
        if (!silent) setStatus('error');
        setError(describeApiError(err));
      }
    },
    [role],
  );

  useEffect(() => {
    alive.current = true;
    void load();
    const timer = window.setInterval(() => void load(true), REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && void load(true);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  /** Replaces (or adds) one case with the server's latest version of it. */
  const upsertCase = useCallback((dto: CaseDto) => {
    setRawCases((prev) => (prev.some((c) => c.id === dto.id) ? prev.map((c) => (c.id === dto.id ? dto : c)) : [dto, ...prev]));
  }, []);

  const cases = useMemo(() => rawCases.map(toViewCase), [rawCases]);
  const facilities = useMemo(() => rawFacilities.map(toViewFacility), [rawFacilities]);

  return { cases, facilities, assignees, status, error, reload: load, upsertCase };
}
