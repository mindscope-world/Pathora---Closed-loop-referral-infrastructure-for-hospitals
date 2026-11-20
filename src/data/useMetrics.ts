import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OverviewMetricsDto, UpcomingMetricsDto } from '../../shared/types';
import * as metricsApi from '../api/metrics';
import { describeApiError } from './useWorkspace';
import { toViewCase } from './caseViewModel';

/**
 * The Overview's numbers, computed by the server (so they cover every referral, are the same for every viewer of
 * the same scope, and match the exported reports). Reloads whenever `refreshKey` changes: the workspace changes it
 * after every action and on its own 60-second refresh, so the figures never lag the lists.
 */
export function useMetrics(enabled: boolean, refreshKey: unknown) {
  const [overview, setOverview] = useState<OverviewMetricsDto | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingMetricsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const [o, u] = await Promise.all([metricsApi.getOverviewMetrics(), metricsApi.getUpcomingMetrics()]);
      if (mine !== seq.current) return; // a newer request is in flight; never let an older answer overwrite it
      setOverview(o);
      setUpcoming(u);
      setError(null);
    } catch (err) {
      if (mine !== seq.current) return;
      setError(describeApiError(err)); // keep showing the last good numbers
    }
  }, []);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, refreshKey, load]);

  const upcomingCases = useMemo(() => (upcoming ? upcoming.cases.map(toViewCase) : []), [upcoming]);
  return { overview, upcoming, upcomingCases, error, reload: load };
}
