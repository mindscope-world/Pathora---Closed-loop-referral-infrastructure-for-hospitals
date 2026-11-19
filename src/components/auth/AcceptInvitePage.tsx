import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { ROLE_LABELS, type InviteLookupResponse } from '../../../shared/types';
import { useAuth } from '../../auth/AuthProvider';
import { authApi, ApiError } from '../../lib/api';
import { PathoraMark } from '../PathoraMark';
import { describeAuthError } from './authForm';

interface Props {
  token: string;
  onSuccess: () => void;
  onBackToSite: () => void;
}

/** Where someone lands from an invitation link: confirms what they are joining, then lets them choose a password. */
export function AcceptInvitePage({ token, onSuccess, onBackToSite }: Props) {
  const { acceptInvite } = useAuth();
  const [invite, setInvite] = useState<InviteLookupResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'invalid' | 'error'>('loading');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    // POST with the token in the body: it never appears in a URL, so it stays out of access logs.
    authApi<InviteLookupResponse>('/invites/lookup', { token }).then(
      (res) => { if (alive) { setInvite(res); setName(res.name); setState('ready'); } },
      (err) => { if (alive) setState(err instanceof ApiError && (err.status === 410 || err.status === 400) ? 'invalid' : 'error'); },
    );
    return () => { alive = false; };
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await acceptInvite({ token, password, name });
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVITE_INVALID') {
        setState('invalid');
      } else {
        const d = describeAuthError(err);
        setError(d.message);
        setFieldErrors(d.fields);
      }
      setBusy(false);
    }
  };

  const fieldClass = 'w-full px-4 py-3 text-sm bg-[#F8FAFC] border border-slate-200 rounded-xl text-[#061B3A] focus:outline-none focus:ring-2 focus:ring-[#009CA6]';

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#061B3A] flex flex-col justify-between p-4 sm:p-6 lg:p-8">
      <div className="max-w-[1200px] w-full mx-auto">
        <button type="button" onClick={onBackToSite} className="cursor-pointer rounded-lg" aria-label="Back to Pathora website">
          <PathoraMark variant="light" />
        </button>
      </div>

      <main className="max-w-md w-full mx-auto my-8">
        <div className="bg-white border border-slate-200/90 rounded-[2rem] p-7 sm:p-10 shadow-sm space-y-6">
          {state === 'loading' && <p aria-busy="true" className="text-sm text-slate-600">Checking your invitation…</p>}

          {state === 'invalid' && (
            <div className="space-y-3">
              <h1 className="font-display text-2xl font-bold">This invitation is no longer valid</h1>
              <p className="text-sm text-slate-600 leading-relaxed">
                It may have expired, been used already, or been replaced by a newer one. Ask your programme manager to send you a new invitation.
              </p>
              <button type="button" onClick={onBackToSite} className="text-sm font-semibold text-[#00828C] hover:text-[#061B3A] cursor-pointer">Back to website →</button>
            </div>
          )}

          {state === 'error' && (
            <div className="space-y-3">
              <h1 className="font-display text-2xl font-bold">Something went wrong</h1>
              <p className="text-sm text-slate-600">We could not check your invitation. Please check your connection and reload this page.</p>
            </div>
          )}

          {state === 'ready' && invite && (
            <>
              <div className="space-y-2">
                <p className="text-xs font-semibold text-[#00828C]">You&apos;re invited</p>
                <h1 className="font-display font-bold tracking-tight" style={{ fontSize: 'clamp(1.5rem, 3vw, 2rem)' }}>
                  Join {invite.organization}
                </h1>
                <p className="text-sm text-slate-600 leading-relaxed">
                  {invite.invitedBy} invited you as <span className="font-semibold text-[#061B3A]">{ROLE_LABELS[invite.role]}</span>. Choose a password to set up your account.
                </p>
              </div>

              <form onSubmit={submit} className="space-y-4">
                <div>
                  <label htmlFor="invite-email" className="block text-xs font-semibold mb-1.5">Email</label>
                  <input id="invite-email" className={`${fieldClass} text-slate-500`} value={invite.email} readOnly />
                </div>
                <div>
                  <label htmlFor="invite-name" className="block text-xs font-semibold mb-1.5">Your name</label>
                  <input id="invite-name" className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoComplete="name" />
                  {fieldErrors.name && <p role="alert" className="mt-1 text-xs text-red-700">{fieldErrors.name}</p>}
                </div>
                <div>
                  <label htmlFor="invite-password" className="block text-xs font-semibold mb-1.5">Choose a password</label>
                  <input id="invite-password" type="password" className={fieldClass} value={password} onChange={(e) => setPassword(e.target.value)}
                    required minLength={12} autoComplete="new-password" placeholder="At least 12 characters" />
                  {fieldErrors.password && <p role="alert" className="mt-1 text-xs text-red-700">{fieldErrors.password}</p>}
                </div>

                {error && <div role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</div>}

                <button type="submit" disabled={busy}
                  className="w-full inline-flex items-center justify-center gap-2 py-3.5 px-6 text-sm font-semibold text-white bg-[#008E97] hover:bg-[#00767E] disabled:opacity-60 rounded-full transition-colors shadow-sm cursor-pointer">
                  <span>{busy ? 'Creating your account…' : 'Create Account & Enter Dashboard'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>

              <div className="flex items-center gap-2 text-xs text-slate-500">
                <ShieldCheck className="w-4 h-4 text-[#00828C] shrink-0" />
                <span>This link works once. Only you will know your password.</span>
              </div>
            </>
          )}
        </div>
      </main>

      <footer className="max-w-[1200px] w-full mx-auto text-center text-xs text-slate-500">
        © {new Date().getFullYear()} Pathora · Closing the gap between screening and care.
      </footer>
    </div>
  );
}
