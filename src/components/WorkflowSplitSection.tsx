import { ArrowLeftRight, BellRing, CheckSquare, UserCheck } from 'lucide-react';
import { CORE_PILLARS } from '../data/pathoraData';

const PILLAR_ICONS = {
  ownership: UserCheck,
  sla: BellRing,
  verification: CheckSquare,
  interoperability: ArrowLeftRight,
} as const;

export function WorkflowSplitSection() {
  return (
    <section id="workflow" className="py-16 sm:py-20 scroll-mt-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-10">
        <div className="max-w-2xl space-y-3">
          <h2 className="text-3xl font-semibold tracking-tight text-ink">How Pathora closes the loop</h2>
          <p className="text-ink-2 leading-relaxed">
            Every referral stays owned, timed and verified until care is confirmed.
          </p>
        </div>

        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {CORE_PILLARS.map((pillar) => {
            const Icon = PILLAR_ICONS[pillar.id as keyof typeof PILLAR_ICONS];
            return (
              <li key={pillar.id} className="space-y-3">
                <span className="size-9 rounded-md bg-brand-soft text-brand flex items-center justify-center">
                  <Icon className="size-[18px]" />
                </span>
                <h3 className="text-[15px] font-semibold text-ink">{pillar.title}</h3>
                <p className="text-sm text-ink-2 leading-relaxed">{pillar.description}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
