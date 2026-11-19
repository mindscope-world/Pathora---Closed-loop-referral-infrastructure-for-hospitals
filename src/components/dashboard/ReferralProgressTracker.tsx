import {
  CheckCircle2,
  CalendarCheck2,
  ClipboardCheck,
  Send,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import { ReferralCase } from '../../data/dashboardData';

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
  const hasScheduled = Boolean(item.milestones.facilityAcknowledgedAt) || item.stage === 'Acknowledged' || item.stage === 'Attended' || isClosed;
  const hasReferred = Boolean(item.milestones.referralIssuedAt);
  const isEscalatedOrOverdue =
    !isClosed && (item.status === 'Overdue SLA' || item.stage === 'Escalated');

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
      label: 'Appointment Scheduled',
      shortLabel: 'Scheduled',
      state: hasScheduled
        ? 'completed'
        : isEscalatedOrOverdue
        ? 'attention'
        : hasReferred
        ? 'current'
        : 'pending',
      timestamp: item.milestones.facilityAcknowledgedAt,
      detail: hasScheduled
        ? `Confirmed at ${item.receivingFacility}`
        : isEscalatedOrOverdue
        ? 'Overdue facility acknowledgment'
        : 'Awaiting facility slot confirmation',
    },
    {
      key: 'completed',
      label: 'Care Completed',
      shortLabel: 'Care Done',
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
        ? 'Patient attended · Awaiting outcome record'
        : 'Pending clinical evaluation & outcome',
    },
  ];

  const completedCount = steps.filter((s) => s.state === 'completed').length;
  const activeStep =
    steps.find((s) => s.state === 'attention') ??
    steps.find((s) => s.state === 'current') ??
    steps[steps.length - 1];

  return {
    steps,
    completedCount,
    currentStageLabel: activeStep.label,
  };
}

interface ReferralProgressTrackerProps {
  referral: ReferralCase;
  variant?: 'full' | 'compact';
}

const STEP_ICONS = {
  screened: ClipboardCheck,
  referred: Send,
  scheduled: CalendarCheck2,
  completed: CheckCircle2,
};

export function ReferralProgressTracker({
  referral,
  variant = 'full',
}: ReferralProgressTrackerProps) {
  const { steps, completedCount, currentStageLabel } = deriveReferralJourney(referral);

  if (variant === 'compact') {
    const progressPct = Math.round((completedCount / steps.length) * 100);
    const hasAttention = steps.some((s) => s.state === 'attention');

    return (
      <div className="min-w-[200px] max-w-[240px] space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span
            className={`font-semibold truncate ${
              hasAttention
                ? 'text-red-700'
                : completedCount === 4
                ? 'text-emerald-700'
                : 'text-[#061B3A]'
            }`}
          >
            {completedCount === 4 ? 'Care Completed' : currentStageLabel}
          </span>
          <span className="font-mono tabular-nums text-slate-500 shrink-0">
            {completedCount}/4
          </span>
        </div>

        {/* 4 Connected Step Nodes */}
        <div className="relative flex items-center justify-between gap-1">
          <div
            aria-hidden="true"
            className="absolute left-2 right-2 top-1/2 -translate-y-1/2 h-1 bg-slate-200 rounded-full"
          />
          <div
            aria-hidden="true"
            className={`absolute left-2 top-1/2 -translate-y-1/2 h-1 rounded-full transition-all duration-300 ${
              hasAttention
                ? 'bg-red-500'
                : completedCount === 4
                ? 'bg-emerald-600'
                : 'bg-[#008E97]'
            }`}
            style={{ width: `calc(${Math.max(0, progressPct - 12)}% )` }}
          />

          {steps.map((step) => {
            const dotClass =
              step.state === 'completed'
                ? completedCount === 4
                  ? 'bg-emerald-600 border-emerald-600 text-white'
                  : 'bg-[#008E97] border-[#008E97] text-white'
                : step.state === 'attention'
                ? 'bg-red-600 border-red-600 text-white'
                : step.state === 'current'
                ? 'bg-white border-[#008E97] text-[#008E97]'
                : 'bg-white border-slate-300 text-slate-400';

            return (
              <span
                key={step.key}
                title={`${step.label}: ${step.detail}`}
                className={`relative z-10 w-4 h-4 rounded-full border-2 flex items-center justify-center ${dotClass}`}
              >
                {step.state === 'completed' && (
                  <span className="w-1.5 h-1.5 rounded-full bg-white" />
                )}
                {step.state === 'attention' && (
                  <span className="w-1.5 h-1.5 rounded-full bg-white" />
                )}
                {step.state === 'current' && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#008E97]" />
                )}
              </span>
            );
          })}
        </div>

        <div className="grid grid-cols-4 text-[10px] text-slate-400 leading-none">
          {steps.map((step, i) => (
            <span
              key={step.key}
              className={`truncate ${
                i === 0
                  ? 'text-left'
                  : i === steps.length - 1
                  ? 'text-right'
                  : 'text-center'
              } ${
                step.state === 'completed' || step.state === 'current'
                  ? 'text-slate-600 font-medium'
                  : step.state === 'attention'
                  ? 'text-red-700 font-semibold'
                  : ''
              }`}
            >
              {step.shortLabel}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // Full Visual Stepper
  const trackRatio =
    completedCount <= 1 ? 0 : Math.min(100, ((completedCount - 1) / (steps.length - 1)) * 100);
  const hasAttention = steps.some((s) => s.state === 'attention');

  return (
    <div className="bg-[#F8FAFC] border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-[#061B3A]">
            Referral Care Journey
          </p>
          <p className="text-[11px] text-slate-500">
            Visual tracking from initial positive screen to verified clinical outcome
          </p>
        </div>
        <span className="font-mono text-xs font-semibold tabular-nums text-[#00828C]">
          {completedCount} of 4 stages complete
        </span>
      </div>

      {/* Horizontal Connected Stepper */}
      <div className="relative pt-1">
        {/* Background Track */}
        <div
          aria-hidden="true"
          className="hidden sm:block absolute top-5 left-[12.5%] right-[12.5%] h-1 bg-slate-200 rounded-full"
        />
        {/* Active Progress Fill */}
        <div
          aria-hidden="true"
          className={`hidden sm:block absolute top-5 left-[12.5%] h-1 rounded-full transition-all duration-300 ${
            hasAttention
              ? 'bg-amber-500'
              : completedCount === 4
              ? 'bg-emerald-600'
              : 'bg-[#008E97]'
          }`}
          style={{ width: `calc(${trackRatio * 0.75}%)` }}
        />

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 sm:gap-2">
          {steps.map((step, index) => {
            const Icon =
              step.state === 'attention' ? AlertTriangle : STEP_ICONS[step.key];

            const badgeClasses =
              step.state === 'completed'
                ? completedCount === 4
                  ? 'bg-emerald-600 border-emerald-600 text-white'
                  : 'bg-[#008E97] border-[#008E97] text-white'
                : step.state === 'attention'
                ? 'bg-red-600 border-red-600 text-white'
                : step.state === 'current'
                ? 'bg-white border-[#008E97] text-[#008E97] shadow-sm'
                : 'bg-white border-slate-300 text-slate-400';

            const stateLabel =
              step.state === 'completed'
                ? 'Completed'
                : step.state === 'attention'
                ? 'Attention Needed'
                : step.state === 'current'
                ? 'In Progress'
                : 'Pending';

            return (
              <div
                key={step.key}
                className="relative z-10 flex sm:flex-col items-start sm:items-center sm:text-center gap-3 sm:gap-2"
              >
                <div
                  className={`w-9 h-9 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${badgeClasses}`}
                >
                  <Icon className="w-4 h-4" />
                </div>

                <div className="min-w-0 space-y-0.5">
                  <p className="text-xs font-bold text-[#061B3A] leading-tight">
                    <span className="font-mono text-[10px] text-slate-400 mr-1">
                      0{index + 1}.
                    </span>
                    {step.label}
                  </p>
                  <p
                    className={`text-[11px] font-semibold ${
                      step.state === 'completed'
                        ? 'text-emerald-700'
                        : step.state === 'attention'
                        ? 'text-red-700'
                        : step.state === 'current'
                        ? 'text-[#00828C]'
                        : 'text-slate-400'
                    }`}
                  >
                    {stateLabel}
                  </p>
                  <p className="font-mono text-[10px] tabular-nums text-slate-500">
                    {step.timestamp ?? (
                      <span className="inline-flex items-center gap-1 font-sans">
                        <Clock className="w-3 h-3" /> Pending
                      </span>
                    )}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Current Step Context Footer */}
      <div className="pt-2.5 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-slate-600">
          Current Stage:{' '}
          <strong className="text-[#061B3A]">{currentStageLabel}</strong>
        </span>
        <span className="text-slate-500 truncate max-w-xs">
          {steps.find((s) => s.state === 'attention' || s.state === 'current')?.detail ??
            steps[steps.length - 1].detail}
        </span>
      </div>
    </div>
  );
}
