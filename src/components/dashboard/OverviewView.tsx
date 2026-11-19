import { ReferralCase, PathwayName } from '../../data/dashboardData';
import { ReferralProgressTracker } from './ReferralProgressTracker';
import { DashboardSummary } from './DashboardSummary';

interface OverviewViewProps {
  cases: ReferralCase[];
  onSelectCase: (c: ReferralCase) => void;
  onNavigate: (tab: 'cases' | 'facilities' | 'escalations') => void;
}

const FUNNEL_ORDER: Array<{ label: string; stages: ReferralCase['stage'][] }> = [
  { label: '1. Intake & Assigned', stages: ['Intake', 'Assigned', 'Contacted', 'Handoff Sent', 'Acknowledged', 'Attended', 'Escalated', 'Closed'] },
  { label: '2. Facility Handoff Sent', stages: ['Handoff Sent', 'Acknowledged', 'Attended', 'Escalated', 'Closed'] },
  { label: '3. Facility Acknowledged', stages: ['Acknowledged', 'Attended', 'Closed'] },
  { label: '4. Patient Attended', stages: ['Attended', 'Closed'] },
  { label: '5. Verified Outcome Closed', stages: ['Closed'] },
];

export function OverviewView({ cases, onSelectCase, onNavigate }: OverviewViewProps) {
  const totalCases = cases.length;

  const priorityCases = cases.filter(
    (c) => c.status === 'Overdue SLA' || c.status === 'Awaiting Ack' || c.redFlag
  );

  const pathways: PathwayName[] = [
    'Cancer Screening',
    'NCD Screening',
    'Male Reproductive Health',
  ];

  return (
    <div className="space-y-6">
      <DashboardSummary
        cases={cases}
        onNavigate={onNavigate}
        onSelectCase={onSelectCase}
      />

      {/* Middle Split: Closed-Loop Funnel + Pathway Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Funnel Card */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3.5">
            <div>
              <h2 className="font-display text-base font-bold text-[#061B3A]">
                Closed-Loop Referral Funnel
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Cumulative progression from positive screen to documented outcome
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('cases')}
              className="text-xs font-semibold text-[#00828C] hover:text-[#061B3A] whitespace-nowrap cursor-pointer"
            >
              View all cases →
            </button>
          </div>

          <div className="space-y-3.5">
            {FUNNEL_ORDER.map((step) => {
              const count = cases.filter((c) => step.stages.includes(c.stage)).length;
              const pct = totalCases > 0 ? Math.round((count / totalCases) * 100) : 0;
              return (
                <div key={step.label} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-[#061B3A]">{step.label}</span>
                    <span className="font-mono tabular-nums text-slate-600">
                      {count} ({pct}%)
                    </span>
                  </div>
                  <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[#061B3A] to-[#009CA6] rounded-full transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Pathway Performance Table */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 flex flex-col justify-between space-y-4">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3.5">
            <div>
              <h2 className="font-display text-base font-bold text-[#061B3A]">
                Performance by Clinical Pathway
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Live operational distribution across active rule packs
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('facilities')}
              className="text-xs font-semibold text-[#00828C] hover:text-[#061B3A] whitespace-nowrap cursor-pointer"
            >
              Facility desk →
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                  <th className="py-2 pr-3">Pathway</th>
                  <th className="py-2 px-3 text-right">Cases</th>
                  <th className="py-2 px-3 text-right">Acked</th>
                  <th className="py-2 pl-3 text-right">Closed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {pathways.map((pathway) => {
                  const pCases = cases.filter((c) => c.pathway === pathway);
                  const pAck = pCases.filter((c) => Boolean(c.milestones.facilityAcknowledgedAt)).length;
                  const pClosed = pCases.filter((c) => c.status === 'Closed Verified').length;
                  return (
                    <tr key={pathway} className="hover:bg-slate-50/80">
                      <td className="py-3 pr-3 font-medium text-[#061B3A]">{pathway}</td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                        {pCases.length}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-[#00828C]">
                        {pAck}
                      </td>
                      <td className="py-3 pl-3 text-right font-mono tabular-nums text-emerald-700 font-semibold">
                        {pClosed}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-slate-500 pt-2 border-t border-slate-100">
            Live cohort figures exclude synthetic red-flag simulation tests.
          </p>
        </div>
      </div>

      {/* Priority Attention Queue */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-bold text-[#061B3A]">
              Priority Action Queue
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Overdue SLA breaches, unacknowledged referrals, and clinical red-flag cases
            </p>
          </div>
          <span className="font-mono text-xs tabular-nums text-slate-600">
            {priorityCases.length} cases requiring review
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                <th className="py-2.5 px-5">Case ID</th>
                <th className="py-2.5 px-3">Pathway</th>
                <th className="py-2.5 px-3">Named Owner</th>
                <th className="py-2.5 px-3">Journey Progress</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {priorityCases.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => onSelectCase(item)}
                  className="hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <td className="py-3 px-5 font-mono text-xs font-semibold text-[#061B3A] tabular-nums whitespace-nowrap">
                    {item.id}
                    {item.redFlag && (
                      <span className="ml-2 text-red-700 font-sans font-semibold">
                        Red Flag
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-slate-700 whitespace-nowrap">{item.pathway}</td>
                  <td className="py-3 px-3 text-slate-700 whitespace-nowrap">{item.coordinator}</td>
                  <td className="py-3 px-3">
                    <ReferralProgressTracker referral={item} variant="compact" />
                  </td>
                  <td className="py-3 px-3 whitespace-nowrap">
                    <span
                      className={`text-xs font-semibold ${
                        item.status === 'Overdue SLA'
                          ? 'text-red-700'
                          : item.status === 'Awaiting Ack'
                          ? 'text-amber-700'
                          : 'text-[#00828C]'
                      }`}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="py-3 px-5 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectCase(item);
                      }}
                      className="text-xs font-semibold text-[#00828C] hover:text-[#061B3A] cursor-pointer"
                    >
                      Inspect →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
