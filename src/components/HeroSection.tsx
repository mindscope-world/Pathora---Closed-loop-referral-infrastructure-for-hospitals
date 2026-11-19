import { ArrowRight, Check } from 'lucide-react';
import { Badge, Button, Card, cn } from './ui';

interface HeroSectionProps {
  onOpenDiscovery: (defaultPathway?: string) => void;
  onOpenSignup: () => void;
}

const SAMPLE_STEPS = [
  { label: 'Positive screen logged', meta: 'Nairobi mobile screening', time: '17 Nov, 09:15', done: true },
  { label: 'Assigned to Miriam W.', meta: 'Programme coordinator', time: '17 Nov, 09:20', done: true },
  { label: 'Facility acknowledged', meta: 'Kenyatta referral desk', time: '17 Nov, 16:40', done: true },
  { label: 'Patient attends', meta: 'Colposcopy appointment', time: 'Due in 18h', done: false },
  { label: 'Outcome documented', meta: 'Closes the referral', time: '—', done: false },
];

export function HeroSection({ onOpenDiscovery, onOpenSignup }: HeroSectionProps) {
  return (
    <section className="border-b border-line bg-surface">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20 grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
        <div className="lg:col-span-6 space-y-7">
          <p className="text-sm font-medium text-brand">Closed-loop referrals for screening programmes</p>
          <h1 className="text-4xl sm:text-5xl lg:text-[56px] lg:leading-[1.05] font-semibold tracking-tight text-ink">
            Every positive screen, followed through to care.
          </h1>
          <p className="text-lg text-ink-2 leading-relaxed max-w-xl">
            Pathora gives screening teams and receiving hospitals one shared record of each referral, from handoff
            to documented clinical outcome. Nothing closes until care is confirmed.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={() => onOpenDiscovery()}>
              Book a walkthrough
              <ArrowRight />
            </Button>
            <Button size="lg" variant="secondary" onClick={onOpenSignup}>
              Create an account
            </Button>
          </div>
          <p className="text-sm text-ink-3">Works alongside your existing EMR. Aligned with Kenya’s Data Protection Act.</p>
        </div>

        <div className="lg:col-span-6">
          <Card className="shadow-overlay overflow-hidden">
            <div className="px-5 py-4 border-b border-line flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-ink-3 font-mono">REF-2026-0418</p>
                <p className="text-[15px] font-semibold text-ink truncate">Cancer screening referral</p>
              </div>
              <Badge tone="info" dot>
                On track
              </Badge>
            </div>
            <ol className="px-5 py-4 space-y-0">
              {SAMPLE_STEPS.map((step, i) => {
                const isNext = !step.done && SAMPLE_STEPS[i - 1]?.done;
                return (
                  <li key={step.label} className="relative flex gap-3 pb-4 last:pb-0">
                    {i < SAMPLE_STEPS.length - 1 && (
                      <span
                        aria-hidden="true"
                        className={cn('absolute left-[9px] top-6 bottom-0 w-px', step.done ? 'bg-brand' : 'bg-line')}
                      />
                    )}
                    <span
                      aria-hidden="true"
                      className={cn(
                        'relative mt-0.5 size-5 shrink-0 rounded-full border flex items-center justify-center',
                        step.done
                          ? 'bg-brand border-brand text-white'
                          : isNext
                            ? 'bg-surface border-brand'
                            : 'bg-surface border-line-strong'
                      )}
                    >
                      {step.done && <Check className="size-3" strokeWidth={3} />}
                      {isNext && <span className="size-2 rounded-full bg-brand" />}
                    </span>
                    <div className="flex-1 min-w-0 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className={cn('text-sm font-medium', step.done || isNext ? 'text-ink' : 'text-ink-3')}>
                          {step.label}
                        </p>
                        <p className="text-xs text-ink-3">{step.meta}</p>
                      </div>
                      <span
                        className={cn(
                          'text-xs tabular-nums whitespace-nowrap',
                          isNext ? 'text-warning font-medium' : 'text-ink-3'
                        )}
                      >
                        {step.time}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>
      </div>
    </section>
  );
}
