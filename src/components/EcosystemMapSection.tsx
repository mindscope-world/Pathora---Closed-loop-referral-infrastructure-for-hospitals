import { useState } from 'react';
import { ArrowRight, MapPin } from 'lucide-react';
import { KENYA_CORRIDORS, PATHWAY_OPTIONS, PathwayOption } from '../data/pathoraData';

interface EcosystemMapSectionProps {
  onOpenDiscovery: (defaultPathway?: string) => void;
}

export function EcosystemMapSection({ onOpenDiscovery }: EcosystemMapSectionProps) {
  const [selectedCorridorId, setSelectedCorridorId] = useState<string>('nairobi');
  const [selectedPathwayId, setSelectedPathwayId] = useState<PathwayOption['id']>('cancer');

  const activeCorridor =
    KENYA_CORRIDORS.find((c) => c.id === selectedCorridorId) ?? KENYA_CORRIDORS[0];
  const activePathway =
    PATHWAY_OPTIONS.find((p) => p.id === selectedPathwayId) ?? PATHWAY_OPTIONS[0];

  const leftMetricCards = [
    {
      figure: '7',
      unit: 'Stages',
      title: 'End-to-End Case Visibility',
      text: 'Tracks intake, named ownership, discreet contact, facility handoff, attendance, SLA escalation, and verified closure.',
    },
    {
      figure: '90',
      unit: 'Days',
      title: 'Time-Bounded Pilot Structure',
      text: 'One programme, one clinical pathway, and one referral network evaluated strictly against your own historical baseline.',
    },
    {
      figure: '3',
      unit: 'Phases',
      title: 'Flexible Interoperability',
      text: 'Start immediately with secure CSV import and manual fallbacks, then scale into partner EMR APIs and FHIR-aligned exchange.',
    },
  ];

  return (
    <section id="ecosystem" className="py-14 sm:py-20 bg-white border-y border-slate-200/70">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 space-y-12">
        {/* Top Split: Left 3 Structured Cards + Right Interactive Kenya Referral Network Map */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          {/* Left Column */}
          <div className="lg:col-span-5 space-y-6">
            <div className="space-y-3">
              <h2
                className="font-display font-bold tracking-tight text-[#061B3A] leading-[1.15]"
                style={{ fontSize: 'clamp(1.75rem, 3vw, 2.35rem)', textWrap: 'balance' }}
              >
                Built for Kenya&apos;s screening-to-care ecosystem.
              </h2>
              <p className="text-base text-slate-600 leading-relaxed">
                Pathora bridges community health promoters, mobile clinics, and NGO programmes with public, faith-based, and private receiving hospitals.
              </p>
            </div>

            <div className="space-y-3.5">
              {leftMetricCards.map((card) => (
                <div
                  key={card.title}
                  className="bg-[#F8FAFC] border border-slate-200/90 rounded-2xl p-4 sm:p-5 flex items-start gap-4"
                >
                  <div className="w-16 shrink-0 text-center bg-white border border-slate-200/80 rounded-xl py-2.5 px-2">
                    <span className="block font-display text-2xl font-extrabold text-[#008E97] tabular-nums leading-none">
                      {card.figure}
                    </span>
                    <span className="block text-[11px] font-semibold text-slate-500 mt-1">
                      {card.unit}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-display text-sm sm:text-base font-bold text-[#061B3A]">
                      {card.title}
                    </h3>
                    <p className="text-sm text-slate-600 leading-relaxed mt-1">{card.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right Column: Interactive Regional Map & Stakeholder Corridor Inspector */}
          <div className="lg:col-span-7">
            <div className="relative rounded-[2rem] bg-[#F1F7F9] border border-slate-200/90 p-5 sm:p-8 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div>
                  <p className="text-xs font-semibold text-[#00828C]">
                    Interactive referral network corridors
                  </p>
                  <p className="text-sm font-medium text-[#061B3A]">
                    Select a regional hub to inspect workflow &amp; facility routing
                  </p>
                </div>
                <span className="text-xs text-slate-500">
                  Screening Org ↔ Receiving Facility
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
                {/* Stylized SVG Kenya Map (echoing reference dotted teal map) */}
                <div className="md:col-span-7 relative flex items-center justify-center">
                  <svg
                    viewBox="0 0 380 410"
                    className="w-full max-w-[340px] h-auto drop-shadow-sm"
                    role="img"
                    aria-label="Interactive Kenya healthcare referral corridor map"
                  >
                    <defs>
                      <linearGradient id="kenya-map-fill" x1="40" y1="20" x2="320" y2="390" gradientUnits="userSpaceOnUse">
                        <stop offset="0%" stopColor="#08849C" />
                        <stop offset="100%" stopColor="#00A3AE" />
                      </linearGradient>
                      <pattern id="kenya-dots" width="14" height="14" patternUnits="userSpaceOnUse">
                        <circle cx="2" cy="2" r="1" fill="rgba(255,255,255,0.18)" />
                      </pattern>
                    </defs>

                    {/* Clean Stylized Kenya Boundary Polygon */}
                    <path
                      d="M92 48 L142 36 L195 62 L245 78 L305 76 L318 118 L300 175 L335 232 L322 292 L292 346 L268 372 L245 350 L218 320 L185 302 L145 278 L112 246 L94 218 L92 178 L78 134 L66 84 Z"
                      fill="url(#kenya-map-fill)"
                      stroke="#FFFFFF"
                      strokeWidth="3"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M92 48 L142 36 L195 62 L245 78 L305 76 L318 118 L300 175 L335 232 L322 292 L292 346 L268 372 L245 350 L218 320 L185 302 L145 278 L112 246 L94 218 L92 178 L78 134 L66 84 Z"
                      fill="url(#kenya-dots)"
                    />

                    {/* Connecting Referral Lines */}
                    <g stroke="rgba(255,255,255,0.45)" strokeWidth="1.75" strokeDasharray="4 4">
                      <line x1="204" y1="236" x2="108" y2="202" />
                      <line x1="204" y1="236" x2="132" y2="164" />
                      <line x1="204" y1="236" x2="162" y2="208" />
                      <line x1="204" y1="236" x2="292" y2="332" />
                      <line x1="132" y1="164" x2="162" y2="208" />
                    </g>

                    {/* Interactive Regional Hub Nodes */}
                    {KENYA_CORRIDORS.map((corridor) => {
                      const isSelected = corridor.id === activeCorridor.id;
                      return (
                        <g
                          key={corridor.id}
                          onClick={() => setSelectedCorridorId(corridor.id)}
                          className="cursor-pointer"
                          role="button"
                          tabIndex={0}
                          aria-label={`Select ${corridor.city} referral corridor`}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedCorridorId(corridor.id);
                            }
                          }}
                        >
                          {isSelected && (
                            <circle
                              cx={corridor.x}
                              cy={corridor.y}
                              r="16"
                              fill="rgba(255,255,255,0.28)"
                            />
                          )}
                          <circle
                            cx={corridor.x}
                            cy={corridor.y}
                            r={isSelected ? '8.5' : '6'}
                            fill={isSelected ? '#061B3A' : '#FFFFFF'}
                            stroke="#FFFFFF"
                            strokeWidth="2.5"
                          />
                          <text
                            x={corridor.x + 12}
                            y={corridor.y + 4}
                            fill="#FFFFFF"
                            fontSize="12"
                            fontWeight={isSelected ? '700' : '600'}
                            className="select-none"
                          >
                            {corridor.city}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>

                {/* Selected Corridor Detail Panel */}
                <div className="md:col-span-5 space-y-3">
                  <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm space-y-3.5">
                    <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-[#008E97] shrink-0" />
                        <h3 className="font-display text-base font-bold text-[#061B3A]">
                          {activeCorridor.city} Hub
                        </h3>
                      </div>
                      <span className="text-[11px] font-medium text-slate-500">
                        Corridor Preview
                      </span>
                    </div>

                    <div className="space-y-2.5 text-sm">
                      <div>
                        <p className="text-xs font-semibold text-slate-500">Screening Source</p>
                        <p className="font-medium text-[#061B3A] mt-0.5">
                          {activeCorridor.programType}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-slate-500">Receiving Facilities</p>
                        <p className="text-slate-700 mt-0.5">
                          {activeCorridor.receivingFacility}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-slate-500">Interface Route</p>
                        <p className="text-slate-700 mt-0.5">{activeCorridor.interopMode}</p>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-100">
                      <p className="text-xs font-semibold text-[#00828C]">
                        {activeCorridor.turnaroundTarget}
                      </p>
                    </div>
                  </div>

                  {/* Quick Hub Buttons */}
                  <div className="flex flex-wrap gap-1.5">
                    {KENYA_CORRIDORS.map((corridor) => (
                      <button
                        key={corridor.id}
                        type="button"
                        onClick={() => setSelectedCorridorId(corridor.id)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                          corridor.id === activeCorridor.id
                            ? 'bg-[#061B3A] text-white border-[#061B3A]'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:text-[#061B3A]'
                        }`}
                      >
                        {corridor.city}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Pathway Prioritization Bar: Interactive Rule-Pack Explorer */}
        <div className="bg-[#F8FAFC] border border-slate-200/90 rounded-[1.5rem] p-6 sm:p-8">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-slate-200">
            <div>
              <h3 className="font-display text-xl font-bold text-[#061B3A]">
                Pathway Prioritization &amp; Rule Packs
              </h3>
              <p className="text-sm text-slate-600 mt-1">
                Pathora&apos;s core engine is condition-agnostic. New clinical pathways deploy via partner-approved rule packs rather than custom software rebuilds.
              </p>
            </div>

            <div
              role="tablist"
              aria-label="Clinical pathways"
              className="flex flex-wrap items-center gap-1.5 bg-white p-1.5 rounded-xl border border-slate-200 shrink-0"
            >
              {PATHWAY_OPTIONS.map((pathway) => (
                <button
                  key={pathway.id}
                  type="button"
                  role="tab"
                  aria-selected={pathway.id === activePathway.id}
                  onClick={() => setSelectedPathwayId(pathway.id)}
                  className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                    pathway.id === activePathway.id
                      ? 'bg-[#008E97] text-white shadow-sm'
                      : 'text-slate-600 hover:text-[#061B3A] hover:bg-slate-50'
                  }`}
                >
                  {pathway.name}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 pt-6 items-center">
            <div className="md:col-span-4 space-y-1.5">
              <p className="text-xs font-semibold text-[#00828C]">{activePathway.tier}</p>
              <h4 className="font-display text-xl font-bold text-[#061B3A]">
                {activePathway.name}
              </h4>
              <p className="text-xs text-slate-500">{activePathway.channels}</p>
            </div>

            <div className="md:col-span-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-white border border-slate-200/80 rounded-xl p-4">
                <p className="text-xs font-semibold text-slate-500">Why It Matters</p>
                <p className="text-sm text-slate-700 mt-1 leading-relaxed">
                  {activePathway.whyItMatters}
                </p>
              </div>
              <div className="bg-white border border-slate-200/80 rounded-xl p-4">
                <p className="text-xs font-semibold text-slate-500">Pilot Assessment</p>
                <p className="text-sm text-slate-700 mt-1 leading-relaxed">
                  {activePathway.readiness}
                </p>
              </div>
            </div>

            <div className="md:col-span-3 flex md:justify-end">
              <button
                type="button"
                onClick={() => onOpenDiscovery(activePathway.name)}
                className="w-full md:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-[#061B3A] hover:bg-[#0B2954] rounded-full transition-colors whitespace-nowrap cursor-pointer"
              >
                <span>Scope {activePathway.name.split(' ')[0]} Pilot</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
