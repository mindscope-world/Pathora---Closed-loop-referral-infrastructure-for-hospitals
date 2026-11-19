import { ArrowUpRight } from 'lucide-react';
import { ReferralCase } from '../../data/dashboardData';
import { Badge, Card, CardHeader, EmptyState, Stat } from '../ui';

interface DashboardSummaryProps {
  cases: ReferralCase[];
  onNavigate: (tab: 'cases' | 'facilities' | 'escalations') => void;
  onSelectCase: (c: ReferralCase) => void;
}

/** Referrals still open whose due date falls in the next 7 days, or that are scheduled but not yet attended. */
export function getUpcomingAppointments(cases: ReferralCase[]): ReferralCase[] {
  return cases
    .filter((c) => {
      if (c.status === 'Closed Verified') return false;
      const dueMs = Date.parse(c.dueDate);
      const refMs = Date.parse('2026-11-19');
      const diffDays = Number.isNaN(dueMs) ? 0 : (dueMs - refMs) / (1000 * 60 * 60 * 24);
      const withinWeek = diffDays >= 0 && diffDays <= 7;
      return withinWeek || Boolean(c.milestones.facilityAcknowledgedAt && !c.milestones.patientAttendedAt);
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

function StatLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="-m-1 p-1 rounded-md text-ink-3 hover:text-brand hover:bg-subtle cursor-pointer"
    >
      <ArrowUpRight className="size-4" />
    </button>
  );
}

/** Row of four KPI tiles at the top of the overview. */
export function DashboardSummary({ cases, onNavigate, onSelectCase }: DashboardSummaryProps) {
  const totalCases = cases.length;
  const activeReferrals = cases.filter((c) => c.status !== 'Closed Verified');
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
  const upcoming = getUpcomingAppointments(cases);
  const completedCases = cases.filter((c) => c.status === 'Closed Verified');
  const overdueCases = cases.filter((c) => c.status === 'Overdue SLA');
  const completionRate = totalCases > 0 ? Math.round((completedCases.length / totalCases) * 100) : 0;

  return (
    <section aria-label="Key figures" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <Stat
        label="Active referrals"
        value={activeReferrals.length}
        hint={`of ${totalCases} total, open until outcome verified`}
        action={<StatLink label="View referrals" onClick={() => onNavigate('cases')} />}
      />
      <Stat
        label="Awaiting outcome"
        value={pendingCareCompletions.length}
        hint={`${attendedAwaitingOutcome} attended, outcome note pending`}
        action={<StatLink label="Open facility desk" onClick={() => onNavigate('facilities')} />}
      />
      <Stat
        label="Due in the next 7 days"
        value={upcoming.length}
        hint={upcoming[0] ? `Next on ${upcoming[0].dueDate}` : 'Nothing scheduled'}
        action={
          <StatLink
            label="Open next appointment"
            onClick={() => (upcoming[0] ? onSelectCase(upcoming[0]) : onNavigate('cases'))}
          />
        }
      />
      <Stat
        label="Verified completion"
        value={`${completionRate}%`}
        tone={overdueCases.length > 0 ? 'neutral' : 'success'}
        hint={
          overdueCases.length > 0 ? (
            <span>
              {completedCases.length} closed · <span className="text-danger">{overdueCases.length} overdue SLA</span>
            </span>
          ) : (
            `${completedCases.length} closed, no SLA breaches`
          )
        }
        action={<StatLink label="View escalations" onClick={() => onNavigate('escalations')} />}
      />
    </section>
  );
}

/** Compact list of the week's appointments and evaluation windows. */
export function UpcomingAppointments({
  cases,
  onSelectCase,
}: {
  cases: ReferralCase[];
  onSelectCase: (c: ReferralCase) => void;
}) {
  const upcoming = getUpcomingAppointments(cases);

  return (
    <Card>
      <CardHeader title="This week" description="Appointments and evaluation windows" />
      {upcoming.length === 0 ? (
        <EmptyState title="Nothing scheduled" description="No appointments in the next 7 days." />
      ) : (
        <ul className="px-2 pb-2">
          {upcoming.slice(0, 5).map((item) => {
            const confirmed = Boolean(item.milestones.facilityAcknowledgedAt);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelectCase(item)}
                  className="w-full px-3 py-2.5 rounded-md flex items-center gap-3 text-left hover:bg-subtle transition-colors cursor-pointer"
                >
                  <span className="w-12 shrink-0 text-center">
                    <span className="block text-[11px] uppercase tracking-wide text-ink-3">
                      {formatMonth(item.dueDate)}
                    </span>
                    <span className="block text-base font-semibold text-ink tabular-nums leading-5">
                      {item.dueDate.slice(8, 10)}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink truncate">{item.patientName}</span>
                    <span className="block text-xs text-ink-3 truncate">{item.receivingFacility}</span>
                  </span>
                  <Badge tone={confirmed ? 'success' : 'warning'}>{confirmed ? 'Confirmed' : 'Awaiting ack'}</Badge>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function formatMonth(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en', { month: 'short' });
}
