import { ArrowRight } from 'lucide-react';
import { KENYA_CORRIDORS, PATHWAY_OPTIONS } from '../data/pathoraData';
import { Badge, Card } from './ui';

interface EcosystemMapSectionProps {
  onOpenDiscovery: (defaultPathway?: string) => void;
}

const TIER_TONE: Record<string, 'brand' | 'neutral'> = {
  'Priority 90-Day Pilot': 'brand',
};

export function EcosystemMapSection({ onOpenDiscovery }: EcosystemMapSectionProps) {
  return (
    <section id="ecosystem" className="py-16 sm:py-20 bg-surface border-y border-line scroll-mt-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-10">
        <div className="max-w-2xl space-y-3">
          <h2 className="text-3xl font-semibold tracking-tight text-ink">Built for Kenya’s referral networks</h2>
          <p className="text-ink-2 leading-relaxed">
            Connects community health promoters, mobile clinics and NGO programmes with public, faith-based and private
            hospitals — starting with the pathways where follow-up is hardest.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PATHWAY_OPTIONS.map((pathway) => (
            <Card key={pathway.id} className="p-5 flex flex-col gap-3 shadow-none">
              <Badge tone={TIER_TONE[pathway.tier] ?? 'neutral'} className="self-start">
                {pathway.tier.replace('Priority 90-Day Pilot', 'Pilot-ready')}
              </Badge>
              <h3 className="text-[15px] font-semibold text-ink">{pathway.name}</h3>
              <p className="text-sm text-ink-2 leading-relaxed flex-1">{pathway.whyItMatters}</p>
              <button
                type="button"
                onClick={() => onOpenDiscovery(pathway.name)}
                className="self-start inline-flex items-center gap-1 text-sm font-medium text-brand hover:text-brand-hover cursor-pointer"
              >
                Plan this pathway
                <ArrowRight className="size-3.5" />
              </button>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-ink-3">
          <span className="text-ink-2 font-medium">Referral corridors in design:</span>
          {KENYA_CORRIDORS.map((c) => (
            <span key={c.id}>{c.city}</span>
          ))}
        </div>
      </div>
    </section>
  );
}
