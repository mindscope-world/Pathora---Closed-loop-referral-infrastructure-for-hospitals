import { useState } from 'react';
import { ArrowRight, CheckCircle2, AlertCircle, Clock, ShieldCheck, Building2 } from 'lucide-react';

interface HeroSectionProps {
  onOpenDiscovery: (defaultPathway?: string) => void;
  onOpenSignup: () => void;
}

export function HeroSection({ onOpenDiscovery, onOpenSignup }: HeroSectionProps) {
  const [loopMode, setLoopMode] = useState<'closed' | 'open'>('closed');

  const closedCards = [
    {
      step: '01',
      title: 'Positive Screen & Named Owner',
      meta: 'Cancer Screening · Nairobi Cohort',
      status: 'Assigned to M. Wanjiku · Due 24h',
      icon: Clock,
    },
    {
      step: '02',
      title: 'Receiving Facility Handoff',
      meta: 'Kenyatta Referral Desk',
      status: 'Acknowledged · Attendance Confirmed',
      icon: Building2,
    },
    {
      step: '03',
      title: 'Documented Clinical Outcome',
      meta: 'Evaluation Recorded',
      status: 'Closed with Verified Audit Trail',
      icon: CheckCircle2,
    },
  ];

  const openCards = [
    {
      step: '01',
      title: 'Positive Screen Issued',
      meta: 'Paper Referral & Phone Log',
      status: 'No assigned owner after handoff',
      icon: AlertCircle,
    },
    {
      step: '02',
      title: 'Facility Receipt Unconfirmed',
      meta: 'Manual Spreadsheet Tracking',
      status: 'Visibility vanishes post-referral',
      icon: AlertCircle,
    },
    {
      step: '03',
      title: 'The Measurement Gap',
      meta: 'Outcome Unknown',
      status: 'Cannot verify if care was reached',
      icon: AlertCircle,
    },
  ];

  const activeCards = loopMode === 'closed' ? closedCards : openCards;

  return (
    <section className="pt-6 pb-12 sm:pt-8 sm:pb-16">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
        {/* Main Rounded Teal-Navy Banner inspired by reference layout & Pathora brand ribbons */}
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#061B3A] via-[#0B4F6C] to-[#00A3AE] text-white px-6 py-10 sm:px-10 sm:py-14 lg:px-14 lg:py-16 shadow-[0_24px_60px_-15px_rgba(6,27,58,0.28)]">
          {/* Subtle Architectural Ribbon Geometry matching Pathora identity */}
          <svg
            aria-hidden="true"
            viewBox="0 0 900 500"
            fill="none"
            className="pointer-events-none absolute inset-0 w-full h-full opacity-20"
            preserveAspectRatio="xMidYMid slice"
          >
            <path
              d="M-60 360 C 140 360, 210 180, 410 180 C 610 180, 680 70, 960 70"
              stroke="url(#hero-ribbon)"
              strokeWidth="44"
              strokeLinecap="round"
            />
            <path
              d="M-40 430 C 180 430, 260 250, 470 250 C 680 250, 740 140, 960 140"
              stroke="rgba(255,255,255,0.18)"
              strokeWidth="2"
            />
            <defs>
              <linearGradient id="hero-ribbon" x1="0" y1="360" x2="900" y2="70" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#0284C7" stopOpacity="0.1" />
                <stop offset="50%" stopColor="#14B8B4" stopOpacity="0.55" />
                <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.35" />
              </linearGradient>
            </defs>
          </svg>

          <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            {/* Left Proposition & Primary Action */}
            <div className="lg:col-span-6 space-y-6">
              <p className="text-xs sm:text-sm font-medium tracking-wide text-teal-100/90">
                Closed-loop referral infrastructure · Built for screening programmes &amp; hospitals
              </p>

              <h1
                className="font-display font-bold tracking-tight text-white leading-[1.08]"
                style={{ fontSize: 'clamp(2.25rem, 4.1vw, 3.4rem)', textWrap: 'balance' }}
              >
                Prove your screening investments translate into care.
              </h1>

              <p className="text-base sm:text-lg text-slate-100/90 leading-relaxed max-w-xl">
                Screening is only an entry point. Pathora gives programme teams, receiving facilities, and funders end-to-end visibility—tracking every positive screen from handoff through documented clinical outcome.
              </p>

              <div className="flex flex-wrap items-center gap-4 pt-1">
                <button
                  type="button"
                  onClick={() => onOpenDiscovery()}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3.5 text-sm sm:text-base font-semibold text-[#061B3A] bg-white hover:bg-teal-50 rounded-full transition-colors duration-150 shadow-sm whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#061B3A]"
                >
                  <span>Schedule Discovery Walkthrough</span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={onOpenSignup}
                  className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold text-white bg-white/10 hover:bg-white/20 border border-white/25 rounded-full transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Create Account
                </button>
              </div>

              <div className="pt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm text-teal-100/80">
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-teal-200 shrink-0" />
                  Coordinates workflow—never diagnoses
                </span>
                <span aria-hidden="true" className="text-teal-200/50">·</span>
                <span>Complements existing EMRs</span>
              </div>
            </div>

            {/* Right Column: Floating Case Loop Stack (echoing reference right-side card stack) */}
            <div className="lg:col-span-6">
              <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-4 sm:p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs font-medium text-teal-100">
                    Compare referral architecture
                  </span>
                  <div
                    role="tablist"
                    aria-label="Compare open-loop vs closed-loop referrals"
                    className="inline-flex items-center p-1 rounded-xl bg-[#061B3A]/60 border border-white/15"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={loopMode === 'closed'}
                      onClick={() => setLoopMode('closed')}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                        loopMode === 'closed'
                          ? 'bg-white text-[#061B3A] shadow-sm'
                          : 'text-teal-100 hover:text-white'
                      }`}
                    >
                      Pathora Closed-Loop
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={loopMode === 'open'}
                      onClick={() => setLoopMode('open')}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                        loopMode === 'open'
                          ? 'bg-white text-[#061B3A] shadow-sm'
                          : 'text-teal-100 hover:text-white'
                      }`}
                    >
                      Standard Open-Loop
                    </button>
                  </div>
                </div>

                {/* 3 Stacked Clean Floating White Cards */}
                <div className="space-y-3">
                  {activeCards.map((card, index) => {
                    const Icon = card.icon;
                    const offsetClass =
                      index === 1 ? 'sm:translate-x-3' : index === 2 ? 'sm:translate-x-1' : '';

                    return (
                      <div
                        key={card.step + loopMode}
                        className={`bg-white text-[#061B3A] rounded-xl p-4 shadow-md border border-slate-100 flex items-center gap-4 transition-transform duration-200 ${offsetClass}`}
                      >
                        <div
                          className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                            loopMode === 'closed'
                              ? 'bg-[#009CA6]/12 text-[#00828C]'
                              : 'bg-amber-50 text-amber-700'
                          }`}
                        >
                          <Icon className="w-5 h-5" />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-display text-sm font-bold text-[#061B3A] truncate">
                              {card.step}. {card.title}
                            </p>
                            <span className="font-mono text-[11px] tabular-nums text-slate-400 shrink-0">
                              {loopMode === 'closed' ? 'Verified' : 'Unverified'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5 truncate">
                            {card.meta} <span aria-hidden="true">·</span>{' '}
                            <span
                              className={
                                loopMode === 'closed'
                                  ? 'text-[#00828C] font-medium'
                                  : 'text-amber-700 font-medium'
                              }
                            >
                              {card.status}
                            </span>
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <p className="text-xs text-teal-50/85 pt-1 leading-relaxed">
                  {loopMode === 'closed'
                    ? 'Evidence-based care: Cases remain open until clinical evaluation or an approved terminal status is recorded.'
                    : 'Assumption-based care: Cases end on paper when the referral is filed, leaving programmes unable to prove access.'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
