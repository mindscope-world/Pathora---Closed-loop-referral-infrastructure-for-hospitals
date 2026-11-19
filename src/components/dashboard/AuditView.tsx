import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { EXPORT_LABELS, type AuditVerifyResponse, type ExportJobDto, type ExportType } from '../../../shared/types';
import * as auditApi from '../../api/audit';
import { formatDateTime } from '../../data/caseViewModel';
import { useAuditLog } from '../../data/useAudit';
import { describeApiError } from '../../data/useWorkspace';
import { waitUntilReady } from '../../lib/exportPolling';
import { ScheduledReports } from './ScheduledReports';

/** Starts a browser download of a signed export link (the server sends it as an attachment). */
function triggerDownload(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const formatBytes = (n: number | null) => (n === null ? '—' : n < 1024 ? `${n} B` : n < 1_048_576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1_048_576).toFixed(1)} MB`);

const STATUS_STYLE: Record<ExportJobDto['status'], string> = {
  READY: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  PENDING: 'text-amber-800 bg-amber-50 border-amber-200',
  RUNNING: 'text-amber-800 bg-amber-50 border-amber-200',
  FAILED: 'text-red-700 bg-red-50 border-red-200',
  EXPIRED: 'text-slate-600 bg-slate-50 border-slate-200',
};

interface AuditViewProps {
  /** Whether the signed-in role may generate exports (the server enforces it regardless). */
  canExport: boolean;
}

export function AuditView({ canExport }: AuditViewProps) {
  const [search, setSearch] = useState('');
  const log = useAuditLog(search);

  // ── exports ──
  const [exports, setExports] = useState<ExportJobDto[]>([]);
  const [exporting, setExporting] = useState<ExportType | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // One idempotency key per export attempt: a double-click queues a single export.
  const keys = useRef<Record<ExportType, string>>({ CASES_CSV: crypto.randomUUID(), AUDIT_CSV: crypto.randomUUID(), GOVERNANCE_CSV: crypto.randomUUID() });
  const mounted = useRef(true);

  const refreshExports = useCallback(async () => {
    try {
      const list = await auditApi.listExports();
      if (mounted.current) setExports(list);
    } catch {
      /* the list is secondary; the main flows report their own errors */
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (canExport) void refreshExports();
    return () => {
      mounted.current = false;
    };
  }, [canExport, refreshExports]);

  const startExport = async (type: ExportType) => {
    if (exporting) return;
    setExporting(type);
    setExportError(null);
    setNotice(null);
    try {
      const queued = await auditApi.requestExport({ type }, keys.current[type]);
      const ready = await waitUntilReady(queued.id);
      keys.current[type] = crypto.randomUUID();
      if (ready.downloadUrl) triggerDownload(ready.downloadUrl);
      setNotice(`${EXPORT_LABELS[type]} is ready: ${ready.rowCount ?? 0} rows. Your download should start now.`);
    } catch (err) {
      setExportError(err instanceof Error && !('status' in err) ? err.message : describeApiError(err));
    } finally {
      if (mounted.current) {
        setExporting(null);
        void refreshExports();
        void log.reload(); // the export itself is now in the audit trail
      }
    }
  };

  /** Links expire in minutes, so each click fetches the job again to get a fresh one. */
  const downloadAgain = async (job: ExportJobDto) => {
    setExportError(null);
    try {
      const fresh = await auditApi.getExport(job.id);
      if (fresh.downloadUrl) triggerDownload(fresh.downloadUrl);
      else setExportError('This export is no longer available. Generate a new one.');
      void log.reload();
    } catch (err) {
      setExportError(describeApiError(err));
    }
  };

  // ── integrity check ──
  const [verify, setVerify] = useState<{ state: 'idle' | 'running' | 'done' | 'error'; result?: AuditVerifyResponse; error?: string }>({ state: 'idle' });
  const runVerify = async () => {
    setVerify({ state: 'running' });
    try {
      setVerify({ state: 'done', result: await auditApi.verifyAuditChain() });
    } catch (err) {
      setVerify({ state: 'error', error: describeApiError(err) });
    }
  };

  return (
    <div className="space-y-6">
      {/* Export & Compliance Header */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-4">
          <div>
            <h2 className="font-display text-base font-bold text-[#061B3A]">Programme Reporting &amp; Audit Exports</h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Download auditable closed-loop evidence for funders, clinical governance committees, and regulatory inspections.
              Referral exports identify patients by programme code only.
            </p>
          </div>

          {canExport ? (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={exporting !== null}
                onClick={() => startExport('CASES_CSV')}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#008E97] hover:bg-[#00767E] disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
              >
                {exporting === 'CASES_CSV' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                <span>{exporting === 'CASES_CSV' ? 'Preparing…' : 'Download Referral Cohort (CSV)'}</span>
              </button>
              <button
                type="button"
                disabled={exporting !== null}
                onClick={() => startExport('GOVERNANCE_CSV')}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-[#061B3A] bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
              >
                {exporting === 'GOVERNANCE_CSV' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                <span>{exporting === 'GOVERNANCE_CSV' ? 'Preparing…' : 'Programme Performance Summary (CSV)'}</span>
              </button>
              <button
                type="button"
                disabled={exporting !== null}
                onClick={() => startExport('AUDIT_CSV')}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-[#061B3A] bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
              >
                {exporting === 'AUDIT_CSV' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                <span>{exporting === 'AUDIT_CSV' ? 'Preparing…' : 'Export Immutable Audit Log (CSV)'}</span>
              </button>
            </div>
          ) : (
            <p className="text-xs text-slate-500">Your role can view the audit trail but not generate exports.</p>
          )}

          {exportError && (
            <div role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
              {exportError}
            </div>
          )}
          {notice && (
            <div role="status" className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5">
              {notice}
            </div>
          )}
        </div>

        <div className="lg:col-span-5 bg-[#061B3A] text-white rounded-xl p-5 space-y-2.5">
          <div className="flex items-center gap-2 text-teal-200 text-xs font-semibold">
            <ShieldCheck className="w-4 h-4" />
            <span>Regulatory &amp; Data Protection Controls</span>
          </div>
          <ul className="space-y-1.5 text-xs text-slate-200">
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-teal-300 shrink-0" />
              <span>Kenya Data Protection Act (2019) &amp; Digital Health Act (2023) aligned</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-teal-300 shrink-0" />
              <span>Least-privilege RBAC &amp; segregated sensitive identifiers</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-teal-300 shrink-0" />
              <span>Tamper-evident, hash-chained log of all consent &amp; status events</span>
            </li>
          </ul>
        </div>
      </div>

      {canExport && <ScheduledReports />}

      {/* Recent exports */}
      {canExport && exports.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200">
            <h3 className="font-display text-sm font-bold text-[#061B3A]">Recent exports</h3>
            <p className="text-xs text-slate-500 mt-0.5">Files are kept for 7 days, then deleted.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                  <th className="py-2.5 px-5">File</th>
                  <th className="py-2.5 px-3">Requested by</th>
                  <th className="py-2.5 px-3">When</th>
                  <th className="py-2.5 px-3 text-right">Rows</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-5 text-right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {exports.slice(0, 8).map((job) => (
                  <tr key={job.id}>
                    <td className="py-2.5 px-5">
                      <span className="font-medium text-[#061B3A]">{EXPORT_LABELS[job.type]}</span>
                      <span className="block font-mono text-[11px] text-slate-500">
                        {job.fileName}
                        {job.sha256 && <> · sha256 {job.sha256.slice(0, 10)}…</>}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">{job.requestedBy}</td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-slate-500 whitespace-nowrap">{formatDateTime(job.requestedAt)}</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                      {job.rowCount ?? '—'} <span className="text-slate-400">· {formatBytes(job.byteSize)}</span>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-semibold ${STATUS_STYLE[job.status]}`}>
                        {job.status.charAt(0) + job.status.slice(1).toLowerCase()}
                      </span>
                    </td>
                    <td className="py-2.5 px-5 text-right">
                      {job.status === 'READY' && (
                        <button
                          type="button"
                          onClick={() => downloadAgain(job)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 text-[#061B3A] cursor-pointer"
                        >
                          <Download className="w-3 h-3" />
                          Download
                        </button>
                      )}
                      {job.status === 'FAILED' && <span className="text-red-700">{job.error}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Audit Log Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-sm font-bold text-[#061B3A]">Immutable Governance &amp; Access Trail</h3>
            <p className="text-xs text-slate-500 mt-0.5">Every intake, handoff, consent change, escalation, closure and export event</p>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
            <button
              type="button"
              onClick={runVerify}
              disabled={verify.state === 'running'}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#061B3A] border border-slate-200 hover:bg-slate-50 disabled:opacity-60 rounded-lg cursor-pointer whitespace-nowrap"
            >
              {verify.state === 'running' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
              <span>{verify.state === 'running' ? 'Verifying…' : 'Verify integrity'}</span>
            </button>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by case ID, actor, or action..."
              aria-label="Filter audit events"
              className="px-3 py-1.5 text-xs bg-[#F8FAFC] border border-slate-200 rounded-lg text-[#061B3A] w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-[#009CA6]"
            />
          </div>
        </div>

        {verify.state === 'done' && verify.result && (
          <div
            role="status"
            className={`px-5 py-3 text-xs flex items-start gap-2.5 border-b ${
              verify.result.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            {verify.result.ok ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-px" /> : <ShieldAlert className="w-4 h-4 shrink-0 mt-px" />}
            <div className="space-y-0.5">
              {verify.result.ok ? (
                <p className="font-semibold">
                  Chain intact: {verify.result.count} event{verify.result.count === 1 ? '' : 's'} verified. No event has been altered, removed or reordered.
                </p>
              ) : (
                <p className="font-semibold">
                  Integrity check FAILED at event {verify.result.brokenAtId}: {verify.result.reason}. Contact your administrator.
                </p>
              )}
              {verify.result.tipHash && (
                <p className="font-mono text-[11px] opacity-80 break-all">
                  Fingerprint {verify.result.tipHash} · checked {formatDateTime(verify.result.verifiedAt)}
                </p>
              )}
            </div>
          </div>
        )}
        {verify.state === 'error' && (
          <div role="alert" className="px-5 py-3 text-xs text-red-800 bg-red-50 border-b border-red-200">
            {verify.error}
          </div>
        )}

        {log.status === 'error' && (
          <div role="alert" className="px-5 py-3 text-xs text-red-800 bg-red-50 border-b border-red-200 flex items-center justify-between gap-3">
            <span>{log.error}</span>
            <button type="button" onClick={() => void log.reload()} className="font-semibold underline cursor-pointer">
              Retry
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                <th className="py-2.5 px-5">Timestamp</th>
                <th className="py-2.5 px-3">Actor &amp; Role</th>
                <th className="py-2.5 px-3">Event Type</th>
                <th className="py-2.5 px-3">Case / Resource</th>
                <th className="py-2.5 px-5">Recorded Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {log.events.map((ev) => (
                <tr key={ev.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-5 font-mono tabular-nums text-slate-500 whitespace-nowrap">{formatDateTime(ev.at)}</td>
                  <td className="py-3 px-3 whitespace-nowrap">
                    <span className="font-medium text-[#061B3A]">{ev.actor}</span>
                    <span className="block text-[11px] text-slate-500">{ev.role}</span>
                  </td>
                  <td className="py-3 px-3 font-mono text-[11px] font-semibold text-[#00828C] whitespace-nowrap">{ev.action}</td>
                  <td className="py-3 px-3 font-mono font-medium text-[#061B3A] whitespace-nowrap">{ev.resourceId}</td>
                  <td className="py-3 px-5 text-slate-700">{ev.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {log.status === 'loading' && log.events.length === 0 && (
          <p aria-busy="true" className="px-5 py-8 text-center text-xs text-slate-500">
            Loading audit trail…
          </p>
        )}
        {log.status === 'ready' && log.events.length === 0 && (
          <p className="px-5 py-8 text-center text-xs text-slate-500">
            {search ? `No events match “${search}”.` : 'No events recorded yet.'}
          </p>
        )}
        {log.hasMore && (
          <div className="px-5 py-3 border-t border-slate-100 text-center">
            <button
              type="button"
              onClick={log.loadMore}
              disabled={log.loadingMore}
              className="px-4 py-1.5 text-xs font-semibold text-[#00828C] hover:text-[#061B3A] disabled:opacity-60 cursor-pointer"
            >
              {log.loadingMore ? 'Loading…' : 'Load older events'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
