import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Copy, Link2, UserPlus, X } from 'lucide-react';
import {
  ROLE_LABELS,
  type InviteCreatedResponse,
  type InviteDto,
  type OrganizationDto,
  type TeamMemberDto,
  type UserRole,
} from '../../../shared/types';
import * as admin from '../../api/admin';
import { formatDate, formatDateTime } from '../../data/caseViewModel';
import type { FacilityPartner } from '../../data/dashboardData';
import { describeApiError } from '../../data/useWorkspace';

const ROLES = Object.keys(ROLE_LABELS) as UserRole[];

interface SettingsViewProps {
  /** The signed-in user: you cannot suspend or re-role yourself. */
  currentUserId: string;
  canManageOrg: boolean;
  canReadTeam: boolean;
  canManageTeam: boolean;
  /** Receiving facilities, for tying a facility focal to a site. */
  facilities: FacilityPartner[];
}

const input = 'w-full px-3 py-2 text-sm bg-[#F8FAFC] border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#009CA6] disabled:opacity-60';
const smallInput = 'px-3 py-1.5 text-xs bg-[#F8FAFC] border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#009CA6]';

export function SettingsView({ currentUserId, canManageOrg, canReadTeam, canManageTeam, facilities }: SettingsViewProps) {
  return (
    <div className="space-y-6">
      <OrganisationCard canManage={canManageOrg} />
      {canReadTeam && <TeamCard currentUserId={currentUserId} canManage={canManageTeam} facilities={facilities} />}
    </div>
  );
}

// ───────────────────────────── Organisation ─────────────────────────────

function OrganisationCard({ canManage }: { canManage: boolean }) {
  const [org, setOrg] = useState<OrganizationDto | null>(null);
  const [name, setName] = useState('');
  const [dpo, setDpo] = useState('');
  const [retention, setRetention] = useState('365');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const apply = (o: OrganizationDto) => {
    setOrg(o);
    setName(o.name);
    setDpo(o.dpoContact ?? '');
    setRetention(String(o.retentionDays));
  };

  useEffect(() => {
    let alive = true;
    admin.getOrganization().then(
      (o) => { if (alive) { apply(o); setStatus('ready'); } },
      (err) => { if (alive) { setError(describeApiError(err)); setStatus('error'); } },
    );
    return () => { alive = false; };
  }, []);

  const dirty = org !== null && (name !== org.name || dpo !== (org.dpoContact ?? '') || retention !== String(org.retentionDays));

  const save = async () => {
    if (!org || saving) return;
    const days = Number(retention);
    if (!Number.isInteger(days)) {
      setError('Retention must be a whole number of days.');
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      apply(await admin.updateOrganization({ name, dpoContact: dpo, retentionDays: days }));
      setSaved(true);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
      <div className="border-b border-slate-100 pb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-[#061B3A]">Organisation &amp; Governance Configuration</h2>
          <p className="text-xs text-slate-500 mt-0.5">Tenant isolation, data retention rules, and clinical governance contacts</p>
        </div>
        {saved && <span role="status" className="text-xs font-semibold text-emerald-700">Configuration saved</span>}
      </div>

      {status === 'loading' && <p aria-busy="true" className="text-xs text-slate-500">Loading…</p>}
      {error && <div role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">{error}</div>}

      {status === 'ready' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="org-name" className="block text-xs font-semibold text-[#061B3A] mb-1">Partner Organisation</label>
              <input id="org-name" className={input} value={name} disabled={!canManage} maxLength={160}
                onChange={(e) => { setName(e.target.value); setSaved(false); }} />
            </div>
            <div>
              <label htmlFor="org-dpo" className="block text-xs font-semibold text-[#061B3A] mb-1">Data Protection Contact</label>
              <input id="org-dpo" className={input} value={dpo} disabled={!canManage} maxLength={200} placeholder="Name (email)"
                onChange={(e) => { setDpo(e.target.value); setSaved(false); }} />
            </div>
            <div>
              <label htmlFor="org-retention" className="block text-xs font-semibold text-[#061B3A] mb-1">Audit Retention Window (Days)</label>
              <input id="org-retention" type="number" min={30} max={3650} className={`${input} font-mono`} value={retention} disabled={!canManage}
                onChange={(e) => { setRetention(e.target.value); setSaved(false); }} />
              <p className="mt-1 text-[11px] text-slate-500">Between 30 and 3650 days.</p>
            </div>
          </div>
          {canManage ? (
            <div className="flex justify-end">
              <button type="button" onClick={save} disabled={!dirty || saving}
                className="px-4 py-2 text-xs font-semibold text-white bg-[#061B3A] hover:bg-[#0B2954] disabled:opacity-50 rounded-lg transition-colors cursor-pointer">
                {saving ? 'Saving…' : 'Save Governance Settings'}
              </button>
            </div>
          ) : (
            <p className="text-xs text-slate-500">Only the Programme Manager can change these settings.</p>
          )}
        </>
      )}
    </div>
  );
}

// ───────────────────────────── Team ─────────────────────────────

function TeamCard({ currentUserId, canManage, facilities }: { currentUserId: string; canManage: boolean; facilities: FacilityPartner[] }) {
  const [members, setMembers] = useState<TeamMemberDto[]>([]);
  const [invites, setInvites] = useState<InviteDto[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      const t = await admin.getTeam();
      if (!alive.current) return;
      setMembers(t.members);
      setInvites(t.invites);
      setStatus('ready');
    } catch (err) {
      if (!alive.current) return;
      setError(describeApiError(err));
      setStatus((s) => (s === 'ready' ? s : 'error'));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void reload();
    return () => { alive.current = false; };
  }, [reload]);

  /** Runs one change, shows any failure, and refreshes the list from the server. */
  const mutate = async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      await reload();
      return true;
    } catch (err) {
      setError(describeApiError(err));
      return false;
    } finally {
      if (alive.current) setBusyId(null);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200">
        <h3 className="font-display text-base font-bold text-[#061B3A]">Role-Based Access &amp; Pilot Team</h3>
        <p className="text-xs text-slate-500 mt-0.5">Separate permissions for programme managers, coordinators, and receiving facilities</p>
      </div>

      {canManage && <InviteForm facilities={facilities} onInvited={reload} />}

      {error && <div role="alert" className="mx-5 mt-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">{error}</div>}
      {status === 'loading' && <p aria-busy="true" className="px-5 py-6 text-xs text-slate-500">Loading team…</p>}

      {status !== 'loading' && (
        <>
          <MemberTable members={members} facilities={facilities} currentUserId={currentUserId} canManage={canManage} busyId={busyId} mutate={mutate} />
          {invites.length > 0 && <InviteTable invites={invites} canManage={canManage} busyId={busyId} mutate={mutate} />}
        </>
      )}
    </div>
  );
}

function InviteForm({ facilities, onInvited }: { facilities: FacilityPartner[]; onInvited: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('PROGRAMME_COORDINATOR');
  const [facilityId, setFacilityId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InviteCreatedResponse | null>(null);
  const [copied, setCopied] = useState(false);
  // One key per attempt: a double-click sends one invitation.
  const key = useRef(crypto.randomUUID());

  const needsFacility = role === 'FACILITY_FOCAL';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (needsFacility && !facilityId) {
      setError('Choose the facility this person works at.');
      return;
    }
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const res = await admin.inviteMember({ name, email, role, ...(needsFacility ? { facilityId } : {}) }, key.current);
      key.current = crypto.randomUUID();
      setResult(res);
      setName('');
      setEmail('');
      await onInvited();
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.inviteUrl);
      setCopied(true);
    } catch {
      setCopied(false); // the field is selectable, so the link can still be copied by hand
    }
  };

  return (
    <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/60 space-y-3">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2.5">
        <div>
          <label htmlFor="invite-name" className="block text-[11px] font-semibold text-slate-600 mb-1">Name</label>
          <input id="invite-name" className={`${smallInput} w-40`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" required maxLength={120} />
        </div>
        <div>
          <label htmlFor="invite-email" className="block text-[11px] font-semibold text-slate-600 mb-1">Work email</label>
          <input id="invite-email" type="email" className={`${smallInput} w-56`} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@organisation.org" required />
        </div>
        <div>
          <label htmlFor="invite-role" className="block text-[11px] font-semibold text-slate-600 mb-1">Role</label>
          <select id="invite-role" className={smallInput} value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </div>
        {needsFacility && (
          <div>
            <label htmlFor="invite-facility" className="block text-[11px] font-semibold text-slate-600 mb-1">Facility</label>
            <select id="invite-facility" className={smallInput} value={facilityId} onChange={(e) => setFacilityId(e.target.value)} required>
              <option value="">Choose…</option>
              {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
        )}
        <button type="submit" disabled={busy}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#008E97] hover:bg-[#00767E] disabled:opacity-60 rounded-lg cursor-pointer">
          <UserPlus className="w-3.5 h-3.5" />
          <span>{busy ? 'Sending…' : 'Send Invitation'}</span>
        </button>
      </form>

      {error && <div role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">{error}</div>}

      {result && (
        <div role="status" className="text-xs bg-emerald-50 border border-emerald-200 rounded-lg p-3.5 space-y-2.5">
          <div className="flex items-start justify-between gap-3">
            <p className="text-emerald-900 leading-relaxed">
              <span className="font-semibold">Invitation created for {result.invite.name}.</span>{' '}
              {result.emailed
                ? `An email with the link was sent to ${result.invite.email}.`
                : 'Email is not set up for this workspace, so share the link below with them yourself (for example by WhatsApp).'}
            </p>
            <button type="button" onClick={() => setResult(null)} aria-label="Dismiss" className="text-emerald-700 cursor-pointer shrink-0"><X className="w-3.5 h-3.5" /></button>
          </div>
          <div className="flex items-center gap-2">
            <Link2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
            <input readOnly value={result.inviteUrl} onFocus={(e) => e.currentTarget.select()} aria-label="Invitation link"
              className="flex-1 min-w-0 px-2.5 py-1.5 font-mono text-[11px] bg-white border border-emerald-200 rounded-md" />
            <button type="button" onClick={copy} className="inline-flex items-center gap-1 px-2.5 py-1.5 font-semibold text-emerald-800 border border-emerald-300 hover:bg-emerald-100 rounded-md cursor-pointer">
              <Copy className="w-3 h-3" />{copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-emerald-800/80">The link works once and expires on {formatDate(result.invite.expiresAt)}. It is shown only now; to get a new one, invite again.</p>
        </div>
      )}
    </div>
  );
}

function MemberTable({ members, facilities, currentUserId, canManage, busyId, mutate }: {
  members: TeamMemberDto[]; facilities: FacilityPartner[]; currentUserId: string; canManage: boolean; busyId: string | null;
  mutate: (id: string, fn: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [role, setRole] = useState<UserRole>('PROGRAMME_COORDINATOR');
  const [facilityId, setFacilityId] = useState('');

  const startEdit = (m: TeamMemberDto) => {
    setConfirming(null);
    setEditing(m.id);
    setRole(m.role);
    setFacilityId(m.facility?.id ?? '');
  };

  const saveEdit = async (m: TeamMemberDto) => {
    const ok = await mutate(m.id, () =>
      admin.updateMember(m.id, { role, ...(role === 'FACILITY_FOCAL' ? { facilityId } : {}) }),
    );
    if (ok) setEditing(null);
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
            <th className="py-2.5 px-5">Name</th>
            <th className="py-2.5 px-3">Assigned Role</th>
            <th className="py-2.5 px-3">Organisation / Facility</th>
            <th className="py-2.5 px-3">Least-Privilege Scope</th>
            <th className="py-2.5 px-3 text-right">Open</th>
            <th className="py-2.5 px-5 text-right">Access</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-xs">
          {members.map((m) => {
            const isYou = m.id === currentUserId;
            const busy = busyId === m.id;
            return (
              <tr key={m.id} className={`hover:bg-slate-50/70 ${m.active ? '' : 'opacity-70'}`}>
                <td className="py-3 px-5 whitespace-nowrap">
                  <span className="font-semibold text-[#061B3A]">{m.name}</span>
                  {isYou && <span className="ml-1.5 text-[10px] font-semibold text-[#00828C]">(you)</span>}
                  <span className="block text-[11px] text-slate-500">{m.email}</span>
                  <span className="block text-[11px] text-slate-400">{m.lastLoginAt ? `Last sign-in ${formatDateTime(m.lastLoginAt)}` : 'Never signed in'}</span>
                </td>
                <td className="py-3 px-3 whitespace-nowrap">
                  {editing === m.id ? (
                    <div className="flex flex-col gap-1.5">
                      <select aria-label={`Role for ${m.name}`} className={smallInput} value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                      {role === 'FACILITY_FOCAL' && (
                        <select aria-label={`Facility for ${m.name}`} className={smallInput} value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
                          <option value="">Choose facility…</option>
                          {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                      )}
                    </div>
                  ) : (
                    <span className="font-medium text-[#00828C]">{ROLE_LABELS[m.role]}</span>
                  )}
                </td>
                <td className="py-3 px-3 text-slate-600">{m.facility?.name ?? m.affiliation ?? '—'}</td>
                <td className="py-3 px-3 text-slate-600">{m.accessScope}</td>
                <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600">{m.openCases > 0 ? m.openCases : '—'}</td>
                <td className="py-3 px-5 text-right whitespace-nowrap">
                  {editing === m.id ? (
                    <span className="inline-flex gap-1.5">
                      <button type="button" disabled={busy || (role === 'FACILITY_FOCAL' && !facilityId)} onClick={() => saveEdit(m)}
                        className="px-2.5 py-1 text-xs font-semibold text-white bg-[#008E97] disabled:opacity-50 rounded-lg cursor-pointer">Save</button>
                      <button type="button" onClick={() => setEditing(null)} className="px-2.5 py-1 text-xs text-slate-600 cursor-pointer">Cancel</button>
                    </span>
                  ) : confirming === m.id ? (
                    <span className="inline-flex flex-col items-end gap-1">
                      <span className="text-[11px] text-red-700 max-w-[11rem] whitespace-normal text-right">
                        Ends all their sessions now.{m.openCases > 0 ? ` They own ${m.openCases} open referral${m.openCases === 1 ? '' : 's'}: reassign them.` : ''}
                      </span>
                      <span className="inline-flex gap-1.5">
                        <button type="button" disabled={busy} onClick={async () => { if (await mutate(m.id, () => admin.updateMember(m.id, { active: false }))) setConfirming(null); }}
                          className="px-2.5 py-1 text-xs font-semibold text-white bg-red-700 rounded-lg cursor-pointer disabled:opacity-60">Suspend</button>
                        <button type="button" onClick={() => setConfirming(null)} className="px-2.5 py-1 text-xs text-slate-600 cursor-pointer">Cancel</button>
                      </span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      {canManage && !isYou && (
                        <button type="button" onClick={() => startEdit(m)} className="px-2 py-1 text-xs font-medium text-[#00828C] hover:text-[#061B3A] cursor-pointer">Edit</button>
                      )}
                      <button
                        type="button"
                        disabled={!canManage || isYou || busy}
                        title={isYou ? 'You cannot suspend your own account' : undefined}
                        onClick={() => (m.active ? setConfirming(m.id) : void mutate(m.id, () => admin.updateMember(m.id, { active: true })))}
                        className={`px-3 py-1 text-xs font-semibold rounded-lg border ${canManage && !isYou ? 'cursor-pointer' : 'cursor-default'} ${
                          m.active ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-slate-500 bg-slate-100 border-slate-200'
                        }`}
                      >
                        {m.active ? 'Active' : 'Suspended'}
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function InviteTable({ invites, canManage, busyId, mutate }: {
  invites: InviteDto[]; canManage: boolean; busyId: string | null; mutate: (id: string, fn: () => Promise<unknown>) => Promise<boolean>;
}) {
  return (
    <div className="border-t border-slate-200">
      <div className="px-5 py-3 bg-slate-50 border-b border-slate-200">
        <h4 className="text-xs font-bold text-[#061B3A]">Pending invitations</h4>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <tbody className="divide-y divide-slate-100 text-xs">
            {invites.map((i) => (
              <tr key={i.id}>
                <td className="py-3 px-5 whitespace-nowrap">
                  <span className="font-semibold text-[#061B3A]">{i.name}</span>
                  <span className="block text-[11px] text-slate-500">{i.email}</span>
                </td>
                <td className="py-3 px-3 font-medium text-[#00828C] whitespace-nowrap">
                  {ROLE_LABELS[i.role]}
                  {i.facility && <span className="block text-[11px] font-normal text-slate-500">{i.facility.name}</span>}
                </td>
                <td className="py-3 px-3 text-slate-600 whitespace-nowrap">Invited by {i.invitedBy}</td>
                <td className="py-3 px-3 whitespace-nowrap">
                  <span className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-semibold ${
                    i.status === 'PENDING' ? 'text-amber-800 bg-amber-50 border-amber-200' : 'text-slate-600 bg-slate-50 border-slate-200'
                  }`}>
                    {i.status === 'PENDING' ? `Expires ${formatDate(i.expiresAt)}` : 'Expired'}
                  </span>
                </td>
                <td className="py-3 px-5 text-right">
                  {canManage && (
                    <button type="button" disabled={busyId === i.id} onClick={() => void mutate(i.id, () => admin.revokeInvite(i.id))}
                      className="px-3 py-1 text-xs font-medium text-red-700 border border-red-200 hover:bg-red-50 rounded-lg cursor-pointer disabled:opacity-60">
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

