import { useEffect, useState, FormEvent } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api';
import { Alert, Button, Field, Input, Modal, Select } from './ui';

interface DiscoveryModalProps {
  isOpen: boolean;
  initialPathway?: string;
  onClose: () => void;
}

const PATHWAY_CHOICES = ['Cancer Screening', 'NCD Screening', 'Male Reproductive Health', 'Maternal & Child Health'];

export function DiscoveryModal({ isOpen, initialPathway, onClose }: DiscoveryModalProps) {
  const [name, setName] = useState('');
  const [organization, setOrganization] = useState('');
  const [email, setEmail] = useState('');
  const [pathway, setPathway] = useState(initialPathway || PATHWAY_CHOICES[0]);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (initialPathway) {
      setPathway(initialPathway);
    }
  }, [initialPathway]);

  if (!isOpen) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    if (!name.trim() || !organization.trim()) {
      setError('Please enter your name and organization.');
      return;
    }
    if (!emailValid) {
      setError('Please provide a valid work email address.');
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

  const resetAndClose = () => {
    setSubmitted(false);
    setError(null);
    onClose();
  };

  if (submitted) {
    return (
      <Modal title="Request received" onClose={resetAndClose}>
        <div className="space-y-4" role="status">
          <CheckCircle2 className="size-8 text-success" />
          <p className="text-sm text-ink-2 leading-relaxed">
            We’ll be in touch at <span className="text-ink">{email}</span> to schedule a{' '}
            <span className="text-ink">{pathway}</span> walkthrough for{' '}
            <span className="text-ink">{organization}</span>. Bring your clinical lead and data protection contact if
            you can.
          </p>
          <div className="flex justify-end">
            <Button onClick={resetAndClose}>Done</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Book a walkthrough"
      description="30–45 minutes to map one screening-to-care pathway with your team."
      onClose={resetAndClose}
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Your name" htmlFor="modal-name">
          <Input id="modal-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Organization or facility" htmlFor="modal-org">
          <Input
            id="modal-org"
            autoComplete="organization"
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Work email" htmlFor="modal-email">
            <Input
              id="modal-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Pathway" htmlFor="modal-pathway">
            <Select id="modal-pathway" value={pathway} onChange={(e) => setPathway(e.target.value)}>
              {PATHWAY_CHOICES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={resetAndClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Sending…' : 'Request walkthrough'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
