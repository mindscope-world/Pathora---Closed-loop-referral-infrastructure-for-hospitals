import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, History, MinusCircle, Play, RefreshCw, Sliders, XCircle } from 'lucide-react';
import type {
  RulePackDto,
  RulePackStatus,
  RulePackVersionDto,
  SyntheticTestResponse,
  UpdateRulePackRequest,
} from '../../../shared/types';
import * as api from '../../api/rulepacks';
import { formatDate, formatDateTime } from '../../data/caseViewModel';
import { describeApiError } from '../../data/useWorkspace';
import { ApiError } from '../../lib/api';

const STATUS_LABEL: Record<RulePackStatus, string> = { ACTIVE: 'Active', CONFIGURED: 'Configured', COMING_SOON: 'Coming Soon' };

interface Props {
  /** Only the Partner Clinical Lead may change rules or run the gate test (the server enforces it). */
  canEdit: boolean;
}

interface Draft {
  ack: string;
  contact: string;
  evalDays: string;
  /** '' = no automatic red-flag timer. */
  redFlagHours: string;
  redFlagRule: string;
  closureCriteria: string;
  ownerId: string;
  status: RulePackStatus;
}

const draftOf = (p: RulePackDto): Draft => ({
  ack: String(p.ackSlaHours), contact: String(p.contactSlaHours), evalDays: String(p.evalTargetDays),
  redFlagHours: p.redFlagPolicy.unacknowledgedHours === null ? '' : String(p.redFlagPolicy.unacknowledgedHours),
  redFlagRule: p.redFlagRule, closureCriteria: p.closureCriteria, ownerId: p.clinicalOwner?.id ?? '', status: p.status,
});

const field = 'w-full px-2.5 py-1.5 text-sm bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#009CA6]';

export function PathwaysView({ canEdit }: Props) {
  const [packs, setPacks] = useState<RulePackDto[]>([]);
  const [leads, setLeads] = useState<Array<{ id: string; name: string }>>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const alive = useRef(true);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<{ message: string; fields: Record<string, string> } | null>(null);

  const [history, setHistory] = useState<{ id: string; versions: RulePackVersionDto[] } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<SyntheticTestResponse | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.listRulePacks();
      if (!alive.current) return;
      setPacks(res.rulePacks);
      setLeads(res.clinicalLeads);
      setStatus('ready');
    } catch (err) {
      if (!alive.current) return;
      setError(describeApiError(err));
      setStatus((s) => (s === 'ready' ? s : 'error'));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => { alive.current = false; };
  }, [load]);

  const startEdit = (p: RulePackDto) => {
    setEditingId(p.id);
    setDraft(draftOf(p));
    setEditError(null);
    setNotice(null);
  };

  const save = async (p: RulePackDto) => {
    if (!draft || saving) return;
    const num = (v: string) => (v.trim() === '' ? NaN : Number(v));
    const patch: UpdateRulePackRequest = {
      ackSlaHours: num(draft.ack), contactSlaHours: num(draft.contact), evalTargetDays: num(draft.evalDays),
      redFlagPolicy: { unacknowledgedHours: draft.redFlagHours.trim() === '' ? null : num(draft.redFlagHours) },
      redFlagRule: draft.redFlagRule, closureCriteria: draft.closureCriteria, clinicalOwnerId: draft.ownerId || null, status: draft.status,
      expectedVersion: p.version,
    };
    // NaN would serialise as null and be rejected anyway; catch it here for a clearer message.
    if ([patch.ackSlaHours, patch.contactSlaHours, patch.evalTargetDays, patch.redFlagPolicy?.unacknowledgedHours ?? 0].some((n) => Number.isNaN(n))) {
      setEditError({ message: 'Enter a number for every timer.', fields: {} });
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      const saved = await api.updateRulePack(p.id, patch);
      setPacks((prev) => prev.map((x) => (x.id === saved.id ? saved : x)));
      setNotice(
        saved.version === p.version
          ? `${saved.name}: no changes to publish.`
          : `${saved.name}: published version ${saved.version}. New referrals use these rules; referrals already open keep theirs.`,
      );
      setEditingId(null);
      setHistory(null);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
        setEditError({ message: err.message, fields: {} });
        void load(); // show the newer version underneath
      } else if (err instanceof ApiError && err.code === 'VALIDATION_ERROR') {
        const f = err.fieldErrors;
        setEditError({ message: Object.values(f).join(' ') || 'Please correct the highlighted fields.', fields: f });
      } else {
        setEditError({ message: describeApiError(err), fields: {} });
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleHistory = async (p: RulePackDto) => {
    if (history?.id === p.id) return setHistory(null);
    try {
      setHistory({ id: p.id, versions: await api.listRulePackVersions(p.id) });
    } catch (err) {
      setError(describeApiError(err));
    }
  };

  const runTest = async (p: RulePackDto) => {
    if (testing) return;
    setTesting(p.id);
    setTestResult(null);
    setError(null);
    try {
      setTestResult(await api.runSyntheticTest(p.id));
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setTesting(null);
    }
  };

  const fe = (name: string) => editError?.fields[name] && <p role="alert" className="mt-1 text-[11px] text-red-700">{editError.fields[name]}</p>;

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-[#061B3A]">Versioned Pathway Rule Packs</h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Deterministic workflow rules, SLA thresholds, and closure criteria approved by your clinical lead. Every change publishes a new version; referrals already open keep the rules they were created under.
          </p>
        </div>
        <span className="text-xs text-slate-500">Condition-agnostic engine · Zero AI triage</span>
      </div>

      {error && <div role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">{error}</div>}
      {notice && <div role="status" className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5">{notice}</div>}
      {status === 'loading' && <p aria-busy="true" className="text-xs text-slate-500">Loading rule packs…</p>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {packs.map((pack) => {
          const comingSoon = pack.status === 'COMING_SOON';
          const isEditing = editingId === pack.id && draft !== null;
          const timer = pack.redFlagPolicy.unacknowledgedHours;
          return (
            <div key={pack.id} className={`border rounded-xl p-5 flex flex-col justify-between space-y-4 ${comingSoon ? 'bg-slate-50/80 border-slate-200/80' : 'bg-white border-slate-200'}`}>
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="font-display text-base font-bold text-[#061B3A]">{pack.name}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      v{pack.version} · effective {formatDate(pack.effectiveFrom)} ·{' '}
                      {pack.clinicalOwner ? `Owner: ${pack.clinicalOwner.name}` : 'No clinical owner named'}
                    </p>
                  </div>
                  <span className={`text-xs font-semibold whitespace-nowrap ${pack.status === 'ACTIVE' ? 'text-emerald-700' : pack.status === 'CONFIGURED' ? 'text-[#00828C]' : 'text-slate-500'}`}>
                    {STATUS_LABEL[pack.status]}
                  </span>
                </div>

                {isEditing && draft ? (
                  <div className="space-y-3 bg-[#F8FAFC] p-3.5 rounded-lg border border-slate-200">
                    {editError && <div role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-2.5 py-2">{editError.message}</div>}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">Facility Ack SLA (hrs)</label>
                        <input type="number" min={1} max={168} value={draft.ack} onChange={(e) => setDraft({ ...draft, ack: e.target.value })} className={`${field} font-mono`} />
                        {fe('ackSlaHours')}
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">Contact SLA (hrs)</label>
                        <input type="number" min={1} max={168} value={draft.contact} onChange={(e) => setDraft({ ...draft, contact: e.target.value })} className={`${field} font-mono`} />
                        {fe('contactSlaHours')}
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">Eval Target (days)</label>
                        <input type="number" min={1} max={90} value={draft.evalDays} onChange={(e) => setDraft({ ...draft, evalDays: e.target.value })} className={`${field} font-mono`} />
                        {fe('evalTargetDays')}
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">Red-flag timer (hrs)</label>
                        <input type="number" min={1} max={168} value={draft.redFlagHours} placeholder="none" onChange={(e) => setDraft({ ...draft, redFlagHours: e.target.value })} className={`${field} font-mono`} />
                        {fe('redFlagPolicy')}
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      The red-flag timer escalates a red-flagged referral to a human if the facility has not acknowledged it in time. Leave it empty for no automatic escalation.
                    </p>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Red-flag route (wording)</label>
                      <textarea rows={2} value={draft.redFlagRule} onChange={(e) => setDraft({ ...draft, redFlagRule: e.target.value })} className={field} />
                      {fe('redFlagRule')}
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Closure criteria</label>
                      <textarea rows={2} value={draft.closureCriteria} onChange={(e) => setDraft({ ...draft, closureCriteria: e.target.value })} className={field} />
                      {fe('closureCriteria')}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">Clinical owner</label>
                        <select value={draft.ownerId} onChange={(e) => setDraft({ ...draft, ownerId: e.target.value })} className={field}>
                          <option value="">None named</option>
                          {pack.clinicalOwner && !leads.some((l) => l.id === pack.clinicalOwner!.id) && <option value={pack.clinicalOwner.id}>{pack.clinicalOwner.name} (current)</option>}
                          {leads.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </select>
                        {fe('clinicalOwnerId')}
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">Status</label>
                        <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as RulePackStatus })} className={field}>
                          {(Object.keys(STATUS_LABEL) as RulePackStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-4 gap-2 bg-[#F8FAFC] border border-slate-200/70 rounded-lg p-3 text-xs">
                      <div><span className="block text-slate-500">Contact SLA</span><span className="font-mono font-semibold text-[#061B3A] tabular-nums">{pack.contactSlaHours}h</span></div>
                      <div><span className="block text-slate-500">Ack SLA</span><span className="font-mono font-semibold text-[#061B3A] tabular-nums">{pack.ackSlaHours}h</span></div>
                      <div><span className="block text-slate-500">Eval Target</span><span className="font-mono font-semibold text-[#061B3A] tabular-nums">{pack.evalTargetDays} days</span></div>
                      <div><span className="block text-slate-500">Red-flag timer</span><span className="font-mono font-semibold text-[#061B3A] tabular-nums">{timer === null ? 'none' : `${timer}h`}</span></div>
                    </div>
                    <div className="space-y-2 text-xs text-slate-600">
                      <p><span className="font-semibold text-[#061B3A]">Red-Flag Route:</span> {pack.redFlagRule}</p>
                      <p><span className="font-semibold text-[#061B3A]">Closure Criteria:</span> {pack.closureCriteria}</p>
                    </div>
                  </>
                )}

                {history?.id === pack.id && (
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-left text-[11px]">
                      <thead><tr className="bg-slate-50 text-slate-500 font-semibold"><th className="py-1.5 px-2.5">Version</th><th className="py-1.5 px-2.5">Effective</th><th className="py-1.5 px-2.5">Ack / Contact / Eval / Flag</th><th className="py-1.5 px-2.5">Approved by</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {history.versions.map((v) => (
                          <tr key={v.version}>
                            <td className="py-1.5 px-2.5 font-mono font-semibold">v{v.version}</td>
                            <td className="py-1.5 px-2.5 font-mono text-slate-500 whitespace-nowrap">{formatDateTime(v.effectiveFrom)}</td>
                            <td className="py-1.5 px-2.5 font-mono tabular-nums">{v.ackSlaHours}h / {v.contactSlaHours}h / {v.evalTargetDays}d / {v.redFlagPolicy.unacknowledgedHours ?? '–'}</td>
                            <td className="py-1.5 px-2.5 text-slate-600">{v.editedBy ?? 'Initial version'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                {isEditing ? (
                  <div className="flex items-center gap-2">
                    <button type="button" disabled={saving} onClick={() => save(pack)} className="px-3 py-1.5 text-xs font-semibold text-white bg-[#008E97] disabled:opacity-60 rounded-lg cursor-pointer">
                      {saving ? 'Publishing…' : 'Publish New Version'}
                    </button>
                    <button type="button" onClick={() => setEditingId(null)} className="px-3 py-1.5 text-xs text-slate-600 cursor-pointer">Cancel</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    {canEdit && (
                      <button type="button" onClick={() => startEdit(pack)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#061B3A] border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer">
                        <Sliders className="w-3.5 h-3.5" /><span>Adjust Rules</span>
                      </button>
                    )}
                    <button type="button" onClick={() => toggleHistory(pack)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-[#061B3A] cursor-pointer">
                      <History className="w-3.5 h-3.5" /><span>{history?.id === pack.id ? 'Hide history' : 'Version history'}</span>
                    </button>
                  </div>
                )}

                {canEdit && !isEditing && (
                  <button type="button" disabled={testing !== null} onClick={() => runTest(pack)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#00828C] hover:text-[#061B3A] disabled:opacity-60 cursor-pointer">
                    {testing === pack.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    <span>{testing === pack.id ? 'Running…' : 'Run Synthetic Gate Test'}</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {testResult && (
        <div className="bg-[#061B3A] text-white rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-teal-200">Synthetic Go-Live Gate Verification</p>
              <h3 className="font-display text-base font-bold">{testResult.rulePack.name} · v{testResult.rulePack.version}</h3>
              <p className={`text-xs font-semibold mt-1 ${testResult.passed ? 'text-emerald-300' : 'text-red-300'}`}>
                {testResult.passed ? 'All checks passed' : 'One or more checks FAILED. Do not go live with these rules.'}
              </p>
            </div>
            <button type="button" onClick={() => setTestResult(null)} className="text-xs text-slate-300 hover:text-white cursor-pointer">Dismiss</button>
          </div>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-200">
            {testResult.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-2">
                {c.outcome === 'PASSED' ? <CheckCircle2 className="w-4 h-4 text-teal-300 shrink-0 mt-0.5" /> : c.outcome === 'FAILED' ? <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" /> : <MinusCircle className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />}
                <span>
                  <span className="block font-semibold text-white">{c.title} <span className="font-normal text-slate-400">({c.outcome.toLowerCase()})</span></span>
                  <span className="block text-slate-300 leading-relaxed">{c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-slate-400">Run on the real detection logic with fixture referrals that are rolled back afterwards. Nothing is saved except a record that the test was run.</p>
        </div>
      )}
    </div>
  );
}
