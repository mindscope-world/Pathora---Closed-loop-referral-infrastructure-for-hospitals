import { useState, FormEvent, ReactNode } from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { PathoraMark } from '../PathoraMark';
import { Alert, Button, Card, Field, Input, cn } from '../ui';
import { api } from '../../lib/api';

export interface AuthUserSession {
  name: string;
  role: string;
  organization: string;
  email: string;
}

interface AuthLayoutProps {
  onBackToSite: () => void;
  children: ReactNode;
  width?: 'sm' | 'md';
}

/** Shared frame for the sign-in and sign-up screens: quiet top bar, centred card, footer note. */
export function AuthLayout({ onBackToSite, children, width = 'sm' }: AuthLayoutProps) {
  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col">
      <header className="w-full max-w-[1120px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBackToSite}
          className="rounded-md cursor-pointer"
          aria-label="Back to Pathora website"
        >
          <PathoraMark variant="light" />
        </button>
        <Button variant="ghost" size="sm" onClick={onBackToSite}>
          <ArrowLeft />
          <span>Back to website</span>
        </Button>
      </header>

      <main className="flex-1 flex items-start sm:items-center justify-center px-4 py-8 sm:py-12">
        <div className={cn('w-full', width === 'md' ? 'max-w-[520px]' : 'max-w-[400px]')}>{children}</div>
      </main>

      <footer className="px-4 pb-6 flex flex-col items-center gap-1.5 text-xs text-ink-3 text-center">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="size-3.5" aria-hidden="true" />
          Role-based access · Aligned with the Kenya Data Protection Act (2019)
        </span>
        <span>© {new Date().getFullYear()} Pathora</span>
      </footer>
    </div>
  );
}

interface LoginPageProps {
  onSuccess: (user: AuthUserSession) => void;
  onGoToSignup: () => void;
  onBackToSite: () => void;
}

export function LoginPage({ onSuccess, onGoToSignup, onBackToSite }: LoginPageProps) {
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
    <AuthLayout onBackToSite={onBackToSite}>
      <Card className="p-6 sm:p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-ink">Sign in to Pathora</h1>
          <p className="mt-1.5 text-sm text-ink-2">
            Pick up your referral queue, facility acknowledgments and reporting.
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {error && <Alert>{error}</Alert>}

          <Field label="Work email" htmlFor="login-email">
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@organization.org"
              className="h-10"
            />
          </Field>

          <Field label="Password" htmlFor="login-password">
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className="h-10"
            />
          </Field>

          <Button type="submit" size="lg" disabled={submitting} className="w-full mt-2">
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <div className="mt-5 rounded-md bg-subtle px-3.5 py-3 text-[13px] text-ink-2">
          <p className="font-medium text-ink">Demo account</p>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <dt className="text-ink-3">Email</dt>
            <dd className="font-mono text-xs leading-5 text-ink break-words">
              coordinator@
              <wbr />
              nairobi-screening.org
            </dd>
            <dt className="text-ink-3">Password</dt>
            <dd className="font-mono text-xs leading-5 text-ink">pathora-demo</dd>
          </dl>
          <button
            type="button"
            onClick={() => {
              setEmail('coordinator@nairobi-screening.org');
              setPassword('pathora-demo');
              setError(null);
            }}
            className="mt-1 font-medium text-brand hover:text-brand-hover cursor-pointer"
          >
            Use demo account
          </button>
        </div>
      </Card>

      <p className="mt-5 text-center text-sm text-ink-2">
        New to Pathora?{' '}
        <button
          type="button"
          onClick={onGoToSignup}
          className="font-medium text-brand hover:text-brand-hover cursor-pointer"
        >
          Create an account
        </button>
      </p>
    </AuthLayout>
  );
}
