import { useState } from 'react';
import { ReferralCase } from '../../data/dashboardData';
import { Badge, Button, Card, EmptyState, PageHeader, Select, StatusBadge, cn } from '../ui';

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
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [selectedBarrier, setSelectedBarrier] = useState<string>(BARRIER_OPTIONS[0]);

  const queue = cases
    .filter(
      (c) =>
        c.status !== 'Closed Verified' &&
        (c.status === 'Overdue SLA' || c.stage === 'Escalated' || c.redFlag || c.slaHoursRemaining <= 12)
    )
    .sort((a, b) => a.slaHoursRemaining - b.slaHoursRemaining);

  const breachedCount = queue.filter((c) => c.slaHoursRemaining < 0 || c.status === 'Overdue SLA').length;

  return (
    <div>
      <PageHeader
        title="Escalations"
        description="Referrals past or near their SLA, red-flag cases, and patients who need human follow-up."
      />

      {queue.length === 0 ? (
        <Card>
          <EmptyState
            title="No SLA breaches"
            description="Every open referral is within its partner-approved deadline."
          />
        </Card>
      ) : (
        <Card>
          <div className="px-5 py-3 border-b border-line flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-2">
            <span>
              <span className="font-medium text-ink tabular-nums">{queue.length}</span> in queue
            </span>
            <span>
              <span className="font-medium text-danger tabular-nums">{breachedCount}</span> past SLA
            </span>
          </div>

          <ul className="divide-y divide-line">
            {queue.map((c) => {
              const breached = c.slaHoursRemaining < 0 || c.status === 'Overdue SLA';
              const isResolving = resolvingId === c.id;
              return (
                <li key={c.id} className="px-5 py-4">
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onSelectCase(c)}
                          className="text-sm font-medium text-ink hover:text-brand hover:underline underline-offset-2 cursor-pointer"
                        >
                          {c.patientName}
                        </button>
                        <span className="font-mono text-xs text-ink-3">{c.id}</span>
                        <StatusBadge status={c.status} />
                        {c.redFlag && <Badge tone="danger">Red flag</Badge>}
                      </div>
                      <p className="text-[13px] text-ink-2 leading-relaxed">{c.notes}</p>
                      <p className="text-xs text-ink-3">
                        {c.pathway} · {c.coordinator} · {c.receivingFacility}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span
                        className={cn(
                          'text-[13px] tabular-nums whitespace-nowrap',
                          breached ? 'text-danger font-medium' : 'text-ink-2'
                        )}
                      >
                        {c.slaHoursRemaining < 0
                          ? `${Math.abs(c.slaHoursRemaining)}h overdue`
                          : `${c.slaHoursRemaining}h left`}
                      </span>
                      {c.stage !== 'Escalated' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            onEscalateToClinicalLead(c.id, 'Escalated to Partner Clinical Lead due to SLA window')
                          }
                        >
                          Escalate
                        </Button>
                      )}
                      <Button
                        variant={isResolving ? 'ghost' : 'secondary'}
                        size="sm"
                        onClick={() => {
                          setResolvingId(isResolving ? null : c.id);
                          setSelectedBarrier(BARRIER_OPTIONS[0]);
                        }}
                      >
                        {isResolving ? 'Cancel' : 'Log resolution'}
                      </Button>
                    </div>
                  </div>

                  {isResolving && (
                    <form
                      className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2 rounded-md bg-subtle p-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        onLogBarrierResolution(c.id, selectedBarrier);
                        setResolvingId(null);
                      }}
                    >
                      <label htmlFor={`barrier-${c.id}`} className="text-[13px] text-ink-2 whitespace-nowrap">
                        Resolution
                      </label>
                      <Select
                        id={`barrier-${c.id}`}
                        value={selectedBarrier}
                        onChange={(e) => setSelectedBarrier(e.target.value)}
                        className="h-8 sm:max-w-sm"
                      >
                        {BARRIER_OPTIONS.map((b) => (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        ))}
                      </Select>
                      <Button type="submit" size="sm">
                        Save resolution
                      </Button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
