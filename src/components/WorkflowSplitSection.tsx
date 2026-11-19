import { useState } from 'react';
import { UserCheck, BellRing, CheckSquare, ArrowLeftRight } from 'lucide-react';
import { CORE_PILLARS, WORKFLOW_STAGES } from '../data/pathoraData';

const PILLAR_ICONS = [UserCheck, BellRing, CheckSquare, ArrowLeftRight];

export function WorkflowSplitSection() {
  const [activeStageId, setActiveStageId] = useState<number>(4);
  const activeStage =
    WORKFLOW_STAGES.find((stage) => stage.id === activeStageId) ?? WORKFLOW_STAGES[0];

  return (
    <section id="workflow" className="py-14 sm:py-20">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
          {/* Left Column: Signature Teal Visual Frame with Dark Cross Motif & Interactive 7-Stage Engine */}
          <div className="lg:col-span-6 flex">
            <div className="relative w-full overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#009CA6] via-[#057C94] to-[#062E52] p-6 sm:p-8 flex flex-col justify-between shadow-[0_20px_50px_-15px_rgba(0,142,151,0.28)]">
              {/* Geometric Medical Cross Cutout Accent (borrowed directly from reference Section 2) */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -bottom-10 -left-10 w-44 h-44 text-[#04152E] opacity-90"
              >
                <svg viewBox="0 0 120 120" fill="currentColor" className="w-full h-full">
                  <path d="M42 10H78V42H110V78H78V110H42V78H10V42H42V10Z" />
                </svg>
              </div>

              <div className="relative z-10 space-y-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium text-teal-100">
                      Interactive case engine
                    </p>
                    <h3 className="font-display text-lg sm:text-xl font-bold text-white mt-0.5">
                      Seven Stages to Accountability
                    </h3>
                  </div>
                  <span className="font-mono text-xs tabular-nums text-teal-100 bg-white/15 px-2.5 py-1 rounded-md whitespace-nowrap">
                    Stage {activeStage.id} / 7
                  </span>
                </div>

                {/* Stage Selector Strip */}
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                  {WORKFLOW_STAGES.map((stage) => {
                    const isActive = stage.id === activeStage.id;
                    return (
                      <button
                        key={stage.id}
                        type="button"
                        onClick={() => setActiveStageId(stage.id)}
                        className={`px-2 py-2 rounded-xl text-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                          isActive
                            ? 'bg-white text-[#061B3A] font-semibold shadow-sm'
                            : 'bg-[#061B3A]/40 text-teal-50 hover:bg-[#061B3A]/65'
                        }`}
                      >
                        <span className="block font-mono text-[11px] tabular-nums opacity-75">
                          0{stage.id}
                        </span>
                        <span className="block text-[11px] font-medium truncate mt-0.5">
                          {stage.shortLabel}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Elevated White Case Screen Card (echoing tablet/phone UI inside reference Section 2) */}
                <div className="bg-white rounded-2xl p-5 sm:p-6 shadow-xl border border-slate-100 space-y-4">
                  <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3.5">
                    <div>
                      <p className="text-xs font-medium text-[#00828C]">
                        Active Stage · {activeStage.slaWindow}
                      </p>
                      <h4 className="font-display text-lg font-bold text-[#061B3A] mt-0.5">
                        {activeStage.id}. {activeStage.title}
                      </h4>
                    </div>
                    <span className="font-mono text-xs tabular-nums text-slate-500 whitespace-nowrap">
                      CASE-2026-0418
                    </span>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <p className="text-xs font-semibold text-slate-500">Pathora Action</p>
                      <p className="text-sm text-[#061B3A] leading-relaxed mt-1">
                        {activeStage.action}
                      </p>
                    </div>

                    <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5">
                      <p className="text-xs font-semibold text-slate-500">Evidence Recorded</p>
                      <p className="text-sm text-slate-700 mt-1 leading-relaxed">
                        {activeStage.evidence}
                      </p>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-3 text-xs">
                    <span className="text-slate-600 truncate font-mono">
                      {activeStage.sampleEvent}
                    </span>
                  </div>
                </div>
              </div>

              <div className="relative z-10 mt-6 flex items-center justify-end">
                <p className="text-xs text-teal-50/90 text-right max-w-xs">
                  Condition-agnostic case engine: every stage transition is timestamped and attributed to a named owner.
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Headline + 4 Stacked Icon Cards (matching reference Section 2) */}
          <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
            <div className="space-y-3">
              <h2
                className="font-display font-bold tracking-tight text-[#061B3A] leading-[1.15]"
                style={{ fontSize: 'clamp(1.75rem, 3vw, 2.35rem)', textWrap: 'balance' }}
              >
                Accountability built into every clinical handoff.
              </h2>
              <p className="text-base text-slate-600 leading-relaxed max-w-xl">
                When follow-up lives across phone calls, paper forms, and spreadsheets, visibility vanishes. Pathora adds a lightweight accountability layer between screening programmes and receiving facilities.
              </p>
            </div>

            <div className="space-y-3.5">
              {CORE_PILLARS.map((pillar, idx) => {
                const Icon = PILLAR_ICONS[idx];
                return (
                  <div
                    key={pillar.id}
                    className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 flex items-start gap-4 hover:border-[#009CA6]/50 transition-colors duration-150"
                  >
                    <div className="w-12 h-12 rounded-xl bg-[#009CA6]/12 text-[#00828C] flex items-center justify-center shrink-0">
                      <Icon className="w-6 h-6" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-display text-base font-bold text-[#061B3A]">
                        {pillar.title}
                      </h3>
                      <p className="text-sm text-slate-600 leading-relaxed mt-1">
                        {pillar.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
