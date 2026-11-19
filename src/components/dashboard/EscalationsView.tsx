import { useState } from 'react';
import { AlertTriangle, PhoneCall, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { ReferralCase } from '../../data/dashboardData';

interface EscalationsViewProps {
  cases: ReferralCase[];
  onEscalateToClinicalLead: (caseId: string, reason: string) => void;
  onLogBarrierResolution: (caseId: string, barrierNote: string) => void;
  onSelectCase: (c: ReferralCase) => void;
}

const BARRIER_OPTIONS = [
  'Transport / Distance Support Arranged',
  'Facility Fee / NHIF Waiver Confirmed',
  'Human Coordinator Phone Follow-up Completed',
  'Rescheduled Appointment Window',
];

export function EscalationsView({
  cases,
  onEscalateToClinicalLead,
  onLogBarrierResolution,
  onSelectCase,
}: EscalationsViewProps) {
  const [selectedBarrier, setSelectedBarrier] = useState<string>(BARRIER_OPTIONS[0]);

  const escalatedOrOverdue = cases.filter(
    (c) =>
      c.status !== 'Closed Verified' &&
      (c.status === 'Overdue SLA' || c.stage === 'Escalated' || c.redFlag || c.slaHoursRemaining <= 12)
  );

  return (
    <div className="space-y-6">
      {/* Top Banner: Barrier Resolution Selector */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-base font-bold text-[#061B3A]">
            SLA Escalation &amp; Barrier Resolution Queue
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Cases approaching or exceeding partner-configured deadlines, red-flag presentations, or digital contact opt-outs.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <label htmlFor="barrier-preset" className="text-xs font-medium text-slate-600 whitespace-nowrap">
            Resolution Action:
          </label>
          <select
            id="barrier-preset"
            value={selectedBarrier}
            onChange={(e) => setSelectedBarrier(e.target.value)}
            className="px-3 py-2 text-xs bg-[#F8FAFC] border border-slate-200 rounded-lg text-[#061B3A] focus:outline-none focus:ring-2 focus:ring-[#009CA6]"
          >
            {BARRIER_OPTIONS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Queue List */}
      {escalatedOrOverdue.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
          <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
          <p className="font-display text-base font-bold text-[#061B3A]">
            Zero active SLA breaches
          </p>
          <p className="text-sm text-slate-600">
            All open referrals are currently tracking within partner-approved deadlines.
          </p>
        </div>
      ) : (
        <div className="space-y-3.5">
          {escalatedOrOverdue.map((c) => {
            const isBreached = c.slaHoursRemaining < 0 || c.status === 'Overdue SLA';
            return (
              <div
                key={c.id}
                className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => onSelectCase(c)}
                      className="font-mono text-xs font-bold text-[#061B3A] hover:underline tabular-nums cursor-pointer"
                    >
                      {c.id}
                    </button>
                    <span className="text-xs text-slate-500">
                      {c.patientCode} · {c.pathway}
                    </span>
                    {c.redFlag && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        Clinical Red Flag
                      </span>
                    )}
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-mono font-semibold tabular-nums ${
                        isBreached ? 'text-red-700' : 'text-amber-700'
                      }`}
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {c.slaHoursRemaining < 0
                        ? `${Math.abs(c.slaHoursRemaining)}h overdue`
                        : `${c.slaHoursRemaining}h remaining`}
                    </span>
                  </div>

                  <p className="text-sm text-slate-700 leading-relaxed">{c.notes}</p>
                  <p className="text-xs text-slate-500">
                    Owner: <span className="font-medium text-[#061B3A]">{c.coordinator}</span> · Destination:{' '}
                    <span className="font-medium text-[#061B3A]">{c.receivingFacility}</span>
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {c.stage !== 'Escalated' && (
                    <button
                      type="button"
                      onClick={() =>
                        onEscalateToClinicalLead(
                          c.id,
                          'Escalated to Partner Clinical Lead due to SLA window'
                        )
                      }
                      className="px-3.5 py-2 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                    >
                      Escalate to Clinical Lead
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onLogBarrierResolution(c.id, selectedBarrier)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#008E97] hover:bg-[#00767E] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <PhoneCall className="w-3.5 h-3.5" />
                    <span>Log Coordinator Resolution</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
