import { Check, X, ShieldCheck, FileText } from 'lucide-react';

const MVP_INCLUDED = [
  'Configurable workflow orchestration, deadlines, and SLA escalations',
  'Named case ownership and role-based access across organisations',
  'Distinct tracking of referral sent, facility acknowledged, attended, and outcome',
  'Discreet, consent-led SMS and WhatsApp patient notifications with opt-out',
  'Programme funnel dashboards highlighting bottlenecks and overdue queues',
];

const STRICT_BOUNDARIES = [
  'No AI-based clinical risk prediction or autonomous patient triage',
  'No diagnosis, treatment recommendations, or clinical judgement replacement',
  'No parallel electronic medical record (EMR) or hospital billing system',
  'No unverified case closure simply because a referral form was transmitted',
  'No live data processing prior to signed data protection agreements',
];

export function GovernanceAndScopeSection() {
  return (
    <section id="governance" className="py-14 sm:py-20 bg-white border-y border-slate-200/70">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 space-y-10">
        <div className="max-w-2xl space-y-3">
          <p className="text-xs font-semibold text-[#00828C]">
            Platform capabilities &amp; clinical governance
          </p>
          <h2
            className="font-display font-bold tracking-tight text-[#061B3A] leading-[1.15]"
            style={{ fontSize: 'clamp(1.75rem, 3vw, 2.35rem)', textWrap: 'balance' }}
          >
            Built for programme accountability, never clinical overreach.
          </h2>
          <p className="text-base text-slate-600 leading-relaxed">
            Your clinical team retains full control over pathways, escalation criteria, and patient care. Pathora handles operational coordination, privacy controls, and audit-ready reporting.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
          {/* Left Panel: Operational Focus */}
          <div className="bg-[#F8FAFC] border border-slate-200/90 rounded-[1.5rem] p-6 sm:p-8 flex flex-col justify-between space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 pb-4">
                <div>
                  <h3 className="font-display text-lg font-bold text-[#061B3A]">
                    What Your Programme Receives
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Configured to your existing referral workflow in 90 days
                  </p>
                </div>
                <FileText className="w-5 h-5 text-[#008E97] shrink-0" />
              </div>

              <ul className="space-y-3.5">
                {MVP_INCLUDED.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-slate-700 leading-relaxed">
                    <span className="w-5 h-5 rounded-md bg-[#009CA6]/15 text-[#00828C] flex items-center justify-center shrink-0 mt-0.5">
                      <Check className="w-3.5 h-3.5" />
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <p className="text-xs text-slate-500 pt-4 border-t border-slate-200/80">
              Transparent B2B licensing for screening programmes, healthcare providers, payers, and funders. Patients are never charged to receive follow-up coordination.
            </p>
          </div>

          {/* Right Panel: Strict Clinical & Privacy Boundaries */}
          <div className="bg-[#061B3A] text-white rounded-[1.5rem] p-6 sm:p-8 flex flex-col justify-between space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 border-b border-white/15 pb-4">
                <div>
                  <h3 className="font-display text-lg font-bold text-white">
                    Non-Negotiable Clinical &amp; Privacy Boundaries
                  </h3>
                  <p className="text-xs text-teal-100/80 mt-0.5">
                    Deterministic rules approved by your clinical lead
                  </p>
                </div>
                <ShieldCheck className="w-5 h-5 text-teal-300 shrink-0" />
              </div>

              <ul className="space-y-3.5">
                {STRICT_BOUNDARIES.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-slate-100 leading-relaxed">
                    <span className="w-5 h-5 rounded-md bg-white/10 text-teal-200 flex items-center justify-center shrink-0 mt-0.5">
                      <X className="w-3.5 h-3.5" />
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="pt-4 border-t border-white/15 space-y-1">
              <p className="text-xs font-semibold text-teal-200">
                Kenyan Regulatory Alignment
              </p>
              <p className="text-xs text-slate-300 leading-relaxed">
                Architected for alignment with the Kenya Data Protection Act (2019), Digital Health Act (2023), and Digital Health Agency interoperability standards, subject to partner-confirmed controller/processor review.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
