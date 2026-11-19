import { ArrowRight } from 'lucide-react';
import { KENYA_CORRIDORS, PATHWAY_OPTIONS } from '../data/pathoraData';
import { Badge } from './ui';

interface EcosystemMapSectionProps {
  onOpenDiscovery: (defaultPathway?: string) => void;
}

export function EcosystemMapSection({ onOpenDiscovery }: EcosystemMapSectionProps) {
  const cities = KENYA_CORRIDORS.map((c) => c.city).join(', ');

  return (
    <section id="ecosystem" className="py-16 sm:py-20 bg-surface border-y border-line scroll-mt-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-10">
        <div className="max-w-2xl space-y-3">
          <h2 className="text-3xl font-semibold tracking-tight text-ink">Built for Kenya’s referral networks</h2>
          <p className="text-ink-2 leading-relaxed">
            Linking screening programmes with public, faith-based and private hospitals, with referral corridors in{' '}
            {cities}.
          </p>
        </div>

        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-line border border-line rounded-xl overflow-hidden">
          {PATHWAY_OPTIONS.map((pathway) => {
            const pilotReady = pathway.tier === 'Priority 90-Day Pilot';
            return (
              <li key={pathway.id}>
                <button
                  type="button"
                  onClick={() => onOpenDiscovery(pathway.name)}
                  className="group w-full h-full bg-surface hover:bg-subtle p-5 text-left flex flex-col gap-3 cursor-pointer transition-colors"
                >
                  <Badge tone={pilotReady ? 'brand' : 'neutral'} className="self-start">
                    {pilotReady ? 'Pilot-ready' : pathway.tier}
                  </Badge>
                  <span className="text-[15px] font-semibold text-ink">{pathway.name}</span>
                  <span className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-brand">
                    Plan this pathway
                    <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
