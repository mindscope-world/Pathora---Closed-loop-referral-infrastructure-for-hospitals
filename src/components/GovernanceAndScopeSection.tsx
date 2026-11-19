import { Check, Minus } from 'lucide-react';

const MVP_INCLUDED = [
  'Deadlines, escalations and named ownership for every referral',
  'Consent-led SMS and WhatsApp follow-up with opt-out',
  'Dashboards showing bottlenecks and overdue cases',
];

const STRICT_BOUNDARIES = [
  'No diagnosis, triage or treatment advice',
  'No parallel medical record or billing system',
  'No live patient data before data protection agreements are signed',
];

export function GovernanceAndScopeSection() {
  return (
    <section id="governance" className="py-16 sm:py-20 bg-surface border-y border-line scroll-mt-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16">
        <div className="lg:col-span-4 space-y-3">
          <h2 className="text-3xl font-semibold tracking-tight text-ink">Coordination, not clinical decisions</h2>
          <p className="text-ink-2 leading-relaxed">
            Your clinicians own the pathways and escalation rules. Pathora handles the follow-through, privacy controls
            and audit trail.
          </p>
          <p className="text-sm text-ink-3 pt-2">
            Designed for the Kenya Data Protection Act (2019) and Digital Health Act (2023).
          </p>
        </div>

        <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-10">
          <div className="space-y-4">
            <h3 className="text-[15px] font-semibold text-ink">What Pathora does</h3>
            <ul className="space-y-3">
              {MVP_INCLUDED.map((item) => (
                <li key={item} className="flex gap-2.5 text-sm text-ink-2 leading-relaxed">
                  <Check className="size-4 mt-0.5 shrink-0 text-brand" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-4">
            <h3 className="text-[15px] font-semibold text-ink">What it never does</h3>
            <ul className="space-y-3">
              {STRICT_BOUNDARIES.map((item) => (
                <li key={item} className="flex gap-2.5 text-sm text-ink-2 leading-relaxed">
                  <Minus className="size-4 mt-0.5 shrink-0 text-ink-3" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
