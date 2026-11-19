import { useState, type FormEvent } from 'react';
import { Download, Search, UserPlus } from 'lucide-react';
import { AuditEvent, ReferralCase, TeamMember } from '../../data/dashboardData';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  cn,
  controlClass,
  table,
} from '../ui';

interface AuditViewProps {
  auditEvents: AuditEvent[];
  cases: ReferralCase[];
  onExportLogged: (exportType: string) => void;
}

function triggerCsvDownload(filename: string, rows: string[][]) {
  const csvContent = rows
    .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
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

  const q = search.trim().toLowerCase();
  const filteredEvents = auditEvents.filter(
    (ev) =>
      !q ||
      ev.action.toLowerCase().includes(q) ||
      ev.actor.toLowerCase().includes(q) ||
      ev.resourceId.toLowerCase().includes(q) ||
      ev.detail.toLowerCase().includes(q)
  );

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
    const body = auditEvents.map((ev) => [ev.id, ev.timestamp, ev.actor, ev.role, ev.action, ev.resourceId, ev.detail]);
    triggerCsvDownload('pathora-audit-trail.csv', [header, ...body]);
    onExportLogged('Immutable Audit Trail CSV');
  };

  return (
    <div>
      <PageHeader
        title="Audit & exports"
        description="Every intake, handoff, consent change, escalation and closure, timestamped and attributed."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={exportCasesCsv}>
              <Download />
              Referrals CSV
            </Button>
            <Button variant="secondary" size="sm" onClick={exportAuditCsv}>
              <Download />
              Audit log CSV
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line">
          <p className="text-[13px] text-ink-2">
            <span className="font-medium text-ink tabular-nums">{filteredEvents.length}</span>{' '}
            {filteredEvents.length === 1 ? 'event' : 'events'}
          </p>
          <div className="relative w-full sm:w-72">
            <Search className="size-4 text-ink-3 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by referral, person or action"
              aria-label="Filter audit events"
              className={cn(controlClass, 'h-8 pl-8')}
            />
          </div>
        </div>

        {filteredEvents.length === 0 ? (
          <EmptyState title="No matching events" description="Try a different referral ID, name or action." />
        ) : (
          <div className={table.wrap}>
            <table className={table.table}>
              <thead className={table.thead}>
                <tr>
                  <th className={table.th}>Time</th>
                  <th className={table.th}>Person</th>
                  <th className={table.th}>Action</th>
                  <th className={table.th}>Resource</th>
                  <th className={table.th}>Detail</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((ev) => (
                  <tr key={ev.id} className={table.tr}>
                    <td className={cn(table.td, 'text-ink-2 tabular-nums whitespace-nowrap')}>{ev.timestamp}</td>
                    <td className={cn(table.td, 'whitespace-nowrap')}>
                      <span className="block font-medium">{ev.actor}</span>
                      <span className="block text-xs text-ink-3">{ev.role}</span>
                    </td>
                    <td className={table.td}>
                      <Badge className="font-mono text-[11px]">{ev.action}</Badge>
                    </td>
                    <td className={cn(table.td, 'font-mono text-xs whitespace-nowrap')}>{ev.resourceId}</td>
                    <td className={cn(table.td, 'text-ink-2 min-w-[260px]')}>{ev.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

interface SettingsViewProps {
  team: TeamMember[];
  onToggleMemberActive: (id: string) => void;
  onAddTeamMember: (member: Omit<TeamMember, 'id' | 'active'>) => void;
}

const ROLE_OPTIONS: TeamMember['role'][] = [
  'Programme Coordinator',
  'Receiving Facility Focal',
  'Partner Clinical Lead',
  'Programme Manager',
  'Data Protection Contact',
];

export function SettingsView({ team, onToggleMemberActive, onAddTeamMember }: SettingsViewProps) {
  const [orgName, setOrgName] = useState('Nairobi Preventive Screening Network');
  const [dpoContact, setDpoContact] = useState('David Kamau (dpo@partner-network.org)');
  const [retentionDays, setRetentionDays] = useState('365');
  const [savedNotice, setSavedNotice] = useState(false);

  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<TeamMember['role']>('Programme Coordinator');
  const [newOrg, setNewOrg] = useState('Nairobi Screening Programme');

  const handleAddMember = (e: FormEvent) => {
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

  const markDirty = () => setSavedNotice(false);

  return (
    <div className="space-y-5">
      <PageHeader title="Team & settings" description="Who can access this workspace, and how your organisation's data is governed." />

      <Card className="overflow-hidden">
        <CardHeader
          title="Team"
          description="Each role sees only what it needs."
          action={<span className="text-[13px] text-ink-3 tabular-nums">{team.filter((m) => m.active).length} active</span>}
        />
        <div className={cn(table.wrap, 'border-t border-line')}>
          <table className={table.table}>
            <thead className={table.thead}>
              <tr>
                <th className={table.th}>Name</th>
                <th className={table.th}>Role</th>
                <th className={table.th}>Organisation</th>
                <th className={table.th}>Access scope</th>
                <th className={cn(table.th, 'text-right')}>Access</th>
              </tr>
            </thead>
            <tbody>
              {team.map((member) => (
                <tr key={member.id} className={cn(table.tr, !member.active && 'text-ink-3')}>
                  <td className={cn(table.td, 'font-medium whitespace-nowrap', !member.active && 'text-ink-3')}>
                    {member.name}
                  </td>
                  <td className={cn(table.td, 'whitespace-nowrap', member.active ? 'text-ink-2' : 'text-ink-3')}>
                    {member.role}
                  </td>
                  <td className={cn(table.td, member.active ? 'text-ink-2' : 'text-ink-3')}>{member.organization}</td>
                  <td className={cn(table.td, 'text-ink-3 min-w-[220px]')}>{member.accessScope}</td>
                  <td className={cn(table.td, 'text-right whitespace-nowrap')}>
                    <span className="inline-flex items-center gap-2">
                      <Badge tone={member.active ? 'success' : 'neutral'} dot>
                        {member.active ? 'Active' : 'Suspended'}
                      </Badge>
                      <Button variant="ghost" size="sm" onClick={() => onToggleMemberActive(member.id)}>
                        {member.active ? 'Suspend' : 'Restore'}
                      </Button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <Card>
          <CardHeader title="Add team member" />
          <form onSubmit={handleAddMember} className="px-5 pb-5 space-y-3">
            <Field label="Name" htmlFor="tm-name">
              <Input id="tm-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Full name" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Role" htmlFor="tm-role">
                <Select id="tm-role" value={newRole} onChange={(e) => setNewRole(e.target.value as TeamMember['role'])}>
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Organisation" htmlFor="tm-org">
                <Input id="tm-org" value={newOrg} onChange={(e) => setNewOrg(e.target.value)} placeholder="Site or organisation" />
              </Field>
            </div>
            <div className="flex justify-end pt-1">
              <Button type="submit" variant="secondary" size="sm" disabled={!newName.trim()}>
                <UserPlus />
                Add member
              </Button>
            </div>
          </form>
        </Card>

        <Card>
          <CardHeader
            title="Organisation & governance"
            action={savedNotice ? <Badge tone="success">Saved</Badge> : undefined}
          />
          <div className="px-5 pb-5 space-y-3">
            <Field label="Partner organisation" htmlFor="org-name">
              <Input
                id="org-name"
                value={orgName}
                onChange={(e) => {
                  setOrgName(e.target.value);
                  markDirty();
                }}
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Data protection contact" htmlFor="org-dpo">
                <Input
                  id="org-dpo"
                  value={dpoContact}
                  onChange={(e) => {
                    setDpoContact(e.target.value);
                    markDirty();
                  }}
                />
              </Field>
              <Field label="Audit retention (days)" htmlFor="org-retention">
                <Input
                  id="org-retention"
                  type="number"
                  value={retentionDays}
                  onChange={(e) => {
                    setRetentionDays(e.target.value);
                    markDirty();
                  }}
                  className="tabular-nums"
                />
              </Field>
            </div>
            <div className="flex justify-end pt-1">
              <Button variant="secondary" size="sm" onClick={() => setSavedNotice(true)}>
                Save settings
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
