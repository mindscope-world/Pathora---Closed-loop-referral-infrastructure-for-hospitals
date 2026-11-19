import { useState, FormEvent } from 'react';
import { CheckCircle2, Copy, Check, ArrowRight } from 'lucide-react';

const STAKEHOLDER_ROLES = [
  'Screening Programme / NGO Lead',
  'Receiving Hospital / Clinic Director',
  'Clinical Lead / Specialist',
  'Programme Funder / Development Partner',
  'Digital Health / Data Protection Lead',
];

const PATHWAYS = [
  'Cancer Screening',
  'NCD Screening',
  'Male Reproductive Health',
  'Maternal & Child Health',
];

export function DiscoverySection() {
  const [name, setName] = useState('');
  const [organization, setOrganization] = useState('');
  const [role, setRole] = useState(STAKEHOLDER_ROLES[0]);
  const [pathway, setPathway] = useState(PATHWAYS[0]);
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim();
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);

    if (!name.trim() || !organization.trim()) {
      setError('Please enter your name and organization.');
      return;
    }
    if (!emailValid) {
      setError('Please enter a valid work email address.');
      return;
    }

    setError(null);
    setSubmitted(true);
  };

  const handleCopyBrief = async () => {
    const summary = [
      'Pathora 90-Day Pilot Discovery Request',
      `Contact: ${name} (${role})`,
      `Organization: ${organization}`,
      `Email: ${email}`,
      `Target Pathway: ${pathway}`,
      notes ? `Context: ${notes}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback ignored in restricted contexts
    }
  };

  return (
    <section id="contact" className="py-14 sm:py-20">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-start">
          {/* Left Column: Discovery Ask & Minimum Pilot Requirements */}
          <div className="lg:col-span-5 space-y-6">
            <div className="space-y-3">
              <p className="text-xs font-semibold text-[#00828C]">
                Start with a 30–45 minute workflow walkthrough
              </p>
              <h2
                className="font-display font-bold tracking-tight text-[#061B3A] leading-[1.12]"
                style={{ fontSize: 'clamp(1.85rem, 3.2vw, 2.5rem)', textWrap: 'balance' }}
              >
                See how Pathora closes your referral loop.
              </h2>
              <p className="text-base text-slate-600 leading-relaxed">
                Whether you run a regional screening programme, manage receiving clinics, or fund preventive care, we help you map drop-off points and configure a 90-day pilot around your existing workflow.
              </p>
            </div>

            <div className="bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 space-y-4">
              <h3 className="font-display text-sm font-bold text-[#061B3A]">
                What your team gets from the walkthrough
              </h3>
              <ul className="space-y-3 text-sm text-slate-600">
                <li className="flex items-start gap-2.5">
                  <span className="font-mono text-xs font-semibold text-[#008E97] mt-0.5">01.</span>
                  <span>A clear diagnostic map of one screening-to-care pathway and where referrals stall today.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="font-mono text-xs font-semibold text-[#008E97] mt-0.5">02.</span>
                  <span>Baseline readiness assessment and low-friction receiving facility status-return options.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="font-mono text-xs font-semibold text-[#008E97] mt-0.5">03.</span>
                  <span>A tailored 90-day pilot plan with transparent pricing scoped to your cohort size and sites.</span>
                </li>
              </ul>
            </div>

            <div className="text-xs text-slate-500 space-y-1">
              <p className="font-semibold text-[#061B3A]">
                Dedicated Implementation Support · Nairobi, Kenya
              </p>
              <p>Joint clinical, operational, and data-protection onboarding for every client deployment.</p>
            </div>
          </div>

          {/* Right Column: Validated Interactive Lead Capture Form */}
          <div className="lg:col-span-7">
            <div className="bg-white border border-slate-200 rounded-[1.5rem] p-6 sm:p-8 shadow-sm">
              {submitted ? (
                <div className="py-6 space-y-5">
                  <div className="w-12 h-12 rounded-2xl bg-[#009CA6]/12 text-[#00828C] flex items-center justify-center">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="font-display text-xl font-bold text-[#061B3A]">
                      Discovery walkthrough brief prepared
                    </h3>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      Thank you, <span className="font-semibold text-[#061B3A]">{name}</span>. Your discovery profile for <span className="font-semibold text-[#061B3A]">{organization}</span> ({pathway}) is ready for our walkthrough review.
                    </p>
                  </div>

                  <div className="bg-[#F8FAFC] border border-slate-200 rounded-xl p-4 text-xs text-slate-700 space-y-1.5 font-mono">
                    <p>Role: {role}</p>
                    <p>Pathway: {pathway}</p>
                    <p>Contact: {email}</p>
                    {notes && <p>Notes: {notes}</p>}
                  </div>

                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={handleCopyBrief}
                      className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#061B3A] hover:bg-[#0B2954] rounded-full transition-colors cursor-pointer"
                    >
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      <span>{copied ? 'Copied Summary' : 'Copy Pilot Brief'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSubmitted(false);
                        setNotes('');
                      }}
                      className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:text-[#061B3A] transition-colors cursor-pointer"
                    >
                      Edit details
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubmit} noValidate className="space-y-5">
                  <div className="border-b border-slate-100 pb-4">
                    <h3 className="font-display text-lg font-bold text-[#061B3A]">
                      Request a Pilot Discovery Walkthrough
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Designed for screening programmes, receiving hospitals, and health funders.
                    </p>
                  </div>

                  {error && (
                    <div
                      role="alert"
                      className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3"
                    >
                      {error}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="lead-name" className="block text-xs font-semibold text-[#061B3A] mb-1.5">
                        Full Name
                      </label>
                      <input
                        id="lead-name"
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Dr. Amina Ochieng"
                        className="w-full px-3.5 py-2.5 text-sm bg-[#F8FAFC] border border-slate-200 rounded-xl text-[#061B3A] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#009CA6] focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label htmlFor="lead-org" className="block text-xs font-semibold text-[#061B3A] mb-1.5">
                        Organization / Facility
                      </label>
                      <input
                        id="lead-org"
                        type="text"
                        required
                        value={organization}
                        onChange={(e) => setOrganization(e.target.value)}
                        placeholder="County Health / Screening NGO"
                        className="w-full px-3.5 py-2.5 text-sm bg-[#F8FAFC] border border-slate-200 rounded-xl text-[#061B3A] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#009CA6] focus:border-transparent"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="lead-role" className="block text-xs font-semibold text-[#061B3A] mb-1.5">
                        Partner Category
                      </label>
                      <select
                        id="lead-role"
                        value={role}
                        onChange={(e) => setRole(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm bg-[#F8FAFC] border border-slate-200 rounded-xl text-[#061B3A] focus:outline-none focus:ring-2 focus:ring-[#009CA6] focus:border-transparent"
                      >
                        {STAKEHOLDER_ROLES.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="lead-pathway" className="block text-xs font-semibold text-[#061B3A] mb-1.5">
                        Priority Pathway
                      </label>
                      <select
                        id="lead-pathway"
                        value={pathway}
                        onChange={(e) => setPathway(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm bg-[#F8FAFC] border border-slate-200 rounded-xl text-[#061B3A] focus:outline-none focus:ring-2 focus:ring-[#009CA6] focus:border-transparent"
                      >
                        {PATHWAYS.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="lead-email" className="block text-xs font-semibold text-[#061B3A] mb-1.5">
                      Work Email
                    </label>
                    <input
                      id="lead-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@organization.org"
                      className="w-full px-3.5 py-2.5 text-sm bg-[#F8FAFC] border border-slate-200 rounded-xl text-[#061B3A] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#009CA6] focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label htmlFor="lead-notes" className="block text-xs font-semibold text-[#061B3A] mb-1.5">
                      Current Referral Workflow Context (Optional)
                    </label>
                    <textarea
                      id="lead-notes"
                      rows={3}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Share your screening volume, receiving facilities, or where referrals currently stall..."
                      className="w-full px-3.5 py-2.5 text-sm bg-[#F8FAFC] border border-slate-200 rounded-xl text-[#061B3A] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#009CA6] focus:border-transparent resize-none"
                    />
                  </div>

                  <div className="pt-1 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <button
                      type="submit"
                      className="inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-[#008E97] hover:bg-[#00767E] rounded-full transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <span>Request Discovery Session</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                    <p className="text-xs text-slate-500">
                      No obligation beyond pilot evaluation.
                    </p>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
