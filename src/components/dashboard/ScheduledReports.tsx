import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarClock, Pause, Play, Trash2 } from 'lucide-react';
import { EXPORT_LABELS, type ReportFrequency, type ReportScheduleDto, type ReportType } from '../../../shared/types';
import * as reportsApi from '../../api/reports';
import { formatDateTime } from '../../data/caseViewModel';
import { describeApiError } from '../../data/useWorkspace';

const WHEN: Record<ReportFrequency, string> = { WEEKLY: 'Every Monday, 06:00', MONTHLY: '1st of each month, 06:00' };

/** Recurring reports: each run appears in the export list below with the usual signed download. */
export function ScheduledReports() {
  const [schedules, setSchedules] = useState<ReportScheduleDto[]>([]);
  const [type, setType] = useState<ReportType>('GOVERNANCE_CSV');
  const [frequency, setFrequency] = useState<ReportFrequency>('MONTHLY');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const reload = useCallback(async () => {
    try {
      const list = await reportsApi.listSchedules();
      if (mounted.current) setSchedules(list);
    } catch (err) {
      if (mounted.current) setError(describeApiError(err));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
    };
  }, [reload]);

  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const select = 'text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-[#061B3A]';
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
      <div>
        <h3 className="font-display text-sm font-bold text-[#061B3A] flex items-center gap-1.5">
          <CalendarClock className="w-4 h-4 text-[#008E97]" /> Scheduled reports
        </h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Generated automatically for the week or month that just ended, in your name. They appear in the list below.
        </p>
      </div>

      {schedules.length === 0 ? (
        <p className="text-xs text-slate-500">No scheduled reports yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {schedules.map((s) => (
            <li key={s.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className={s.enabled ? '' : 'opacity-60'}>
                <p className="font-medium text-[#061B3A]">{EXPORT_LABELS[s.type]}</p>
                <p className="text-slate-500">
                  {WHEN[s.frequency]} · {s.enabled ? `next ${formatDateTime(s.nextRunAt)}` : 'paused'} · set up by {s.createdBy}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => reportsApi.setScheduleEnabled(s.id, !s.enabled))}
                  aria-label={s.enabled ? `Pause ${EXPORT_LABELS[s.type]}` : `Resume ${EXPORT_LABELS[s.type]}`}
                  className="p-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 text-[#061B3A] disabled:opacity-60 cursor-pointer"
                >
                  {s.enabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => reportsApi.deleteSchedule(s.id))}
                  aria-label={`Delete ${EXPORT_LABELS[s.type]} schedule`}
                  className="p-1.5 border border-slate-200 rounded-lg hover:bg-red-50 text-red-700 disabled:opacity-60 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <select aria-label="Report" className={select} value={type} onChange={(e) => setType(e.target.value as ReportType)}>
          <option value="GOVERNANCE_CSV">{EXPORT_LABELS.GOVERNANCE_CSV}</option>
          <option value="CASES_CSV">{EXPORT_LABELS.CASES_CSV}</option>
        </select>
        <select aria-label="How often" className={select} value={frequency} onChange={(e) => setFrequency(e.target.value as ReportFrequency)}>
          <option value="WEEKLY">Weekly</option>
          <option value="MONTHLY">Monthly</option>
        </select>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => reportsApi.createSchedule({ type, frequency }))}
          className="px-3 py-1.5 text-xs font-semibold text-white bg-[#008E97] hover:bg-[#00767E] disabled:opacity-60 rounded-lg cursor-pointer"
        >
          Add schedule
        </button>
      </div>

      {error && (
        <div role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}
