import { ReferralCase } from '../../data/dashboardData';
import { ReferralProgressTracker } from './ReferralProgressTracker';
import { DashboardSummary, UpcomingAppointments } from './DashboardSummary';
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, StatusBadge, table } from '../ui';

interface OverviewViewProps {
  cases: ReferralCase[];
  onSelectCase: (c: ReferralCase) => void;
  onNavigate: (tab: 'cases' | 'facilities' | 'escalations') => void;
}

const FUNNEL_ORDER: Array<{ label: string; stages: ReferralCase['stage'][] }> = [
  { label: 'Intake & assigned', stages: ['Intake', 'Assigned', 'Contacted', 'Handoff Sent', 'Acknowledged', 'Attended', 'Escalated', 'Closed'] },
  { label: 'Handoff sent', stages: ['Handoff Sent', 'Acknowledged', 'Attended', 'Escalated', 'Closed'] },
  { label: 'Facility acknowledged', stages: ['Acknowledged', 'Attended', 'Closed'] },
  { label: 'Patient attended', stages: ['Attended', 'Closed'] },
  { label: 'Outcome verified', stages: ['Closed'] },
];

export function OverviewView({ cases, onSelectCase, onNavigate }: OverviewViewProps) {
  const totalCases = cases.length;
  const priorityCases = cases.filter((c) => c.status === 'Overdue SLA' || c.status === 'Awaiting Ack' || c.redFlag);

  return (
    <div>
      <PageHeader title="Overview" description="Where every open referral stands today." />

      <div className="space-y-5">
        <DashboardSummary cases={cases} onNavigate={onNavigate} onSelectCase={onSelectCase} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
          <Card className="lg:col-span-2 overflow-hidden">
            <CardHeader
              title="Needs attention"
              description="Overdue, unacknowledged and red-flag referrals"
              action={
                <Button variant="ghost" size="sm" onClick={() => onNavigate('escalations')}>
                  View escalations
                </Button>
              }
            />
            {priorityCases.length === 0 ? (
              <EmptyState title="All clear" description="No referrals need attention right now." />
            ) : (
              <div className={table.wrap}>
                <table className={table.table}>
                  <thead className={table.thead}>
                    <tr>
                      <th className={table.th}>Patient</th>
                      <th className={table.th}>Owner</th>
                      <th className={table.th}>Progress</th>
                      <th className={table.th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {priorityCases.map((item) => (
                      <tr
                        key={item.id}
                        onClick={() => onSelectCase(item)}
                        onKeyDown={(e) => e.key === 'Enter' && onSelectCase(item)}
                        tabIndex={0}
                        className={`${table.tr} cursor-pointer`}
                      >
                        <td className={table.td}>
                          <div className="flex items-center gap-2">
                            <span className="font-medium whitespace-nowrap">{item.patientName}</span>
                            {item.redFlag && <Badge tone="danger">Red flag</Badge>}
                          </div>
                          <div className="text-xs text-ink-3 whitespace-nowrap">
                            <span className="font-mono">{item.id}</span> · {item.pathway}
                          </div>
                        </td>
                        <td className={`${table.td} text-ink-2 whitespace-nowrap`}>{item.coordinator}</td>
                        <td className={table.td}>
                          <ReferralProgressTracker referral={item} variant="compact" />
                        </td>
                        <td className={table.td}>
                          <StatusBadge status={item.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="space-y-5">
            <UpcomingAppointments cases={cases} onSelectCase={onSelectCase} />

            <Card>
              <CardHeader title="Referral funnel" description="Share of all referrals reaching each step" />
              <ul className="px-5 pb-5 space-y-3">
                {FUNNEL_ORDER.map((step) => {
                  const count = cases.filter((c) => step.stages.includes(c.stage)).length;
                  const pct = totalCases > 0 ? Math.round((count / totalCases) * 100) : 0;
                  return (
                    <li key={step.label} className="space-y-1">
                      <div className="flex items-center justify-between text-[13px]">
                        <span className="text-ink-2">{step.label}</span>
                        <span className="tabular-nums text-ink">
                          {count} <span className="text-ink-3">· {pct}%</span>
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-subtle overflow-hidden">
                        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
