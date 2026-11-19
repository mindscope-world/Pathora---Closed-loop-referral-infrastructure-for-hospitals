import { useEffect, useState, FormEvent } from 'react';
import {
  LayoutDashboard,
  ClipboardList,
  Building2,
  AlertTriangle,
  MessageSquare,
  GitBranch,
  FileCheck2,
  Settings,
  LogOut,
  Plus,
  Upload,
  Menu,
  X,
  Search,
} from 'lucide-react';
import { PathoraMark } from '../PathoraMark';
import { AuthUserSession } from '../auth/LoginPage';
import { INITIAL_FACILITIES, PathwayName, ReferralCase } from '../../data/dashboardData';
import { api, Workspace } from '../../lib/api';
import {
  Alert,
  Badge,
  Button,
  Field,
  Input,
  Modal,
  Select,
  StatusBadge,
  Textarea,
  cn,
  controlClass,
  useEscape,
} from '../ui';
import { OverviewView } from './OverviewView';
import { CasesView } from './CasesView';
import { FacilitiesView } from './FacilitiesView';
import { EscalationsView } from './EscalationsView';
import { CommsConsentView } from './CommsConsentView';
import { PathwaysView } from './PathwaysView';
import { AuditView, SettingsView } from './AuditSettingsViews';

export type DashboardTab =
  | 'overview'
  | 'cases'
  | 'facilities'
  | 'escalations'
  | 'comms'
  | 'pathways'
  | 'audit'
  | 'settings';

interface DashboardShellProps {
  currentUser?: AuthUserSession | null;
  onExitDashboard: () => void;
}

export function DashboardShell({ currentUser, onExitDashboard }: DashboardShellProps) {
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Core Workspace Data (loaded from and persisted by the Pathora API)
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const cases = workspace?.cases ?? [];
  const facilities = workspace?.facilities ?? [];
  const commsLog = workspace?.commsLog ?? [];
  const rulePacks = workspace?.rulePacks ?? [];
  const auditEvents = workspace?.auditEvents ?? [];
  const team = workspace?.team ?? [];

  const loadWorkspace = () => {
    setLoadError(null);
    api
      .getWorkspace()
      .then(setWorkspace)
      .catch((err: unknown) =>
        setLoadError(err instanceof Error ? err.message : 'Could not load the workspace.')
      );
  };

  useEffect(loadWorkspace, []);

  /** Run a workspace mutation, replace local state with the server's copy, surface errors. */
  const runAction = async (action: () => Promise<Workspace>): Promise<boolean> => {
    try {
      setWorkspace(await action());
      setActionError(null);
      return true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'That action could not be completed.');
      return false;
    }
  };

  // Global Header Search State
  const [globalQuery, setGlobalQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  // Selected Case Drawer & Modals
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [newCaseModalOpen, setNewCaseModalOpen] = useState(false);
  const [csvModalOpen, setCsvModalOpen] = useState(false);

  // Case Detail Closure Form State
  const [closureReasonInput, setClosureReasonInput] = useState(
    'Clinical evaluation completed & care plan documented'
  );
  const [outcomeSourceInput, setOutcomeSourceInput] = useState('');

  // New Case Form State
  const [newPatientName, setNewPatientName] = useState('');
  const [newPatientCode, setNewPatientCode] = useState('');
  const [newPatientLabel, setNewPatientLabel] = useState('');
  const [newPathway, setNewPathway] = useState<PathwayName>('Cancer Screening');
  const [newSourceProgram, setNewSourceProgram] = useState('Nairobi Mobile Screening');
  const [newCoordinator, setNewCoordinator] = useState('Miriam Wanjiku');
  const [newFacility, setNewFacility] = useState(INITIAL_FACILITIES[0].name);
  const [newRedFlag, setNewRedFlag] = useState(false);
  const [newConsentSms, setNewConsentSms] = useState(true);
  const [newCaseError, setNewCaseError] = useState<string | null>(null);
  const [newCaseSubmitting, setNewCaseSubmitting] = useState(false);

  // CSV Import State
  const [csvText, setCsvText] = useState(
    'PT-8850,Cohort NBO · F / 47,Cancer Screening,Nairobi Mobile Cervical Screening,Miriam Wanjiku,Kenyatta Referral Outpatient Desk\nPT-8851,Cohort MBA · M / 55,NCD Screening,Coastal Preventive Health Drive,Amina Salim,Pwani Regional Care Hospital'
  );
  const [csvFeedback, setCsvFeedback] = useState<string | null>(null);
  const [csvFeedbackIsError, setCsvFeedbackIsError] = useState(false);

  const selectedCase = cases.find((c) => c.id === selectedCaseId) ?? null;

  // Case Actions
  const handleAcknowledgeCase = (caseId: string) => {
    void runAction(() => api.acknowledgeCase(caseId));
  };

  const handleConfirmAttendance = (caseId: string) => {
    void runAction(() => api.confirmAttendance(caseId));
  };

  const handleDocumentClosure = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedCase) return;
    const ok = await runAction(() =>
      api.closeCase(selectedCase.id, closureReasonInput, outcomeSourceInput.trim())
    );
    if (ok) setOutcomeSourceInput('');
  };

  const handleEscalateToClinicalLead = (caseId: string, reason: string) => {
    void runAction(() => api.escalateCase(caseId, reason));
  };

  const handleLogBarrierResolution = (caseId: string, barrierNote: string) => {
    void runAction(() => api.logBarrierResolution(caseId, barrierNote));
  };

  const handleReassignOwner = (caseId: string, newOwner: string) => {
    void runAction(() => api.reassignOwner(caseId, newOwner));
  };

  const handleSendMessage = (
    caseId: string,
    channel: 'SMS' | 'WhatsApp',
    templateName: string
  ) => {
    void runAction(() => api.sendMessage(caseId, channel, templateName));
  };

  const handleToggleOptOut = (caseId: string) => {
    void runAction(() => api.toggleOptOut(caseId));
  };

  const handleUpdateRulePackSla = (
    id: string,
    ackSlaHours: number,
    evalTargetDays: number
  ) => {
    void runAction(() => api.updateRulePack(id, ackSlaHours, evalTargetDays));
  };

  const handleCreateNewCase = async (e: FormEvent) => {
    e.preventDefault();
    if (!newPatientCode.trim() && !newPatientName.trim()) {
      setNewCaseError('Please enter a patient name or identifier code.');
      return;
    }

    setNewCaseSubmitting(true);
    try {
      const next = await api.createCase({
        patientName: newPatientName.trim(),
        patientCode: newPatientCode.trim(),
        patientLabel: newPatientLabel.trim(),
        pathway: newPathway,
        sourceProgram: newSourceProgram,
        coordinator: newCoordinator,
        receivingFacility: newFacility,
        redFlag: newRedFlag,
        consentSms: newConsentSms,
      });
      setWorkspace(next);
      setNewPatientName('');
      setNewPatientCode('');
      setNewPatientLabel('');
      setNewRedFlag(false);
      setNewCaseError(null);
      setNewCaseModalOpen(false);
      setActiveTab('cases');
    } catch (err) {
      setNewCaseError(err instanceof Error ? err.message : 'Could not create the case.');
    } finally {
      setNewCaseSubmitting(false);
    }
  };

  const handleCsvImport = async (e: FormEvent) => {
    e.preventDefault();
    if (!csvText.trim()) {
      setCsvFeedbackIsError(true);
      setCsvFeedback('Please enter at least one CSV row to import.');
      return;
    }

    try {
      const result = await api.importCsv(csvText);
      setWorkspace(result.workspace);
      setCsvFeedbackIsError(false);
      setCsvFeedback(`Successfully imported ${result.importedCount} cases into the active queue.`);
      setTimeout(() => {
        setCsvFeedback(null);
        setCsvModalOpen(false);
        setActiveTab('cases');
      }, 900);
    } catch (err) {
      setCsvFeedbackIsError(true);
      setCsvFeedback(err instanceof Error ? err.message : 'Could not import the CSV batch.');
    }
  };

  const overdueCount = cases.filter((c) => c.status === 'Overdue SLA').length;
  const awaitingAckCount = cases.filter((c) => c.status === 'Awaiting Ack').length;

  const NAV_GROUPS: Array<{
    label: string;
    items: Array<{ id: DashboardTab; label: string; icon: typeof LayoutDashboard; count?: number; urgent?: boolean }>;
  }> = [
    {
      label: 'Workspace',
      items: [
        { id: 'overview', label: 'Overview', icon: LayoutDashboard },
        { id: 'cases', label: 'Referrals', icon: ClipboardList, count: cases.length },
        { id: 'facilities', label: 'Facility desk', icon: Building2, count: awaitingAckCount },
        { id: 'escalations', label: 'Escalations', icon: AlertTriangle, count: overdueCount, urgent: true },
      ],
    },
    {
      label: 'Operations',
      items: [
        { id: 'comms', label: 'Patient comms', icon: MessageSquare },
        { id: 'pathways', label: 'Pathway rules', icon: GitBranch },
      ],
    },
    {
      label: 'Governance',
      items: [
        { id: 'audit', label: 'Audit & exports', icon: FileCheck2 },
        { id: 'settings', label: 'Team & settings', icon: Settings },
      ],
    },
  ];

  const activeLabel =
    NAV_GROUPS.flatMap((g) => g.items).find((n) => n.id === activeTab)?.label ?? 'Overview';

  const userName = currentUser?.name || 'Workspace user';
  const initials = userName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

  const SidebarContent = (
    <div className="flex flex-col h-full w-60 bg-surface border-r border-line">
      <div className="h-14 px-4 flex items-center justify-between border-b border-line">
        <PathoraMark variant="light" />
        <button
          type="button"
          onClick={() => setMobileNavOpen(false)}
          className="lg:hidden p-1.5 rounded-md text-ink-3 hover:text-ink hover:bg-subtle"
          aria-label="Close navigation"
        >
          <X className="size-4" />
        </button>
      </div>

      <nav aria-label="Dashboard" className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="px-2 mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-3">{group.label}</p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = item.id === activeTab;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileNavOpen(false);
                    }}
                    className={cn(
                      'w-full h-8 px-2 flex items-center gap-2.5 rounded-md text-sm transition-colors cursor-pointer',
                      isActive ? 'bg-brand-soft text-brand-ink font-medium' : 'text-ink-2 hover:bg-subtle hover:text-ink'
                    )}
                  >
                    <Icon className={cn('size-4 shrink-0', isActive ? 'text-brand' : 'text-ink-3')} />
                    <span className="flex-1 text-left truncate">{item.label}</span>
                    {typeof item.count === 'number' && item.count > 0 && (
                      <span
                        className={cn(
                          'min-w-5 h-5 px-1.5 rounded-full text-[11px] font-medium tabular-nums flex items-center justify-center',
                          item.urgent ? 'bg-danger-soft text-danger' : 'bg-subtle text-ink-2'
                        )}
                      >
                        {item.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="p-3 border-t border-line flex items-center gap-2.5">
        <span className="size-8 shrink-0 rounded-full bg-brand-soft text-brand-ink text-xs font-semibold flex items-center justify-center">
          {initials || 'P'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink truncate">{userName}</p>
          <p className="text-xs text-ink-3 truncate">{currentUser?.role || 'Programme Coordinator'}</p>
        </div>
        <button
          type="button"
          onClick={onExitDashboard}
          title="Sign out"
          aria-label="Sign out"
          className="p-1.5 rounded-md text-ink-3 hover:text-ink hover:bg-subtle cursor-pointer"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </div>
  );

  const trimmedQuery = globalQuery.trim().toLowerCase();
  const searchMatches = trimmedQuery
    ? cases.filter(
        (c) =>
          c.patientName.toLowerCase().includes(trimmedQuery) ||
          c.id.toLowerCase().includes(trimmedQuery) ||
          c.patientCode.toLowerCase().includes(trimmedQuery)
      )
    : [];

  return (
    <div className="min-h-screen flex bg-canvas text-ink">
      <aside className="hidden lg:block shrink-0 sticky top-0 h-screen">{SidebarContent}</aside>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex bg-ink/40" onClick={() => setMobileNavOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="h-full">
            {SidebarContent}
          </div>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 h-14 bg-surface/95 backdrop-blur border-b border-line px-4 sm:px-6 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="lg:hidden p-1.5 -ml-1.5 rounded-md text-ink-2 hover:bg-subtle cursor-pointer"
            aria-label="Open navigation"
          >
            <Menu className="size-5" />
          </button>

          {/* Each view renders its own page title; this label is for screen readers only. */}
          <span className="sr-only">{activeLabel}</span>

          <div className="relative flex-1 min-w-0 max-w-sm">
            <Search className="size-4 text-ink-3 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={globalQuery}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 160)}
              onChange={(e) => {
                setGlobalQuery(e.target.value);
                setSearchFocused(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setGlobalQuery('');
                  setSearchFocused(false);
                } else if (e.key === 'Enter' && searchMatches.length > 0) {
                  e.preventDefault();
                  setSelectedCaseId(searchMatches[0].id);
                  setGlobalQuery('');
                  setSearchFocused(false);
                }
              }}
              placeholder="Find patient or referral ID"
              aria-label="Find a referral by patient name or ID"
              className={cn(controlClass, 'h-8 pl-8 bg-canvas')}
            />

            {searchFocused && trimmedQuery.length > 0 && (
              <div className="absolute right-0 left-0 sm:left-auto sm:w-96 mt-1.5 bg-surface border border-line rounded-lg shadow-overlay overflow-hidden z-50">
                {searchMatches.length === 0 ? (
                  <p className="px-4 py-3 text-[13px] text-ink-3">No referrals match “{globalQuery}”.</p>
                ) : (
                  <ul className="max-h-80 overflow-y-auto py-1">
                    {searchMatches.map((match) => (
                      <li key={match.id}>
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setSelectedCaseId(match.id);
                            setGlobalQuery('');
                            setSearchFocused(false);
                          }}
                          className="w-full text-left px-3.5 py-2 hover:bg-subtle flex items-center justify-between gap-3 cursor-pointer"
                        >
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-ink truncate">{match.patientName}</span>
                            <span className="block text-xs text-ink-3 truncate">
                              <span className="font-mono">{match.id}</span> · {match.pathway}
                            </span>
                          </span>
                          <StatusBadge status={match.status} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2 shrink-0">
            <span className="hidden md:contents">
              <Button variant="secondary" size="sm" onClick={() => setCsvModalOpen(true)}>
                <Upload />
                Import CSV
              </Button>
            </span>
            <Button size="sm" onClick={() => setNewCaseModalOpen(true)}>
              <Plus />
              <span className="hidden sm:inline">Log positive screen</span>
              <span className="sm:hidden">New</span>
            </Button>
          </div>
        </header>

        <main className="flex-1 px-4 sm:px-6 py-6 max-w-[1280px] w-full mx-auto">
          {actionError && (
            <div className="mb-4">
              <Alert onDismiss={() => setActionError(null)}>{actionError}</Alert>
            </div>
          )}
          {!workspace && (
            <div className="py-24 text-center space-y-3">
              {loadError ? (
                <>
                  <p className="text-sm text-danger">{loadError}</p>
                  <Button variant="secondary" size="sm" onClick={loadWorkspace}>
                    Try again
                  </Button>
                </>
              ) : (
                <p className="text-sm text-ink-3">Loading workspace…</p>
              )}
            </div>
          )}
          {workspace && activeTab === 'overview' && (
            <OverviewView
              cases={cases}
              onSelectCase={(c) => setSelectedCaseId(c.id)}
              onNavigate={(tab) => setActiveTab(tab)}
            />
          )}
          {workspace && activeTab === 'cases' && (
            <CasesView
              cases={cases}
              onSelectCase={(c) => setSelectedCaseId(c.id)}
              onOpenNewCase={() => setNewCaseModalOpen(true)}
              onOpenCsvImport={() => setCsvModalOpen(true)}
            />
          )}
          {workspace && activeTab === 'facilities' && (
            <FacilitiesView
              facilities={facilities}
              cases={cases}
              onAcknowledgeCase={handleAcknowledgeCase}
              onConfirmAttendance={handleConfirmAttendance}
              onSelectCase={(c) => setSelectedCaseId(c.id)}
            />
          )}
          {workspace && activeTab === 'escalations' && (
            <EscalationsView
              cases={cases}
              onEscalateToClinicalLead={handleEscalateToClinicalLead}
              onLogBarrierResolution={handleLogBarrierResolution}
              onSelectCase={(c) => setSelectedCaseId(c.id)}
            />
          )}
          {workspace && activeTab === 'comms' && (
            <CommsConsentView
              cases={cases}
              commsLog={commsLog}
              onSendMessage={handleSendMessage}
              onToggleOptOut={handleToggleOptOut}
            />
          )}
          {workspace && activeTab === 'pathways' && (
            <PathwaysView rulePacks={rulePacks} onUpdateRulePackSla={handleUpdateRulePackSla} />
          )}
          {workspace && activeTab === 'audit' && (
            <AuditView
              auditEvents={auditEvents}
              cases={cases}
              onExportLogged={(exportType) => {
                void runAction(() => api.logExport(exportType));
              }}
            />
          )}
          {workspace && activeTab === 'settings' && (
            <SettingsView
              team={team}
              onToggleMemberActive={(id) => {
                void runAction(() => api.toggleTeamMember(id));
              }}
              onAddTeamMember={(member) => {
                void runAction(() => api.addTeamMember(member));
              }}
            />
          )}
        </main>
      </div>

      {selectedCase && (
        <CaseDrawer
          referral={selectedCase}
          onClose={() => setSelectedCaseId(null)}
          onReassign={(owner) => handleReassignOwner(selectedCase.id, owner)}
          onAcknowledge={() => handleAcknowledgeCase(selectedCase.id)}
          onConfirmAttendance={() => handleConfirmAttendance(selectedCase.id)}
          closureReason={closureReasonInput}
          onClosureReasonChange={setClosureReasonInput}
          outcomeSource={outcomeSourceInput}
          onOutcomeSourceChange={setOutcomeSourceInput}
          onSubmitClosure={handleDocumentClosure}
        />
      )}

      {newCaseModalOpen && (
        <Modal
          title="Log positive screen"
          description="Creates a tracked referral and notifies the receiving facility."
          onClose={() => setNewCaseModalOpen(false)}
          size="lg"
        >
          <form onSubmit={handleCreateNewCase} className="space-y-4">
            {newCaseError && <Alert>{newCaseError}</Alert>}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Patient name" htmlFor="nc-name">
                <Input id="nc-name" value={newPatientName} onChange={(e) => setNewPatientName(e.target.value)} placeholder="Grace Mutua" />
              </Field>
              <Field label="Identifier code" htmlFor="nc-code">
                <Input id="nc-code" value={newPatientCode} onChange={(e) => setNewPatientCode(e.target.value)} placeholder="Auto if blank" className="font-mono" />
              </Field>
              <Field label="Cohort note" htmlFor="nc-label">
                <Input id="nc-label" value={newPatientLabel} onChange={(e) => setNewPatientLabel(e.target.value)} placeholder="NBO · F / 41" />
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Pathway" htmlFor="nc-pathway">
                <Select id="nc-pathway" value={newPathway} onChange={(e) => setNewPathway(e.target.value as PathwayName)}>
                  <option value="Cancer Screening">Cancer Screening</option>
                  <option value="NCD Screening">NCD Screening</option>
                  <option value="Male Reproductive Health">Male Reproductive Health</option>
                </Select>
              </Field>
              <Field label="Named owner" htmlFor="nc-owner">
                <Select id="nc-owner" value={newCoordinator} onChange={(e) => setNewCoordinator(e.target.value)}>
                  {COORDINATORS.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Screening programme" htmlFor="nc-source">
                <Input id="nc-source" value={newSourceProgram} onChange={(e) => setNewSourceProgram(e.target.value)} />
              </Field>
              <Field label="Receiving facility" htmlFor="nc-facility">
                <Select id="nc-facility" value={newFacility} onChange={(e) => setNewFacility(e.target.value)}>
                  {facilities.map((f) => (
                    <option key={f.id} value={f.name}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-2">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={newConsentSms} onChange={(e) => setNewConsentSms(e.target.checked)} className="size-4 accent-brand" />
                SMS follow-up consent recorded
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={newRedFlag} onChange={(e) => setNewRedFlag(e.target.checked)} className="size-4 accent-danger" />
                Clinical red flag
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-line -mx-6 px-6 -mb-5 pb-5 mt-5 pt-4">
              <Button variant="secondary" onClick={() => setNewCaseModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={newCaseSubmitting}>
                {newCaseSubmitting ? 'Creating…' : 'Create referral'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {csvModalOpen && (
        <Modal
          title="Import referrals from CSV"
          description="One referral per line: patient code, cohort, pathway, source programme, owner, facility."
          onClose={() => setCsvModalOpen(false)}
        >
          <form onSubmit={handleCsvImport} className="space-y-4">
            <Textarea
              rows={6}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              className="font-mono text-xs leading-5"
              aria-label="CSV rows"
            />
            {csvFeedback && <Alert tone={csvFeedbackIsError ? 'danger' : 'success'}>{csvFeedback}</Alert>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCsvModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Import referrals</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

const COORDINATORS = ['Miriam Wanjiku', 'Peter Omondi', 'Amina Salim'];

const CLOSURE_REASONS = [
  'Clinical evaluation completed & care plan documented',
  'Confirmatory diagnostic negative · Returned to routine screening',
  'Patient declined further care (documented consent)',
];

interface CaseDrawerProps {
  referral: ReferralCase;
  onClose: () => void;
  onReassign: (owner: string) => void;
  onAcknowledge: () => void;
  onConfirmAttendance: () => void;
  closureReason: string;
  onClosureReasonChange: (v: string) => void;
  outcomeSource: string;
  onOutcomeSourceChange: (v: string) => void;
  onSubmitClosure: (e: FormEvent) => void;
}

function CaseDrawer({
  referral,
  onClose,
  onReassign,
  onAcknowledge,
  onConfirmAttendance,
  closureReason,
  onClosureReasonChange,
  outcomeSource,
  onOutcomeSourceChange,
  onSubmitClosure,
}: CaseDrawerProps) {
  useEscape(onClose);
  const m = referral.milestones;
  const timeline = [
    { label: 'Referral issued', ts: m.referralIssuedAt },
    { label: 'Facility acknowledged', ts: m.facilityAcknowledgedAt },
    { label: 'Patient attended', ts: m.patientAttendedAt },
    { label: 'Evaluation completed', ts: m.evaluationCompletedAt },
    { label: 'Outcome documented', ts: m.outcomeDocumentedAt },
  ];
  const isClosed = referral.status === 'Closed Verified';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/30" onClick={onClose} role="presentation">
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="case-drawer-title"
        className="w-full max-w-[520px] h-full bg-surface border-l border-line shadow-overlay flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-line flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-ink-3">{referral.id}</span>
              <StatusBadge status={referral.status} />
              {referral.redFlag && <Badge tone="danger">Red flag</Badge>}
            </div>
            <h2 id="case-drawer-title" className="text-lg font-semibold text-ink">
              {referral.patientName}
            </h2>
            <p className="text-[13px] text-ink-3">
              {referral.pathway} · {referral.patientLabel} · <span className="font-mono">{referral.patientCode}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close case details"
            className="-mr-1.5 p-1.5 rounded-md text-ink-3 hover:text-ink hover:bg-subtle cursor-pointer"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <section className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
            <Field label="Named owner" htmlFor="drawer-owner">
              <Select id="drawer-owner" value={referral.coordinator} onChange={(e) => onReassign(e.target.value)}>
                {[...new Set([referral.coordinator, ...COORDINATORS])].map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="space-y-1.5">
              <p className="text-[13px] font-medium text-ink">Receiving facility</p>
              <p className="text-ink-2 leading-9 truncate" title={referral.receivingFacility}>
                {referral.receivingFacility}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-[13px] font-medium text-ink">Source programme</p>
              <p className="text-ink-2">{referral.sourceProgram}</p>
            </div>
            <div className="space-y-1">
              <p className="text-[13px] font-medium text-ink">Follow-up consent</p>
              <p className="text-ink-2">
                {referral.optedOut
                  ? 'Opted out — human contact only'
                  : [referral.consentSms && 'SMS', referral.consentWhatsApp && 'WhatsApp'].filter(Boolean).join(', ') || 'None recorded'}
              </p>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-[13px] font-medium text-ink">Timeline</h3>
            <ol className="relative border-l border-line ml-1.5 space-y-3">
              {timeline.map((t) => (
                <li key={t.label} className="pl-4 relative">
                  <span
                    className={cn(
                      'absolute -left-[5px] top-1.5 size-2.5 rounded-full border-2 border-surface',
                      t.ts ? 'bg-brand' : 'bg-line-strong'
                    )}
                    aria-hidden="true"
                  />
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className={t.ts ? 'text-ink' : 'text-ink-3'}>{t.label}</span>
                    <span className="text-xs tabular-nums text-ink-3">{t.ts ?? 'Pending'}</span>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-[13px] font-medium text-ink">Notes</h3>
            <p className="text-sm text-ink-2 leading-relaxed">{referral.notes}</p>
          </section>

          {isClosed ? (
            <section className="rounded-lg border border-success-line bg-success-soft px-4 py-3 text-sm space-y-0.5">
              <p className="font-medium text-success">Verified outcome recorded</p>
              <p className="text-ink">{referral.closureReason}</p>
              <p className="text-ink-2 text-[13px]">Source: {referral.outcomeSource}</p>
            </section>
          ) : (
            <section className="space-y-4 pt-5 border-t border-line">
              {(!m.facilityAcknowledgedAt || !m.patientAttendedAt) && (
                <div className="flex flex-wrap gap-2">
                  {!m.facilityAcknowledgedAt && (
                    <Button variant="secondary" size="sm" onClick={onAcknowledge}>
                      Record facility acknowledgment
                    </Button>
                  )}
                  {!m.patientAttendedAt && (
                    <Button variant="secondary" size="sm" onClick={onConfirmAttendance}>
                      Confirm attendance
                    </Button>
                  )}
                </div>
              )}

              <form onSubmit={onSubmitClosure} className="space-y-3">
                <h3 className="text-[13px] font-medium text-ink">Close with verified outcome</h3>
                <Field label="Closure reason" htmlFor="drawer-reason">
                  <Select id="drawer-reason" value={closureReason} onChange={(e) => onClosureReasonChange(e.target.value)}>
                    {CLOSURE_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Outcome source" htmlFor="drawer-source" hint="Clinician or facility desk that confirmed the outcome.">
                  <Input
                    id="drawer-source"
                    value={outcomeSource}
                    onChange={(e) => onOutcomeSourceChange(e.target.value)}
                    placeholder={`Focal clinician, ${referral.receivingFacility}`}
                  />
                </Field>
                <Button type="submit" variant="success" className="w-full">
                  Verify outcome & close referral
                </Button>
              </form>
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}
