import { Check } from 'lucide-react';
import { ReferralCase } from '../../data/dashboardData';
import { cn } from '../ui';

export interface JourneyStep {
  key: 'screened' | 'referred' | 'scheduled' | 'completed';
  label: string;
  shortLabel: string;
  state: 'completed' | 'current' | 'attention' | 'pending';
  timestamp?: string;
  detail: string;
}

export function deriveReferralJourney(item: ReferralCase): {
  steps: JourneyStep[];
  completedCount: number;
  currentStageLabel: string;
} {
  const isClosed = item.status === 'Closed Verified' || item.stage === 'Closed';
  const hasAttended = Boolean(item.milestones.patientAttendedAt);
  const hasScheduled =
    Boolean(item.milestones.facilityAcknowledgedAt) ||
    item.stage === 'Acknowledged' ||
    item.stage === 'Attended' ||
    isClosed;
  const hasReferred = Boolean(item.milestones.referralIssuedAt);
  const isEscalatedOrOverdue = !isClosed && (item.status === 'Overdue SLA' || item.stage === 'Escalated');

  const steps: JourneyStep[] = [
    {
      key: 'screened',
      label: 'Screened',
      shortLabel: 'Screened',
      state: 'completed',
      timestamp: item.createdAt,
      detail: item.sourceProgram,
    },
    {
      key: 'referred',
      label: 'Referred',
      shortLabel: 'Referred',
      state: hasReferred ? 'completed' : 'current',
      timestamp: item.milestones.referralIssuedAt,
      detail: `Assigned to ${item.coordinator}`,
    },
    {
      key: 'scheduled',
      label: 'Appointment scheduled',
      shortLabel: 'Scheduled',
      state: hasScheduled ? 'completed' : isEscalatedOrOverdue ? 'attention' : hasReferred ? 'current' : 'pending',
      timestamp: item.milestones.facilityAcknowledgedAt,
      detail: hasScheduled
        ? `Confirmed at ${item.receivingFacility}`
        : isEscalatedOrOverdue
          ? 'Facility acknowledgment overdue'
          : 'Awaiting facility confirmation',
    },
    {
      key: 'completed',
      label: 'Care completed',
      shortLabel: 'Care done',
      state: isClosed
        ? 'completed'
        : isEscalatedOrOverdue && hasScheduled
          ? 'attention'
          : hasAttended || hasScheduled
            ? 'current'
            : 'pending',
      timestamp: item.milestones.outcomeDocumentedAt ?? item.milestones.patientAttendedAt,
      detail: isClosed
        ? item.closureReason || 'Clinical outcome documented'
        : hasAttended
          ? 'Attended · awaiting outcome record'
          : 'Pending evaluation & outcome',
    },
  ];

  const completedCount = steps.filter((s) => s.state === 'completed').length;
  const activeStep =
    steps.find((s) => s.state === 'attention') ?? steps.find((s) => s.state === 'current') ?? steps[steps.length - 1];

  return { steps, completedCount, currentStageLabel: activeStep.label };
}

interface ReferralProgressTrackerProps {
  referral: ReferralCase;
  variant?: 'full' | 'compact';
}

const SEGMENT: Record<JourneyStep['state'], string> = {
  completed: 'bg-brand',
  current: 'bg-brand/35',
  attention: 'bg-danger',
  pending: 'bg-line',
};

export function ReferralProgressTracker({ referral, variant = 'full' }: ReferralProgressTrackerProps) {
  const { steps, completedCount, currentStageLabel } = deriveReferralJourney(referral);
  const done = completedCount === steps.length;
  const attention = steps.some((s) => s.state === 'attention');
  const label = done ? 'Care completed' : currentStageLabel;

  if (variant === 'compact') {
    return (
      <div className="relative w-[168px] space-y-1.5" title={steps.map((s) => `${s.label}: ${s.detail}`).join('\n')}>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className={cn('truncate', attention ? 'text-danger font-medium' : 'text-ink-2')}>{label}</span>
          <span className="tabular-nums text-ink-3 shrink-0">{completedCount}/4</span>
        </div>
        <div className="grid grid-cols-4 gap-1" aria-hidden="true">
          {steps.map((s) => (
            <span key={s.key} className={cn('h-1.5 rounded-full', done ? 'bg-success' : SEGMENT[s.state])} />
          ))}
        </div>
        <span className="sr-only">
          {label}, {completedCount} of 4 steps complete
        </span>
      </div>
    );
  }

  return (
    <ol className="grid grid-cols-1 sm:grid-cols-4 gap-4 sm:gap-3" aria-label={`${completedCount} of 4 steps complete`}>
      {steps.map((step, index) => {
        const isDone = step.state === 'completed';
        return (
          <li key={step.key} className="space-y-2">
            <div
              className={cn(
                'h-1 rounded-full',
                isDone ? (done ? 'bg-success' : 'bg-brand') : step.state === 'attention' ? 'bg-danger' : step.state === 'current' ? 'bg-brand/35' : 'bg-line'
              )}
              aria-hidden="true"
            />
            <div className="flex items-start gap-2">
              <span
                className={cn(
                  'mt-0.5 size-5 shrink-0 rounded-full border flex items-center justify-center text-[11px] font-medium',
                  isDone
                    ? 'bg-brand border-brand text-white'
                    : step.state === 'attention'
                      ? 'border-danger text-danger'
                      : step.state === 'current'
                        ? 'border-brand text-brand'
                        : 'border-line-strong text-ink-3'
                )}
                aria-hidden="true"
              >
                {isDone ? <Check className="size-3" strokeWidth={3} /> : index + 1}
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink leading-5">{step.label}</p>
                <p className={cn('text-xs', step.state === 'attention' ? 'text-danger' : 'text-ink-3')}>
                  {step.timestamp ?? step.detail}
                </p>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
