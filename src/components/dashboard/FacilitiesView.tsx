import { FacilityPartner, ReferralCase } from '../../data/dashboardData';
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, cn, table } from '../ui';

interface FacilitiesViewProps {
  facilities: FacilityPartner[];
  cases: ReferralCase[];
  onAcknowledgeCase: (caseId: string) => void;
  onConfirmAttendance: (caseId: string) => void;
  onSelectCase: (c: ReferralCase) => void;
}

export function FacilitiesView({
  facilities,
  cases,
  onAcknowledgeCase,
  onConfirmAttendance,
  onSelectCase,
}: FacilitiesViewProps) {
  const incomingQueue = cases.filter((c) => c.status !== 'Closed Verified');

  return (
    <div>
      <PageHeader
        title="Facility desk"
        description="Receiving facilities acknowledge referrals, confirm attendance and return outcomes here."
      />

      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {facilities.map((facility) => {
            const atSite = cases.filter((c) => c.receivingFacility === facility.name);
            const active = atSite.filter((c) => c.status !== 'Closed Verified').length;
            const closed = atSite.length - active;
            return (
              <Card key={facility.id} className="p-4 flex flex-col gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-medium text-ink leading-5">{facility.name}</h3>
                  <p className="text-xs text-ink-3 mt-0.5">
                    {facility.type} · {facility.city}
                  </p>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-[13px] mt-auto">
                  <div>
                    <dt className="text-ink-3 text-xs">Avg. ack time</dt>
                    <dd className="text-ink font-medium tabular-nums">{facility.avgAckHours}h</dd>
                  </div>
                  <div>
                    <dt className="text-ink-3 text-xs">Open / closed</dt>
                    <dd className="text-ink font-medium tabular-nums">
                      {active} / {closed}
                    </dd>
                  </div>
                </dl>
                <div className="pt-3 border-t border-line flex items-center justify-between gap-2 text-xs">
                  <span className="text-ink-2 truncate" title={facility.focalPerson}>
                    {facility.focalPerson}
                  </span>
                  <Badge>{facility.interopMethod}</Badge>
                </div>
              </Card>
            );
          })}
        </div>

        <Card className="overflow-hidden">
          <CardHeader
            title="Open handoffs"
            description={`${incomingQueue.length} referrals waiting on a facility action`}
          />
          {incomingQueue.length === 0 ? (
            <EmptyState title="No open handoffs" description="Every referral has a verified outcome." />
          ) : (
            <div className={cn(table.wrap, 'border-t border-line')}>
              <table className={table.table}>
                <thead className={table.thead}>
                  <tr>
                    <th className={table.th}>Patient</th>
                    <th className={table.th}>Facility</th>
                    <th className={table.th}>Acknowledged</th>
                    <th className={table.th}>Attendance</th>
                    <th className={cn(table.th, 'text-right')}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {incomingQueue.map((item) => {
                    const isAcked = Boolean(item.milestones.facilityAcknowledgedAt);
                    const isAttended = Boolean(item.milestones.patientAttendedAt);
                    return (
                      <tr key={item.id} className={table.tr}>
                        <td className={table.td}>
                          <button
                            type="button"
                            onClick={() => onSelectCase(item)}
                            className="text-left cursor-pointer group"
                          >
                            <span className="block font-medium whitespace-nowrap group-hover:text-brand">
                              {item.patientName}
                            </span>
                            <span className="block text-xs text-ink-3 whitespace-nowrap">
                              <span className="font-mono">{item.id}</span> · {item.pathway}
                            </span>
                          </button>
                        </td>
                        <td className={cn(table.td, 'text-ink-2')}>
                          <span className="block max-w-[220px] truncate" title={item.receivingFacility}>
                            {item.receivingFacility}
                          </span>
                        </td>
                        <td className={table.td}>
                          {isAcked ? (
                            <Badge tone="success" dot>
                              Acknowledged
                            </Badge>
                          ) : (
                            <Badge tone="warning" dot>
                              Pending
                            </Badge>
                          )}
                        </td>
                        <td className={table.td}>
                          {isAttended ? (
                            <Badge tone="success" dot>
                              Attended
                            </Badge>
                          ) : (
                            <span className="text-[13px] text-ink-3 whitespace-nowrap">Awaiting visit</span>
                          )}
                        </td>
                        <td className={cn(table.td, 'text-right whitespace-nowrap')}>
                          {!isAcked && (
                            <Button variant="secondary" size="sm" onClick={() => onAcknowledgeCase(item.id)}>
                              Acknowledge
                            </Button>
                          )}
                          {isAcked && !isAttended && (
                            <Button variant="secondary" size="sm" onClick={() => onConfirmAttendance(item.id)}>
                              Confirm attendance
                            </Button>
                          )}
                          {isAcked && isAttended && (
                            <Button variant="ghost" size="sm" onClick={() => onSelectCase(item)}>
                              Document outcome
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
