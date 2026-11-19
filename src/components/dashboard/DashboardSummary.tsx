import {
  Activity,
  CalendarClock,
  CheckCircle2,
  ClipboardClock,
  AlertTriangle,
  ArrowUpRight,
} from 'lucide-react';
import { ReferralCase } from '../../data/dashboardData';

interface DashboardSummaryProps {
  cases: ReferralCase[];
  onNavigate: (tab: 'cases' | 'facilities' | 'escalations') => void;
  onSelectCase: (c: ReferralCase) => void;
}

export function DashboardSummary({
  cases,
  onNavigate,
  onSelectCase,
}: DashboardSummaryProps) {
  const totalCases = cases.length;

  // 1. Active Referrals (all non-closed cases)
  const activeReferrals = cases.filter((c) => c.status !== 'Closed Verified');

  // 2. Pending Care Completions (active referrals still awaiting final clinical outcome verification)
  const pendingCareCompletions = cases.filter(
    (c) =>
      c.status !== 'Closed Verified' &&
      (Boolean(c.milestones.facilityAcknowledgedAt) ||
        c.stage === 'Attended' ||
        c.stage === 'Acknowledged' ||
        c.status === 'Awaiting Ack' ||
        c.status === 'Overdue SLA')
  );
  const attendedAwaitingOutcome = cases.filter(
    (c) => c.status !== 'Closed Verified' && Boolean(c.milestones.patientAttendedAt)
  ).length;

  // 3. Upcoming Appointments for the Week (active scheduled / due within 7-day window)
  const upcomingAppointments = cases
    .filter((c) => {
      if (c.status === 'Closed Verified') return false;
      const dueMs = Date.parse(c.dueDate);
      const refMs = Date.parse('2026-11-19');
      const diffDays = Number.isNaN(dueMs) ? 0 : (dueMs - refMs) / (1000 * 60 * 60 * 24);
      const withinWeek = diffDays >= 0 && diffDays <= 7;
      return withinWeek || Boolean(c.milestones.facilityAcknowledgedAt && !c.milestones.patientAttendedAt);
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  // 4. Verified Care Completed & Overdue SLA
  const completedCases = cases.filter((c) => c.status === 'Closed Verified');
  const overdueCases = cases.filter((c) => c.status === 'Overdue SLA');
  const completionRate =
    totalCases > 0 ? Math.round((completedCases.length / totalCases) * 100) : 0;

  return (
    <section aria-label="Dashboard aggregate summary" className="space-y-4">
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
                {upcomingAppointments.length}
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
            {upcomingAppointments.length} scheduled
          </span>
        </div>

        {upcomingAppointments.length === 0 ? (
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
