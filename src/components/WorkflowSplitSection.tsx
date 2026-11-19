import { ArrowLeftRight, BellRing, CheckSquare, UserCheck } from 'lucide-react';
import { CORE_PILLARS, WORKFLOW_STAGES } from '../data/pathoraData';
import { Card } from './ui';

const PILLAR_ICONS = {
  ownership: UserCheck,
  sla: BellRing,
  verification: CheckSquare,
  interoperability: ArrowLeftRight,
} as const;

export function WorkflowSplitSection() {
  return (
    <section id="workflow" className="py-16 sm:py-20 scroll-mt-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16">
        <div className="lg:col-span-5 space-y-8">
          <div className="space-y-3">
            <h2 className="text-3xl font-semibold tracking-tight text-ink">How Pathora closes the loop</h2>
            <p className="text-ink-2 leading-relaxed">
              Referrals usually disappear once they leave the screening site. Pathora keeps each one owned, timed and
              verified until care is confirmed.
            </p>
          </div>

          <ul className="space-y-5">
            {CORE_PILLARS.map((pillar) => {
              const Icon = PILLAR_ICONS[pillar.id as keyof typeof PILLAR_ICONS];
              return (
                <li key={pillar.id} className="flex gap-4">
                  <span className="size-9 shrink-0 rounded-md bg-brand-soft text-brand flex items-center justify-center">
                    <Icon className="size-[18px]" />
                  </span>
                  <div className="space-y-1">
                    <h3 className="text-[15px] font-semibold text-ink">{pillar.title}</h3>
                    <p className="text-sm text-ink-2 leading-relaxed">{pillar.description}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="lg:col-span-7">
          <Card>
            <div className="px-5 py-4 border-b border-line flex items-baseline justify-between gap-4">
              <h3 className="text-[15px] font-semibold text-ink">The seven tracked stages</h3>
              <span className="text-xs text-ink-3">Target time from screen</span>
            </div>
            <ol>
              {WORKFLOW_STAGES.map((stage) => (
                <li
                  key={stage.id}
                  className="px-5 py-3.5 border-b border-line last:border-0 grid grid-cols-[28px_1fr_auto] gap-x-3 items-start"
                >
                  <span className="text-sm tabular-nums text-ink-3 pt-px">{String(stage.id).padStart(2, '0')}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{stage.title}</p>
                    <p className="text-[13px] text-ink-3 leading-relaxed">{stage.evidence}</p>
                  </div>
                  <span className="text-xs tabular-nums text-ink-2 whitespace-nowrap pt-0.5">{stage.slaWindow}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </section>
  );
}
