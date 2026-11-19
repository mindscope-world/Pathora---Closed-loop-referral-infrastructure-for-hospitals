import { ReferralCase, PathwayName } from '../../data/dashboardData';
import { ReferralProgressTracker } from './ReferralProgressTracker';
import { DashboardSummary } from './DashboardSummary';
import type { OverviewMetricsDto, UpcomingMetricsDto } from '../../../shared/types';
import { PATHWAY_LABELS } from '../../../shared/types';

interface OverviewViewProps {
  /** Used for the priority queue only; every headline figure comes from the server metrics below. */
  cases: ReferralCase[];
  overview: OverviewMetricsDto | null;
  upcoming: UpcomingMetricsDto | null;
  upcomingCases: ReferralCase[];
  metricsError: string | null;
  onRetryMetrics: () => void;
  onSelectCase: (c: ReferralCase) => void;
  onNavigate: (tab: 'cases' | 'facilities' | 'escalations') => void;
}

export function OverviewView({ cases, overview, upcoming, upcomingCases, metricsError, onRetryMetrics, onSelectCase, onNavigate }: OverviewViewProps) {

  const priorityCases = cases.filter(
    (c) => c.status === 'Overdue SLA' || c.status === 'Awaiting Ack' || c.redFlag
  );

  // The three pathways the programme runs are always listed; any other appears once it has referrals.
  const SHOWN: PathwayName[] = ['Cancer Screening', 'NCD Screening', 'Male Reproductive Health'];
  const pathwayRows = (overview?.pathways ?? [])
    .map((p) => ({ name: PATHWAY_LABELS[p.pathway], ...p }))
    .filter((p) => (SHOWN as string[]).includes(p.name) || p.cases > 0);
  const hours = (h: number | null) => (h === null ? '—' : h < 48 ? `${h} hrs` : `${Math.round((h / 24) * 10) / 10} days`);

  return (
    <div className="space-y-6">
      <DashboardSummary
        overview={overview}
        upcoming={upcoming}
        upcomingCases={upcomingCases}
        error={metricsError}
        onRetry={onRetryMetrics}
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
            {(overview?.funnel ?? []).map((step) => (
              <div key={step.key} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-[#061B3A]">{step.label}</span>
                  <span className="font-mono tabular-nums text-slate-600">
                    {step.count} ({step.percent}%)
                  </span>
                </div>
                <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#061B3A] to-[#009CA6] rounded-full transition-all duration-300"
                    style={{ width: `${step.percent}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          {overview && (
            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100 text-xs">
              <div>
                <p className="text-slate-500">Median time to acknowledge</p>
                <p className="font-mono font-semibold text-[#061B3A] tabular-nums">{hours(overview.medianHoursToAcknowledge)}</p>
              </div>
              <div>
                <p className="text-slate-500">Median time to verified close</p>
                <p className="font-mono font-semibold text-[#061B3A] tabular-nums">{hours(overview.medianHoursToClose)}</p>
              </div>
            </div>
          )}
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
                {pathwayRows.map((p) => (
                  <tr key={p.pathway} className="hover:bg-slate-50/80">
                    <td className="py-3 pr-3 font-medium text-[#061B3A]">{p.name}</td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">{p.cases}</td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-[#00828C]">{p.acknowledged}</td>
                    <td className="py-3 pl-3 text-right font-mono tabular-nums text-emerald-700 font-semibold">{p.closedVerified}</td>
                  </tr>
                ))}
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
