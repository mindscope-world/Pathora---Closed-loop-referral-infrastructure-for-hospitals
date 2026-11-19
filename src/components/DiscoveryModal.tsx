import { useEffect, useState, FormEvent } from 'react';
import { X, CheckCircle2, ArrowRight } from 'lucide-react';
import { PathoraMark } from './PathoraMark';
import { submitLead } from '../api/leads';
import { ApiError } from '../lib/api';

interface DiscoveryModalProps {
  isOpen: boolean;
  initialPathway?: string;
  onClose: () => void;
}

const PATHWAY_CHOICES = [
  'Cancer Screening',
  'NCD Screening',
  'Male Reproductive Health',
  'Maternal & Child Health',
];

export function DiscoveryModal({ isOpen, initialPathway, onClose }: DiscoveryModalProps) {
  const [name, setName] = useState('');
  const [organization, setOrganization] = useState('');
  const [email, setEmail] = useState('');
  const [pathway, setPathway] = useState(initialPathway || PATHWAY_CHOICES[0]);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [website, setWebsite] = useState(''); // honeypot: hidden from people, filled in by bots

  useEffect(() => {
    if (initialPathway) {
      setPathway(initialPathway);
    }
  }, [initialPathway]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
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
      await submitLead({ name: name.trim(), organization: organization.trim(), email: email.trim(), pathway, website });
      setSubmitted(true);
    } catch (err) {
      if (err instanceof ApiError) {
        const first = Object.values(err.fieldErrors)[0];
        setError(
          first ??
            (err.status === 429
              ? 'Too many requests from this network. Please try again later.'
              : err.status >= 500
              ? 'Something went wrong on our side. Please try again.'
              : err.message),
        );
      } else {
        setError('Could not reach the server. Check your connection and try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const resetAndClose = () => {
    setSubmitted(false);
    setError(null);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#061B3A]/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="discovery-modal-title"
      onClick={resetAndClose}
    >
      <div
        className="relative w-full max-w-lg bg-white rounded-[1.5rem] border border-slate-200 shadow-2xl p-6 sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <PathoraMark variant="light" />
          <button
            type="button"
            onClick={resetAndClose}
            aria-label="Close modal"
            className="w-9 h-9 rounded-full border border-slate-200 flex items-center justify-center text-slate-500 hover:text-[#061B3A] hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {submitted ? (
          <div className="py-6 space-y-5">
            <div className="w-12 h-12 rounded-2xl bg-[#009CA6]/12 text-[#00828C] flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div className="space-y-2">
              <h3 id="discovery-modal-title" className="font-display text-xl font-bold text-[#061B3A]">
                Walkthrough Request Received
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Thank you. Our team will contact you to arrange a 30–45 minute discovery session for{' '}
                <span className="font-semibold text-[#061B3A]">{organization}</span> focusing on{' '}
                <span className="font-semibold text-[#00828C]">{pathway}</span>.
              </p>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-600 space-y-1">
              <p>Next step: Confirm your clinical lead, data protection contact, and receiving facility route during discovery.</p>
            </div>
            <button
              type="button"
              onClick={resetAndClose}
              className="w-full py-3 text-sm font-semibold text-white bg-[#061B3A] hover:bg-[#0B2954] rounded-full transition-colors cursor-pointer"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="pt-5 space-y-4">
            <div>
              <h3 id="discovery-modal-title" className="font-display text-xl font-bold text-[#061B3A]">
                Schedule a Discovery Walkthrough
              </h3>
              <p className="text-sm text-slate-600 mt-1">
                30–45 minutes with your programme, clinical, and digital health leads to map one screening-to-care pathway.
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5"
              >
                {error}
              </div>
            )}

            <div className="space-y-3">
              {/* Honeypot: off-screen and skipped by keyboard and screen readers. */}
              <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                <label htmlFor="modal-website">Website</label>
                <input id="modal-website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
              </div>
              <div>
                <label htmlFor="modal-name" className="block text-xs font-semibold text-[#061B3A] mb-1">
                  Your Name
                </label>
                <input
                  id="modal-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Pauline Kamau"
                  className="w-full px-3.5 py-2.5 text-sm bg-[#F8FAFC] border border-slate-200 rounded-xl text-[#061B3A] focus:outline-none focus:ring-2 focus:ring-[#009CA6]"
                />
              </div>

              <div>
                <label htmlFor="modal-org" className="block text-xs font-semibold text-[#061B3A] mb-1">
                  Organization / Facility
                </label>
                <input
                  id="modal-org"
                  type="text"
                  required
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder="Screening Programme or Hospital"
                  className="w-full px-3.5 py-2.5 text-sm bg-[#F8FAFC] border border-slate-200 rounded-xl text-[#061B3A] focus:outline-none focus:ring-2 focus:ring-[#009CA6]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="modal-email" className="block text-xs font-semibold text-[#061B3A] mb-1">
                    Work Email
                  </label>
                  <input
                    id="modal-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@org.org"
                    className="w-full px-3.5 py-2.5 text-sm bg-[#F8FAFC] border border-slate-200 rounded-xl text-[#061B3A] focus:outline-none focus:ring-2 focus:ring-[#009CA6]"
                  />
                </div>
                <div>
                  <label htmlFor="modal-pathway" className="block text-xs font-semibold text-[#061B3A] mb-1">
                    Target Pathway
                  </label>
                  <select
                    id="modal-pathway"
                    value={pathway}
                    onChange={(e) => setPathway(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm bg-[#F8FAFC] border border-slate-200 rounded-xl text-[#061B3A] focus:outline-none focus:ring-2 focus:ring-[#009CA6]"
                  >
                    {PATHWAY_CHOICES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={resetAndClose}
                className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:text-[#061B3A] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#008E97] hover:bg-[#00767E] disabled:opacity-60 rounded-full transition-colors cursor-pointer"
              >
                <span>{submitting ? 'Sending…' : 'Confirm Request'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
