import { useState, FormEvent } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, ShieldCheck } from 'lucide-react';
import { PathoraMark } from '../PathoraMark';
import { api } from '../../lib/api';

export interface AuthUserSession {
  name: string;
  role: string;
  organization: string;
  email: string;
}

interface LoginPageProps {
  onSuccess: (user: AuthUserSession) => void;
  onGoToSignup: () => void;
  onBackToSite: () => void;
}

export function LoginPage({
  onSuccess,
  onGoToSignup,
  onBackToSite,
}: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Please enter your work email and password.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const user = await api.login(email.trim(), password);
      onSuccess(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  };

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
        {/* Left: Login Form */}
        <div className="lg:col-span-6 bg-white border border-slate-200/90 rounded-[2rem] p-7 sm:p-10 flex flex-col justify-center shadow-sm">
          <div className="space-y-2 mb-7">
            <p className="text-xs font-semibold text-[#00828C]">
              Client &amp; Partner Workspace
            </p>
            <h1
              className="font-display font-bold tracking-tight text-[#061B3A]"
              style={{ fontSize: 'clamp(1.75rem, 3vw, 2.25rem)' }}
            >
              Sign in to Pathora
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              Access your closed-loop referral queue, facility acknowledgments, and programme reporting.
            </p>
          </div>

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            {error && (
              <div
                role="alert"
                className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5"
              >
                {error}
              </div>
            )}

            <div>
              <label
                htmlFor="login-email"
                className="block text-xs font-semibold text-[#061B3A] mb-1.5"
              >
                Work Email
              </label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@organization.org"
                className="w-full px-4 py-3 text-sm bg-[#F8FAFC] border border-slate-200 rounded-xl text-[#061B3A] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#009CA6] focus:border-transparent"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="login-password"
                  className="block text-xs font-semibold text-[#061B3A]"
                >
                  Password
                </label>
              </div>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="w-full px-4 py-3 text-sm bg-[#F8FAFC] border border-slate-200 rounded-xl text-[#061B3A] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#009CA6] focus:border-transparent"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 py-3.5 px-6 text-sm font-semibold text-white bg-[#008E97] hover:bg-[#00767E] disabled:opacity-60 disabled:cursor-wait rounded-full transition-colors duration-150 shadow-sm cursor-pointer mt-2"
            >
              <span>{submitting ? 'Signing in…' : 'Sign In to Dashboard'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="mt-4 bg-[#F8FAFC] border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-600 flex flex-wrap items-center justify-between gap-2">
            <span>
              Demo account: <span className="font-mono">coordinator@nairobi-screening.org</span> /{' '}
              <span className="font-mono">pathora-demo</span>
            </span>
            <button
              type="button"
              onClick={() => {
                setEmail('coordinator@nairobi-screening.org');
                setPassword('pathora-demo');
                setError(null);
              }}
              className="font-semibold text-[#00828C] hover:text-[#061B3A] cursor-pointer"
            >
              Use demo account
            </button>
          </div>

          <div className="mt-6 pt-5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-slate-600">New to Pathora?</span>
            <button
              type="button"
              onClick={onGoToSignup}
              className="font-semibold text-[#00828C] hover:text-[#061B3A] transition-colors cursor-pointer"
            >
              Create organization account →
            </button>
          </div>
        </div>

        {/* Right: Pathora Navy-Teal Value Panel */}
        <div className="lg:col-span-6 hidden lg:flex">
          <div className="w-full rounded-[2rem] bg-gradient-to-br from-[#061B3A] via-[#0B4F6C] to-[#00A3AE] text-white p-10 flex flex-col justify-between shadow-[0_24px_60px_-15px_rgba(6,27,58,0.25)]">
            <div className="space-y-5">
              <p className="text-xs font-medium text-teal-100/90">
                Closed-loop referral accountability
              </p>
              <h2
                className="font-display font-bold text-white leading-[1.15]"
                style={{ fontSize: 'clamp(1.65rem, 2.5vw, 2.15rem)', textWrap: 'balance' }}
              >
                Every positive screen tracked until a clinical outcome is documented.
              </h2>
              <p className="text-sm text-slate-100/90 leading-relaxed">
                Coordinate across screening teams, community health promoters, and receiving hospitals without replacing existing clinical EMRs.
              </p>
            </div>

            <div className="space-y-3 my-6">
              {[
                'Named case ownership and time-bound SLA reminders',
                'Distinct tracking for referral sent, facility acknowledged, and attendance',
                'Consent-led SMS and WhatsApp follow-up with opt-out safeguards',
                'Exportable audit trails aligned with Kenyan data protection standards',
              ].map((item) => (
                <div
                  key={item}
                  className="bg-white/10 backdrop-blur-sm border border-white/15 rounded-xl px-4 py-3 flex items-start gap-3 text-sm text-teal-50"
                >
                  <CheckCircle2 className="w-4 h-4 text-teal-200 shrink-0 mt-0.5" />
                  <span>{item}</span>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 text-xs text-teal-100/80">
              <ShieldCheck className="w-4 h-4 text-teal-200 shrink-0" />
              <span>Role-based access · Kenya Data Protection Act (2019) aligned</span>
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
