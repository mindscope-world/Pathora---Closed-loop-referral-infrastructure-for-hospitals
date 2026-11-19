import { useState, FormEvent } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api';
import { Alert, Button, Card, Field, Input, Select } from './ui';

const PATHWAYS = ['Cancer Screening', 'NCD Screening', 'Male Reproductive Health', 'Maternal & Child Health'];

export function DiscoverySection() {
  const [name, setName] = useState('');
  const [organization, setOrganization] = useState('');
  const [pathway, setPathway] = useState(PATHWAYS[0]);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !organization.trim()) {
      setError('Please enter your name and organization.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please enter a valid work email address.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await api.requestDiscovery({
        name: name.trim(),
        organization: organization.trim(),
        email: email.trim(),
        pathway,
      });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section id="contact" className="py-16 sm:py-20 scroll-mt-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-start">
        <div className="lg:col-span-5 space-y-3">
          <h2 className="text-3xl font-semibold tracking-tight text-ink">See it on your own pathway</h2>
          <p className="text-ink-2 leading-relaxed">
            A 30–45 minute walkthrough that maps one pathway, shows where referrals stall today, and sizes a 90-day
            pilot for your cohort.
          </p>
        </div>

        <Card className="lg:col-span-7 p-6 sm:p-8">
          {submitted ? (
            <div className="py-6 space-y-3" role="status">
              <CheckCircle2 className="size-8 text-success" />
              <h3 className="text-lg font-semibold text-ink">Request received</h3>
              <p className="text-sm text-ink-2 leading-relaxed">
                Thanks, {name.split(' ')[0]}. We’ll contact you at <span className="text-ink">{email}</span> to schedule
                a {pathway} walkthrough for {organization}.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              {error && <Alert>{error}</Alert>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Name" htmlFor="lead-name">
                  <Input id="lead-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="Organization" htmlFor="lead-org">
                  <Input
                    id="lead-org"
                    autoComplete="organization"
                    value={organization}
                    onChange={(e) => setOrganization(e.target.value)}
                  />
                </Field>
                <Field label="Work email" htmlFor="lead-email">
                  <Input
                    id="lead-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
                <Field label="Pathway" htmlFor="lead-pathway">
                  <Select id="lead-pathway" value={pathway} onChange={(e) => setPathway(e.target.value)}>
                    {PATHWAYS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <p className="text-xs text-ink-3">No commitment beyond the walkthrough.</p>
                <Button type="submit" disabled={submitting}>
                  {submitting ? 'Sending…' : 'Request a walkthrough'}
                </Button>
              </div>
            </form>
          )}
        </Card>
      </div>
    </section>
  );
}
