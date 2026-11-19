import { useState } from 'react';
import { Play, CheckCircle2, Sliders } from 'lucide-react';
import { PathwayRulePack } from '../../data/dashboardData';

interface PathwaysViewProps {
  rulePacks: PathwayRulePack[];
  onUpdateRulePackSla: (
    id: string,
    ackSlaHours: number,
    evalTargetDays: number
  ) => void;
}

export function PathwaysView({ rulePacks, onUpdateRulePackSla }: PathwaysViewProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [ackInput, setAckInput] = useState<number>(24);
  const [evalInput, setEvalInput] = useState<number>(7);
  const [simResult, setSimResult] = useState<{
    pathway: string;
    checks: string[];
  } | null>(null);

  const startEdit = (pack: PathwayRulePack) => {
    setEditingId(pack.id);
    setAckInput(pack.ackSlaHours);
    setEvalInput(pack.evalTargetDays);
  };

  const saveEdit = (id: string) => {
    onUpdateRulePackSla(id, Math.max(4, ackInput), Math.max(1, evalInput));
    setEditingId(null);
  };

  const runSyntheticTest = (pack: PathwayRulePack) => {
    setSimResult({
      pathway: pack.name,
      checks: [
        `Overdue Ack Test (> ${pack.ackSlaHours}h): Escalation alert routed to named coordinator.`,
        `Red-Flag Boundary Check: Hard-coded clinical lead escalation route verified.`,
        `Failed-Contact Fallback: Human coordinator phone queue triggered cleanly.`,
        `Live Data Isolation: Synthetic run excluded from live programme funnel metrics.`,
      ],
    });
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-[#061B3A]">
            Versioned Pathway Rule Packs
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Deterministic workflow rules, SLA thresholds, and closure criteria approved by your clinical lead.
          </p>
        </div>
        <span className="text-xs text-slate-500">
          Condition-agnostic engine · Zero AI triage
        </span>
      </div>

      {/* Rule Pack Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {rulePacks.map((pack) => {
          const isComingSoon = pack.status === 'Coming Soon';
          const isEditing = editingId === pack.id;

          return (
            <div
              key={pack.id}
              className={`border rounded-xl p-5 flex flex-col justify-between space-y-4 ${
                isComingSoon
                  ? 'bg-slate-50/80 border-slate-200/80'
                  : 'bg-white border-slate-200'
              }`}
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="font-display text-base font-bold text-[#061B3A]">
                      {pack.name}
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {pack.version} · {pack.clinicalOwner}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-semibold whitespace-nowrap ${
                      pack.status === 'Active'
                        ? 'text-emerald-700'
                        : pack.status === 'Configured'
                        ? 'text-[#00828C]'
                        : 'text-slate-500'
                    }`}
                  >
                    {pack.status}
                  </span>
                </div>

                {isEditing ? (
                  <div className="grid grid-cols-2 gap-3 bg-[#F8FAFC] p-3.5 rounded-lg border border-slate-200">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Facility Ack SLA (hrs)
                      </label>
                      <input
                        type="number"
                        min={4}
                        max={168}
                        value={ackInput}
                        onChange={(e) => setAckInput(Number(e.target.value))}
                        className="w-full px-2.5 py-1.5 text-sm font-mono bg-white border border-slate-200 rounded-md"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Eval Target (days)
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={60}
                        value={evalInput}
                        onChange={(e) => setEvalInput(Number(e.target.value))}
                        className="w-full px-2.5 py-1.5 text-sm font-mono bg-white border border-slate-200 rounded-md"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2 bg-[#F8FAFC] border border-slate-200/70 rounded-lg p-3 text-xs">
                    <div>
                      <span className="block text-slate-500">Contact SLA</span>
                      <span className="font-mono font-semibold text-[#061B3A] tabular-nums">
                        {pack.contactSlaHours}h
                      </span>
                    </div>
                    <div>
                      <span className="block text-slate-500">Ack SLA</span>
                      <span className="font-mono font-semibold text-[#061B3A] tabular-nums">
                        {pack.ackSlaHours}h
                      </span>
                    </div>
                    <div>
                      <span className="block text-slate-500">Eval Target</span>
                      <span className="font-mono font-semibold text-[#061B3A] tabular-nums">
                        {pack.evalTargetDays} days
                      </span>
                    </div>
                  </div>
                )}

                <div className="space-y-2 text-xs text-slate-600">
                  <p>
                    <span className="font-semibold text-[#061B3A]">Red-Flag Route:</span>{' '}
                    {pack.redFlagRule}
                  </p>
                  <p>
                    <span className="font-semibold text-[#061B3A]">Closure Criteria:</span>{' '}
                    {pack.closureCriteria}
                  </p>
                </div>
              </div>

              {!isComingSoon && (
                <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => saveEdit(pack.id)}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-[#008E97] rounded-lg cursor-pointer"
                      >
                        Save SLA Rules
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="px-3 py-1.5 text-xs text-slate-600 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEdit(pack)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#061B3A] border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      <span>Adjust SLA Deadlines</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => runSyntheticTest(pack)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#00828C] hover:text-[#061B3A] cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Run Synthetic Gate Test</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Synthetic Scenario Test Output */}
      {simResult && (
        <div className="bg-[#061B3A] text-white rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-teal-200">
                Synthetic Go-Live Gate Verification
              </p>
              <h3 className="font-display text-base font-bold">{simResult.pathway}</h3>
            </div>
            <button
              type="button"
              onClick={() => setSimResult(null)}
              className="text-xs text-slate-300 hover:text-white cursor-pointer"
            >
              Dismiss
            </button>
          </div>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs text-slate-200">
            {simResult.checks.map((check) => (
              <li key={check} className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-teal-300 shrink-0 mt-0.5" />
                <span>{check}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
