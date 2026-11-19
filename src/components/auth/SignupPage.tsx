import { useState, FormEvent } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, ShieldCheck } from 'lucide-react';
import { PathoraMark } from '../PathoraMark';
import { useAuth } from '../../auth/AuthProvider';
import { describeAuthError } from './authForm';

interface SignupPageProps {
  onSuccess: () => void;
  onGoToLogin: () => void;
  onBackToSite: () => void;
}

export function SignupPage({
  onSuccess,
  onGoToLogin,
  onBackToSite,
}: SignupPageProps) {
  const { signUp } = useAuth();
  const [fullName, setFullName] = useState('');
  const [organization, setOrganization] = useState('');
  const [pathway, setPathway] = useState('Cancer Screening');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      await signUp({ fullName, organization, email, password, pathway });
      onSuccess();
    } catch (err) {
      const { message, fields } = describeAuthError(err);
      setError(message);
      setFieldErrors(fields);
      setSubmitting(false);
    }
  };

  const fieldError = (name: string) =>
    fieldErrors[name] ? (
      <p className="mt-1 text-xs text-red-700" role="alert">
        {fieldErrors[name]}
      </p>
    ) : null;

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#061B3A] flex flex-col justify-between p-4 sm:p-6 lg:p-8">
      {/* Top Bar */}
      <div className="max-w-[1200px] w-full mx-auto flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBackToSite}
          className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#009CA6] rounded-lg"
          aria-label="Back to Pathora website"
        >
          <PathoraMark variant="light" />
        </button>

        <button
          type="button"
          onClick={onBackToSite}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-[#061B3A] transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to website</span>
        </button>
      </div>

      {/* Main Centered Split Card */}
      <main className="max-w-[1120px] w-full mx-auto my-8 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
        {/* Left: Sign Up Form */}
        <div className="lg:col-span-6 bg-white border border-slate-200/90 rounded-[2rem] p-7 sm:p-10 flex flex-col justify-center shadow-sm">
          <div className="space-y-2 mb-6">
            <p className="text-xs font-semibold text-[#00828C]">
              Organisation Onboarding
            </p>
            <h1
              className="font-display font-bold tracking-tight text-[#061B3A]"
              style={{ fontSize: 'clamp(1.75rem, 3vw, 2.25rem)' }}
            >
              Create your Pathora account
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              Register your organisation to set up your referral accountability workspace. You will be its Programme Manager and can invite your team afterwards.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label
                  htmlFor="signup-name"
                  className="block text-xs font-semibold text-[#061B3A] mb-1.5"
                >
                  Full Name
                </label>
                <input
                  id="signup-name"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Dr. Amina Ochieng"
                  autoComplete="name"
                  required
                  className="w-full px-3.5 py-2.5 text-sm bg-[#F8FAFC] border border-slate-200 rounded-xl text-[#061B3A] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#009CA6]"
                />
                {fieldError('fullName')}
              </div>
              <div>
                <label
                  htmlFor="signup-org"
                  className="block text-xs font-semibold text-[#061B3A] mb-1.5"
                >
                  Organization / Facility
                </label>
                <input
                  id="signup-org"
                  type="text"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder="County Health / Screening NGO"
                  autoComplete="organization"
                  required
                  className="w-full px-3.5 py-2.5 text-sm bg-[#F8FAFC] border border-slate-200 rounded-xl text-[#061B3A] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#009CA6]"
                />
                {fieldError('organization')}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3.5">
              <div>
                <label
                  htmlFor="signup-pathway"
                  className="block text-xs font-semibold text-[#061B3A] mb-1.5"
                >
                  Primary Care Pathway
                </label>
                <select
                  id="signup-pathway"
                  value={pathway}
                  onChange={(e) => setPathway(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-[#F8FAFC] border border-slate-200 rounded-xl text-[#061B3A] focus:outline-none focus:ring-2 focus:ring-[#009CA6]"
                >
                  <option value="Cancer Screening">Cancer Screening</option>
                  <option value="NCD Screening">NCD Screening</option>
                  <option value="Male Reproductive Health">Male Reproductive Health</option>
                </select>
              </div>
            </div>

            <div>
              <label
                htmlFor="signup-email"
                className="block text-xs font-semibold text-[#061B3A] mb-1.5"
              >
                Work Email
              </label>
              <input
                id="signup-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@organization.org"
                autoComplete="username"
                required
                className="w-full px-3.5 py-2.5 text-sm bg-[#F8FAFC] border border-slate-200 rounded-xl text-[#061B3A] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#009CA6]"
              />
              {fieldError('email')}
            </div>

            <div>
              <label
                htmlFor="signup-password"
                className="block text-xs font-semibold text-[#061B3A] mb-1.5"
              >
                Create Password
              </label>
              <input
                id="signup-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 12 characters"
                autoComplete="new-password"
                minLength={12}
                required
                className="w-full px-3.5 py-2.5 text-sm bg-[#F8FAFC] border border-slate-200 rounded-xl text-[#061B3A] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#009CA6]"
              />
              {fieldError('password')}
            </div>

            {error && (
              <div role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 py-3.5 px-6 text-sm font-semibold text-white bg-[#008E97] hover:bg-[#00767E] disabled:opacity-60 disabled:cursor-not-allowed rounded-full transition-colors duration-150 shadow-sm cursor-pointer mt-2"
            >
              <span>{submitting ? 'Creating account…' : 'Create Account &amp; Enter Dashboard'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-slate-600">Already have an account?</span>
            <button
              type="button"
              onClick={onGoToLogin}
              className="font-semibold text-[#00828C] hover:text-[#061B3A] transition-colors cursor-pointer"
            >
              Sign in instead →
            </button>
          </div>
        </div>

        {/* Right: Pathora Navy-Teal Onboarding Summary Panel */}
        <div className="lg:col-span-6 hidden lg:flex">
          <div className="w-full rounded-[2rem] bg-gradient-to-br from-[#061B3A] via-[#0B4F6C] to-[#00A3AE] text-white p-10 flex flex-col justify-between shadow-[0_24px_60px_-15px_rgba(6,27,58,0.25)]">
            <div className="space-y-5">
              <p className="text-xs font-medium text-teal-100/90">
                Built for screening programmes &amp; hospitals
              </p>
              <h2
                className="font-display font-bold text-white leading-[1.15]"
                style={{ fontSize: 'clamp(1.65rem, 2.5vw, 2.15rem)', textWrap: 'balance' }}
              >
                Launch closed-loop referral tracking without replacing your EMR.
              </h2>
              <p className="text-sm text-slate-100/90 leading-relaxed">
                Start with secure CSV intake or web case logging, verify receiving facility acknowledgments, and report true completion rates to your stakeholders.
              </p>
            </div>

            <div className="bg-white/10 backdrop-blur-sm border border-white/15 rounded-2xl p-5 space-y-3 my-6">
              <p className="text-xs font-semibold text-teal-200">
                Included in your workspace preview
              </p>
              <ul className="space-y-2.5 text-sm text-teal-50">
                {[
                  '7-stage closed-loop referral queue & case drawer',
                  'Receiving facility status-return desk',
                  'Automated SLA escalation & barrier tracking',
                  'Discreet English/Kiswahili patient communications',
                ].map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-teal-200 shrink-0 mt-0.5" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center gap-2 text-xs text-teal-100/80">
              <ShieldCheck className="w-4 h-4 text-teal-200 shrink-0" />
              <span>Coordinates workflow—never diagnoses or prescribes</span>
            </div>
          </div>
        </div>
      </main>

      <footer className="max-w-[1200px] w-full mx-auto text-center text-xs text-slate-500">
        © {new Date().getFullYear()} Pathora · Closing the gap between screening and care.
      </footer>
    </div>
  );
}
