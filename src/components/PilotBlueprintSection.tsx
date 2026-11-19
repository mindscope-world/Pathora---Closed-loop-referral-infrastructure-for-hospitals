import { Check } from 'lucide-react';
import { EVALUATION_METRICS, PILOT_PHASES } from '../data/pathoraData';
import { Button } from './ui';

interface PilotBlueprintSectionProps {
  onOpenDiscovery: (defaultPathway?: string) => void;
}

export function PilotBlueprintSection({ onOpenDiscovery }: PilotBlueprintSectionProps) {
  return (
    <section id="pilot-plan" className="py-16 sm:py-20 scroll-mt-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-12">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl space-y-3">
            <h2 className="text-3xl font-semibold tracking-tight text-ink">A 90-day pilot with a safety gate</h2>
            <p className="text-ink-2 leading-relaxed">
              One programme, one pathway, one receiving facility. Live patients are only enrolled after every go-live
              condition passes.
            </p>
          </div>
          <Button variant="secondary" onClick={() => onOpenDiscovery()}>
            Discuss a pilot
          </Button>
        </div>

        <ol className="grid grid-cols-1 md:grid-cols-3 gap-px bg-line border border-line rounded-xl overflow-hidden">
          {PILOT_PHASES.map((phase) => (
            <li key={phase.step} className="bg-surface p-6 space-y-4">
              <div className="space-y-1">
                <p className="text-xs font-medium text-brand tabular-nums">{phase.weeks}</p>
                <h3 className="text-[17px] font-semibold text-ink">{phase.title}</h3>
              </div>
              <p className="text-sm text-ink-2 leading-relaxed">{phase.summary}</p>
              <ul className="space-y-2 pt-1">
                {phase.deliverables.map((item) => (
                  <li key={item} className="flex gap-2 text-sm text-ink-2">
                    <Check className="size-4 mt-0.5 shrink-0 text-brand" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>

        <div className="space-y-4">
          <h3 className="text-[15px] font-semibold text-ink">Measured against your own baseline</h3>
          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-6">
            {EVALUATION_METRICS.map((metric) => (
              <div key={metric.label} className="border-t border-line pt-4 space-y-1">
                <dt className="text-sm font-medium text-ink">{metric.label}</dt>
                <dd className="text-[13px] text-ink-3 leading-relaxed">{metric.detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
