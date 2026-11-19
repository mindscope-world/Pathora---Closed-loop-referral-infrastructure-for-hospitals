import { PILOT_PHASES } from '../data/pathoraData';
import { Button } from './ui';

interface PilotBlueprintSectionProps {
  onOpenDiscovery: (defaultPathway?: string) => void;
}

export function PilotBlueprintSection({ onOpenDiscovery }: PilotBlueprintSectionProps) {
  return (
    <section id="pilot-plan" className="py-16 sm:py-20 scroll-mt-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-10">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl space-y-3">
            <h2 className="text-3xl font-semibold tracking-tight text-ink">A 90-day pilot with a safety gate</h2>
            <p className="text-ink-2 leading-relaxed">
              One pathway, one receiving facility, measured against your own baseline. Live patients join only after
              every go-live check passes.
            </p>
          </div>
          <Button variant="secondary" onClick={() => onOpenDiscovery()}>
            Discuss a pilot
          </Button>
        </div>

        <ol className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {PILOT_PHASES.map((phase) => (
            <li key={phase.step} className="border-t-2 border-brand pt-4 space-y-1.5">
              <p className="text-xs font-medium text-brand tabular-nums">{phase.weeks}</p>
              <h3 className="text-[17px] font-semibold text-ink">{phase.title}</h3>
              <p className="text-sm text-ink-2 leading-relaxed">{phase.summary}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
