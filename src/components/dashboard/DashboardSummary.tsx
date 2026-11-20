import {
  Activity,
  CalendarClock,
  CheckCircle2,
  ClipboardClock,
  AlertTriangle,
  ArrowUpRight,
} from 'lucide-react';
import { ReferralCase } from '../../data/dashboardData';
import type { OverviewMetricsDto, UpcomingMetricsDto } from '../../../shared/types';

interface DashboardSummaryProps {
  /** Server-computed figures; null until the first response arrives. */
  overview: OverviewMetricsDto | null;
  upcoming: UpcomingMetricsDto | null;
  /** The soonest upcoming referrals, ready to display. */
  upcomingCases: ReferralCase[];
  error: string | null;
  onRetry: () => void;
  onNavigate: (tab: 'cases' | 'facilities' | 'escalations') => void;
  onSelectCase: (c: ReferralCase) => void;
}

export function DashboardSummary({
  overview,
  upcoming,
  upcomingCases: upcomingAppointments,
  error,
  onRetry,
  onNavigate,
  onSelectCase,
}: DashboardSummaryProps) {
  if (!overview || !upcoming) {
    return (
      <section aria-label="Dashboard aggregate summary" aria-busy={!error} className="bg-white border border-slate-200 rounded-xl p-5 text-sm text-slate-500">
        {error ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-red-700">
            <span>Could not load programme figures. {error}</span>
            <button type="button" onClick={onRetry} className="text-xs font-semibold underline cursor-pointer">
              Try again
            </button>
          </div>
        ) : (
          'Loading programme figures…'
        )}
      </section>
    );
  }

  const totalCases = overview.total;
  const activeReferrals = { length: overview.activeReferrals };
  const pendingCareCompletions = { length: overview.pendingCareCompletions };
  const attendedAwaitingOutcome = overview.attendedAwaitingOutcome;
  const completedCases = { length: overview.statusCounts.closedVerified };
  const overdueCases = { length: overview.statusCounts.overdueSla };
  const completionRate = overview.completionRate;
  const upcomingCount = upcoming.count;

  return (
    <section aria-label="Dashboard aggregate summary" className="space-y-4">
      {error && (
        <div role="status" className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Showing the last figures received. {error}
        </div>
      )}
      {/* Aggregate Summary Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Active Referrals */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Total Active Referrals</span>
              <Activity className="w-4 h-4 text-[#008E97]" />
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="font-display text-3xl font-bold text-[#061B3A] tabular-nums">
                {activeReferrals.length}
              </span>
              <span className="text-xs text-slate-500 tabular-nums">
                of {totalCases} total cohort
              </span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-600">Open until outcome verified</span>
            <button
              type="button"
              onClick={() => onNavigate('cases')}
              className="font-semibold text-[#00828C] hover:text-[#061B3A] inline-flex items-center gap-0.5 cursor-pointer"
            >
              View
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Pending Care Completions */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Pending Care Completions</span>
              <ClipboardClock className="w-4 h-4 text-amber-600" />
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="font-display text-3xl font-bold text-[#061B3A] tabular-nums">
                {pendingCareCompletions.length}
              </span>
              <span className="text-xs font-medium text-amber-700 tabular-nums">
                {attendedAwaitingOutcome} attended · awaiting note
              </span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-600">Requires clinical endpoint</span>
            <button
              type="button"
              onClick={() => onNavigate('facilities')}
              className="font-semibold text-[#00828C] hover:text-[#061B3A] inline-flex items-center gap-0.5 cursor-pointer"
            >
              Facility Desk
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Upcoming Appointments This Week */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Upcoming Appointments (7d)</span>
              <CalendarClock className="w-4 h-4 text-[#008E97]" />
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="font-display text-3xl font-bold text-[#061B3A] tabular-nums">
                {upcomingCount}
              </span>
              <span className="text-xs text-[#00828C] font-medium">
                Scheduled this week
              </span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-600 truncate">
              Next:{' '}
              <span className="font-mono font-medium text-[#061B3A]">
                {upcomingAppointments[0]?.dueDate ?? 'None'}
              </span>
            </span>
            <button
              type="button"
              onClick={() =>
                upcomingAppointments[0]
                  ? onSelectCase(upcomingAppointments[0])
                  : onNavigate('cases')
              }
              className="font-semibold text-[#00828C] hover:text-[#061B3A] inline-flex items-center gap-0.5 cursor-pointer whitespace-nowrap"
            >
              Inspect next
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Verified Care Completed & SLA Status */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Verified Care Completed</span>
              {overdueCases.length > 0 ? (
                <AlertTriangle className="w-4 h-4 text-red-600" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              )}
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="font-display text-3xl font-bold text-[#061B3A] tabular-nums">
                {completionRate}%
              </span>
              <span className="text-xs font-medium text-emerald-700 tabular-nums">
                {completedCases.length} closed verified
              </span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
            <span
              className={
                overdueCases.length > 0
                  ? 'text-red-700 font-semibold tabular-nums'
                  : 'text-slate-600'
              }
            >
              {overdueCases.length > 0
                ? `${overdueCases.length} overdue SLA`
                : 'Zero SLA breaches'}
            </span>
            <button
              type="button"
              onClick={() => onNavigate('escalations')}
              className="font-semibold text-[#00828C] hover:text-[#061B3A] inline-flex items-center gap-0.5 cursor-pointer"
            >
              Escalations
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Upcoming Weekly Appointments Strip */}
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
          <div>
            <h2 className="font-display text-sm font-bold text-[#061B3A]">
              This Week&apos;s Scheduled Appointments &amp; Evaluation Windows
            </h2>
            <p className="text-xs text-slate-500">
              Click any scheduled referral to view its progress tracker or confirm attendance
            </p>
          </div>
          <span className="font-mono text-xs tabular-nums text-slate-500">
            {upcomingCount} scheduled
          </span>
        </div>

        {upcomingCount === 0 ? (
          <p className="py-3 text-xs text-slate-500">
            No upcoming referral appointments scheduled in the next 7 days.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {upcomingAppointments.slice(0, 4).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectCase(item)}
                className="w-full py-2.5 flex flex-wrap items-center justify-between gap-3 text-left hover:bg-slate-50/80 px-2 -mx-2 rounded-lg transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono text-xs font-semibold text-[#00828C] tabular-nums shrink-0">
                    {item.dueDate}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#061B3A] truncate">
                      {item.patientName}{' '}
                      <span className="font-mono font-normal text-slate-500">
                        ({item.id})
                      </span>
                    </p>
                    <p className="text-[11px] text-slate-500 truncate">
                      {item.pathway} · {item.receivingFacility}
                    </p>
                  </div>
                </div>

                <span
                  className={`text-xs font-semibold shrink-0 ${
                    item.milestones.facilityAcknowledgedAt
                      ? 'text-emerald-700'
                      : 'text-amber-700'
                  }`}
                >
                  {item.milestones.facilityAcknowledgedAt
                    ? 'Slot Confirmed'
                    : 'Awaiting Facility Ack'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
