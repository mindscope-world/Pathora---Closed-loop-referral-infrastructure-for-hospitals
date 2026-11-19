import { useState } from 'react';
import { Download, ShieldCheck, CheckCircle2, UserPlus } from 'lucide-react';
import { AuditEvent, ReferralCase, TeamMember } from '../../data/dashboardData';

interface AuditViewProps {
  auditEvents: AuditEvent[];
  cases: ReferralCase[];
  onExportLogged: (exportType: string) => void;
}

function triggerCsvDownload(filename: string, rows: string[][]) {
  const csvContent = rows
    .map((row) =>
      row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')
    )
    .join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function AuditView({ auditEvents, cases, onExportLogged }: AuditViewProps) {
  const [search, setSearch] = useState('');

  const filteredEvents = auditEvents.filter((ev) => {
    const q = search.trim().toLowerCase();
    return (
      !q ||
      ev.action.toLowerCase().includes(q) ||
      ev.actor.toLowerCase().includes(q) ||
      ev.resourceId.toLowerCase().includes(q) ||
      ev.detail.toLowerCase().includes(q)
    );
  });

  const exportCasesCsv = () => {
    const header = [
      'Case ID',
      'Patient Code',
      'Pathway',
      'Source Program',
      'Coordinator',
      'Receiving Facility',
      'Stage',
      'Status',
      'Referral Issued',
      'Facility Ack',
      'Patient Attended',
      'Outcome Documented',
      'Closure Reason',
    ];
    const body = cases.map((c) => [
      c.id,
      c.patientCode,
      c.pathway,
      c.sourceProgram,
      c.coordinator,
      c.receivingFacility,
      c.stage,
      c.status,
      c.milestones.referralIssuedAt,
      c.milestones.facilityAcknowledgedAt ?? '',
      c.milestones.patientAttendedAt ?? '',
      c.milestones.outcomeDocumentedAt ?? '',
      c.closureReason ?? '',
    ]);
    triggerCsvDownload('pathora-live-referrals.csv', [header, ...body]);
    onExportLogged('Live Referral Cohort CSV');
  };

  const exportAuditCsv = () => {
    const header = ['Event ID', 'Timestamp', 'Actor', 'Role', 'Action', 'Resource ID', 'Detail'];
    const body = auditEvents.map((ev) => [
      ev.id,
      ev.timestamp,
      ev.actor,
      ev.role,
      ev.action,
      ev.resourceId,
      ev.detail,
    ]);
    triggerCsvDownload('pathora-audit-trail.csv', [header, ...body]);
    onExportLogged('Immutable Audit Trail CSV');
  };

  return (
    <div className="space-y-6">
      {/* Export & Compliance Header */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-4">
          <div>
            <h2 className="font-display text-base font-bold text-[#061B3A]">
              Programme Reporting &amp; Audit Exports
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Download auditable closed-loop evidence for funders, clinical governance committees, and regulatory inspections.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={exportCasesCsv}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#008E97] hover:bg-[#00767E] rounded-lg transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Referral Cohort (CSV)</span>
            </button>
            <button
              type="button"
              onClick={exportAuditCsv}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-[#061B3A] bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Immutable Audit Log (CSV)</span>
            </button>
          </div>
        </div>

        <div className="lg:col-span-5 bg-[#061B3A] text-white rounded-xl p-5 space-y-2.5">
          <div className="flex items-center gap-2 text-teal-200 text-xs font-semibold">
            <ShieldCheck className="w-4 h-4" />
            <span>Regulatory &amp; Data Protection Controls</span>
          </div>
          <ul className="space-y-1.5 text-xs text-slate-200">
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-teal-300 shrink-0" />
              <span>Kenya Data Protection Act (2019) &amp; Digital Health Act (2023) aligned</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-teal-300 shrink-0" />
              <span>Least-privilege RBAC &amp; segregated sensitive identifiers</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-teal-300 shrink-0" />
              <span>Immutable timestamped log for all consent &amp; status events</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-sm font-bold text-[#061B3A]">
              Immutable Governance &amp; Access Trail
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Every intake, handoff, consent change, escalation, and closure event
            </p>
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by case ID, actor, or action..."
            className="px-3 py-1.5 text-xs bg-[#F8FAFC] border border-slate-200 rounded-lg text-[#061B3A] w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-[#009CA6]"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                <th className="py-2.5 px-5">Timestamp</th>
                <th className="py-2.5 px-3">Actor &amp; Role</th>
                <th className="py-2.5 px-3">Event Type</th>
                <th className="py-2.5 px-3">Case / Resource</th>
                <th className="py-2.5 px-5">Recorded Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredEvents.map((ev) => (
                <tr key={ev.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-5 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                    {ev.timestamp}
                  </td>
                  <td className="py-3 px-3 whitespace-nowrap">
                    <span className="font-medium text-[#061B3A]">{ev.actor}</span>
                    <span className="block text-[11px] text-slate-500">{ev.role}</span>
                  </td>
                  <td className="py-3 px-3 font-mono text-[11px] font-semibold text-[#00828C] whitespace-nowrap">
                    {ev.action}
                  </td>
                  <td className="py-3 px-3 font-mono font-medium text-[#061B3A] whitespace-nowrap">
                    {ev.resourceId}
                  </td>
                  <td className="py-3 px-5 text-slate-700">{ev.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface SettingsViewProps {
  team: TeamMember[];
  onToggleMemberActive: (id: string) => void;
  onAddTeamMember: (member: Omit<TeamMember, 'id' | 'active'>) => void;
}

export function SettingsView({
  team,
  onToggleMemberActive,
  onAddTeamMember,
}: SettingsViewProps) {
  const [orgName, setOrgName] = useState('Nairobi Preventive Screening Network');
  const [dpoContact, setDpoContact] = useState('David Kamau (dpo@partner-network.org)');
  const [retentionDays, setRetentionDays] = useState('365');
  const [savedNotice, setSavedNotice] = useState(false);

  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<TeamMember['role']>('Programme Coordinator');
  const [newOrg, setNewOrg] = useState('Nairobi Screening Programme');

  const handleAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    onAddTeamMember({
      name: newName.trim(),
      role: newRole,
      organization: newOrg.trim() || 'Partner Organization',
      accessScope:
        newRole === 'Receiving Facility Focal'
          ? 'Acknowledges referrals & returns authorized outcome data'
          : newRole === 'Partner Clinical Lead'
          ? 'Approves pathway rules, red flags & closure criteria'
          : 'Coordinates active referral follow-up & SLA queues',
    });
    setNewName('');
  };

  return (
    <div className="space-y-6">
      {/* Organisation & Pilot Configuration */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
        <div className="border-b border-slate-100 pb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-bold text-[#061B3A]">
              Organisation &amp; Governance Configuration
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Tenant isolation, data retention rules, and clinical governance contacts
            </p>
          </div>
          {savedNotice && (
            <span className="text-xs font-semibold text-emerald-700">
              Configuration saved
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-[#061B3A] mb-1">
              Partner Organisation
            </label>
            <input
              type="text"
              value={orgName}
              onChange={(e) => {
                setOrgName(e.target.value);
                setSavedNotice(false);
              }}
              className="w-full px-3 py-2 text-sm bg-[#F8FAFC] border border-slate-200 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#061B3A] mb-1">
              Data Protection Contact
            </label>
            <input
              type="text"
              value={dpoContact}
              onChange={(e) => {
                setDpoContact(e.target.value);
                setSavedNotice(false);
              }}
              className="w-full px-3 py-2 text-sm bg-[#F8FAFC] border border-slate-200 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#061B3A] mb-1">
              Audit Retention Window (Days)
            </label>
            <input
              type="number"
              value={retentionDays}
              onChange={(e) => {
                setRetentionDays(e.target.value);
                setSavedNotice(false);
              }}
              className="w-full px-3 py-2 text-sm font-mono bg-[#F8FAFC] border border-slate-200 rounded-lg"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setSavedNotice(true)}
            className="px-4 py-2 text-xs font-semibold text-white bg-[#061B3A] hover:bg-[#0B2954] rounded-lg transition-colors cursor-pointer"
          >
            Save Governance Settings
          </button>
        </div>
      </div>

      {/* Role-Based Access Control Directory */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h3 className="font-display text-base font-bold text-[#061B3A]">
              Role-Based Access &amp; Pilot Team
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Separate permissions for programme managers, coordinators, and receiving facilities
            </p>
          </div>

          <form onSubmit={handleAddMember} className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New team member name"
              className="px-3 py-1.5 text-xs bg-[#F8FAFC] border border-slate-200 rounded-lg"
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as TeamMember['role'])}
              className="px-3 py-1.5 text-xs bg-[#F8FAFC] border border-slate-200 rounded-lg"
            >
              <option value="Programme Coordinator">Programme Coordinator</option>
              <option value="Receiving Facility Focal">Receiving Facility Focal</option>
              <option value="Partner Clinical Lead">Partner Clinical Lead</option>
              <option value="Programme Manager">Programme Manager</option>
              <option value="Data Protection Contact">Data Protection Contact</option>
            </select>
            <input
              type="text"
              value={newOrg}
              onChange={(e) => setNewOrg(e.target.value)}
              placeholder="Site / Org"
              className="px-3 py-1.5 text-xs bg-[#F8FAFC] border border-slate-200 rounded-lg w-36"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#008E97] hover:bg-[#00767E] rounded-lg cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Add User</span>
            </button>
          </form>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                <th className="py-2.5 px-5">Name</th>
                <th className="py-2.5 px-3">Assigned Role</th>
                <th className="py-2.5 px-3">Organisation / Facility</th>
                <th className="py-2.5 px-3">Least-Privilege Scope</th>
                <th className="py-2.5 px-5 text-right">Access</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {team.map((member) => (
                <tr key={member.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-5 font-semibold text-[#061B3A] whitespace-nowrap">
                    {member.name}
                  </td>
                  <td className="py-3 px-3 font-medium text-[#00828C] whitespace-nowrap">
                    {member.role}
                  </td>
                  <td className="py-3 px-3 text-slate-600">{member.organization}</td>
                  <td className="py-3 px-3 text-slate-600">{member.accessScope}</td>
                  <td className="py-3 px-5 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => onToggleMemberActive(member.id)}
                      className={`px-3 py-1 text-xs font-semibold rounded-lg border cursor-pointer ${
                        member.active
                          ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                          : 'text-slate-500 bg-slate-100 border-slate-200'
                      }`}
                    >
                      {member.active ? 'Active' : 'Suspended'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
