import { useState, FormEvent } from 'react';
import { AuthLayout, AuthUserSession } from './LoginPage';
import { Alert, Button, Card, Field, Input, Select } from '../ui';
import { api } from '../../lib/api';

interface SignupPageProps {
  onSuccess: (user: AuthUserSession) => void;
  onGoToLogin: () => void;
  onBackToSite: () => void;
}

export function SignupPage({ onSuccess, onGoToLogin, onBackToSite }: SignupPageProps) {
  const [fullName, setFullName] = useState('');
  const [organization, setOrganization] = useState('');
  const [role, setRole] = useState('Programme Manager');
  const [pathway, setPathway] = useState('Cancer Screening');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !organization.trim()) {
      setError('Please enter your full name and organization.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please provide a valid work email address.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const user = await api.signup({
        name: fullName.trim(),
        organization: organization.trim(),
        email: email.trim(),
        password,
        role,
        primaryPathway: pathway,
      });
      onSuccess(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your account.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout onBackToSite={onBackToSite} width="md">
      <Card className="p-6 sm:p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-ink">Create your Pathora account</h1>
          <p className="mt-1.5 text-sm text-ink-2">
            Set up a workspace for your programme. You can invite your team afterwards.
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {error && <Alert>{error}</Alert>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Full name" htmlFor="signup-name">
              <Input
                id="signup-name"
                type="text"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Dr. Amina Ochieng"
                className="h-10"
              />
            </Field>
            <Field label="Organization or facility" htmlFor="signup-org">
              <Input
                id="signup-org"
                type="text"
                autoComplete="organization"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                placeholder="Screening NGO or hospital"
                className="h-10"
              />
            </Field>

            <Field label="Your role" htmlFor="signup-role">
              <Select id="signup-role" value={role} onChange={(e) => setRole(e.target.value)} className="h-10">
                <option value="Programme Manager">Programme Manager</option>
                <option value="Programme Coordinator">Programme Coordinator</option>
                <option value="Partner Clinical Lead">Partner Clinical Lead</option>
                <option value="Receiving Facility Focal">Receiving Facility Focal</option>
              </Select>
            </Field>
            <Field label="Primary care pathway" htmlFor="signup-pathway">
              <Select id="signup-pathway" value={pathway} onChange={(e) => setPathway(e.target.value)} className="h-10">
                <option value="Cancer Screening">Cancer Screening</option>
                <option value="NCD Screening">NCD Screening</option>
                <option value="Male Reproductive Health">Male Reproductive Health</option>
              </Select>
            </Field>
          </div>

          <Field label="Work email" htmlFor="signup-email">
            <Input
              id="signup-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@organization.org"
              className="h-10"
            />
          </Field>

          <Field label="Password" htmlFor="signup-password" hint="At least 8 characters.">
            <Input
              id="signup-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Create a password"
              className="h-10"
            />
          </Field>

          <Button type="submit" size="lg" disabled={submitting} className="w-full mt-2">
            {submitting ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
      </Card>

      <p className="mt-5 text-center text-sm text-ink-2">
        Already have an account?{' '}
        <button
          type="button"
          onClick={onGoToLogin}
          className="font-medium text-brand hover:text-brand-hover cursor-pointer"
        >
          Sign in
        </button>
      </p>
    </AuthLayout>
  );
}
