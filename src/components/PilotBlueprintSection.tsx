import { useState } from 'react';
import { ShieldAlert, BarChart3, Lock, CheckCircle2 } from 'lucide-react';
import { EVALUATION_METRICS, PILOT_PHASES } from '../data/pathoraData';

interface PilotBlueprintSectionProps {
  onOpenDiscovery: (defaultPathway?: string) => void;
}

export function PilotBlueprintSection({ onOpenDiscovery }: PilotBlueprintSectionProps) {
  const [activeStep, setActiveStep] = useState<number>(1);
  const currentPhase = PILOT_PHASES.find((p) => p.step === activeStep) ?? PILOT_PHASES[0];

  return (
    <section id="pilot-plan" className="py-14 sm:py-20">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
        {/* Large Rounded Dark-Teal Gradient Banner echoing Section 4 of the reference design */}
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#061B3A] via-[#094763] to-[#009CA6] text-white px-6 py-10 sm:px-10 sm:py-14 lg:px-14 shadow-[0_24px_60px_-15px_rgba(6,27,58,0.25)]">
          <div className="max-w-2xl mx-auto text-center space-y-3">
            <p className="text-xs sm:text-sm font-medium text-teal-100/90">
              The 90-day pilot blueprint · One programme, one pathway, one referral network
            </p>
            <h2
              className="font-display font-bold tracking-tight text-white leading-[1.12]"
              style={{ fontSize: 'clamp(1.75rem, 3.2vw, 2.5rem)', textWrap: 'balance' }}
            >
              Launch a measurable 90-day pilot with strict go-live safety gates.
            </h2>
          </div>

          {/* Connected 1-2-3 Interactive Stepper Bar (borrowing reference Section 4 node track) */}
          <div className="mt-10 max-w-4xl mx-auto">
            <div className="relative grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
              {/* Connecting Line on Desktop */}
              <div
                aria-hidden="true"
                className="hidden md:block absolute top-5 left-[16%] right-[16%] h-[2px] bg-white/25"
              />

              {PILOT_PHASES.map((phase) => {
                const isSelected = phase.step === activeStep;
                return (
                  <button
                    key={phase.step}
                    type="button"
                    onClick={() => setActiveStep(phase.step)}
                    className="relative z-10 flex flex-col items-center text-center group cursor-pointer focus-visible:outline-none"
                  >
                    <span
                      className={`w-10 h-10 rounded-full font-display font-bold text-sm tabular-nums flex items-center justify-center transition-colors duration-150 border-2 ${
                        isSelected
                          ? 'bg-white text-[#061B3A] border-white shadow-md'
                          : 'bg-[#061B3A] text-teal-100 border-teal-300/40 group-hover:border-white'
                      }`}
                    >
                      {phase.step}
                    </span>

                    <div
                      className={`mt-3 w-full rounded-xl px-4 py-3 border transition-colors duration-150 ${
                        isSelected
                          ? 'bg-white text-[#061B3A] border-white shadow-md'
                          : 'bg-white/10 text-white border-white/20 hover:bg-white/15'
                      }`}
                    >
                      <span
                        className={`block text-[11px] font-mono tabular-nums ${
                          isSelected ? 'text-[#00828C] font-semibold' : 'text-teal-100'
                        }`}
                      >
                        {phase.weeks}
                      </span>
                      <span className="block font-display text-sm font-bold mt-0.5">
                        {phase.title}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3 Elevated Interface Cards Below the Stepper (matching reference Section 4) */}
          <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">
            {/* Card 1: Active Phase Details */}
            <div className="bg-white text-[#061B3A] rounded-2xl p-6 shadow-lg flex flex-col justify-between space-y-5">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <span className="text-xs font-semibold text-[#00828C]">
                    Phase {currentPhase.step} · {currentPhase.weeks}
                  </span>
                  <span className="font-mono text-xs text-slate-400">Active View</span>
                </div>
                <h3 className="font-display text-lg font-bold text-[#061B3A]">
                  {currentPhase.title}
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  {currentPhase.summary}
                </p>
                <ul className="space-y-2 pt-2">
                  {currentPhase.deliverables.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-slate-700">
                      <CheckCircle2 className="w-4 h-4 text-[#008E97] shrink-0 mt-0.5" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => onOpenDiscovery()}
                  className="text-xs font-semibold text-[#00828C] hover:text-[#061B3A] transition-colors cursor-pointer"
                >
                  Review pilot readiness requirements →
                </button>
              </div>
            </div>

            {/* Card 2: The Go-Live Safety Gate */}
            <div className="bg-white text-[#061B3A] rounded-2xl p-6 shadow-lg flex flex-col justify-between space-y-5">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#061B3A]">
                    <Lock className="w-3.5 h-3.5 text-[#008E97]" />
                    Mandatory Condition
                  </span>
                  <span className="font-mono text-xs text-slate-400">Weeks 6–7</span>
                </div>
                <h3 className="font-display text-lg font-bold text-[#061B3A]">
                  The Go-Live Safety Gate
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  If any safety or operational condition is unmet, the start date moves rather than compressing testing or live evaluation.
                </p>
                <div className="space-y-2.5 pt-1">
                  <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3">
                    <p className="text-xs font-bold text-[#061B3A]">1. Clinical Sign-Off</p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Partner clinical lead approves pathway, red flags, and closure criteria.
                    </p>
                  </div>
                  <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3">
                    <p className="text-xs font-bold text-[#061B3A]">2. Data Protection Assessment</p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Completed data map, consent model, and signed processing agreements.
                    </p>
                  </div>
                  <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3">
                    <p className="text-xs font-bold text-[#061B3A]">3. Confirmed Return Route</p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Receiving facility actively acknowledges referrals and returns outcomes.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Card 3: Evidence-Based Evaluation */}
            <div className="bg-white text-[#061B3A] rounded-2xl p-6 shadow-lg flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#00828C]">
                    <BarChart3 className="w-3.5 h-3.5" />
                    Week 13 Evaluation
                  </span>
                  <span className="font-mono text-xs text-slate-400">Baseline-Bound</span>
                </div>
                <h3 className="font-display text-lg font-bold text-[#061B3A]">
                  Operational Metrics, Not Vanity Numbers
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Baselines and targets are agreed at kickoff using the partner&apos;s own historical data. Synthetic simulations are excluded from live reporting.
                </p>

                <div className="divide-y divide-slate-100">
                  {EVALUATION_METRICS.map((metric) => (
                    <div key={metric.label} className="py-2.5 first:pt-1 last:pb-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-bold text-[#061B3A]">{metric.label}</p>
                        <span className="text-[11px] font-medium text-[#00828C]">
                          {metric.emphasis}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-0.5 leading-snug">
                        {metric.detail}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center gap-2 text-[11px] text-slate-500">
                <ShieldAlert className="w-3.5 h-3.5 text-[#008E97] shrink-0" />
                <span>Evaluates operational access; does not claim clinical efficacy.</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
