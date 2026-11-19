import { useState, FormEvent } from 'react';
import {
  LayoutDashboard,
  ClipboardList,
  Building2,
  AlertTriangle,
  MessageSquare,
  GitBranch,
  FileCheck2,
  Settings,
  ArrowLeft,
  Plus,
  Upload,
  Menu,
  X,
  CheckCircle2,
  Clock,
  Search,
} from 'lucide-react';
import { PathoraMark } from '../PathoraMark';
import { AuthUserSession } from '../auth/LoginPage';
import {
  AuditEvent,
  CommsLogEntry,
  INITIAL_AUDIT_EVENTS,
  INITIAL_CASES,
  INITIAL_COMMS_LOG,
  INITIAL_FACILITIES,
  INITIAL_RULE_PACKS,
  INITIAL_TEAM,
  PathwayName,
  PathwayRulePack,
  ReferralCase,
  TeamMember,
} from '../../data/dashboardData';
import { OverviewView } from './OverviewView';
import { CasesView } from './CasesView';
import { FacilitiesView } from './FacilitiesView';
import { EscalationsView } from './EscalationsView';
import { CommsConsentView } from './CommsConsentView';
import { PathwaysView } from './PathwaysView';
import { AuditView, SettingsView } from './AuditSettingsViews';
import { ReferralProgressTracker, deriveReferralJourney } from './ReferralProgressTracker';

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

function nowTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(
    now.getHours()
  )}:${pad(now.getMinutes())}`;
}

export function DashboardShell({ currentUser, onExitDashboard }: DashboardShellProps) {
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Core Stateful Workspace Data
  const [cases, setCases] = useState<ReferralCase[]>(INITIAL_CASES);
  const [facilities] = useState(INITIAL_FACILITIES);
  const [commsLog, setCommsLog] = useState<CommsLogEntry[]>(INITIAL_COMMS_LOG);
  const [rulePacks, setRulePacks] = useState<PathwayRulePack[]>(INITIAL_RULE_PACKS);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>(INITIAL_AUDIT_EVENTS);
  const [team, setTeam] = useState<TeamMember[]>(INITIAL_TEAM);

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

  // CSV Import State
  const [csvText, setCsvText] = useState(
    'PT-8850,Cohort NBO · F / 47,Cancer Screening,Nairobi Mobile Cervical Screening,Miriam Wanjiku,Kenyatta Referral Outpatient Desk\nPT-8851,Cohort MBA · M / 55,NCD Screening,Coastal Preventive Health Drive,Amina Salim,Pwani Regional Care Hospital'
  );
  const [csvFeedback, setCsvFeedback] = useState<string | null>(null);

  const selectedCase = cases.find((c) => c.id === selectedCaseId) ?? null;

  const appendAudit = (
    actor: string,
    role: string,
    action: string,
    resourceId: string,
    detail: string
  ) => {
    setAuditEvents((prev) => [
      {
        id: `AUD-${500 + prev.length + 1}`,
        timestamp: nowTimestamp(),
        actor,
        role,
        action,
        resourceId,
        detail,
      },
      ...prev,
    ]);
  };

  // Case Actions
  const handleAcknowledgeCase = (caseId: string) => {
    const ts = nowTimestamp();
    setCases((prev) =>
      prev.map((c) =>
        c.id === caseId
          ? {
              ...c,
              stage: 'Acknowledged',
              status: c.status === 'Overdue SLA' ? 'Active' : 'Active',
              milestones: { ...c.milestones, facilityAcknowledgedAt: ts },
            }
          : c
      )
    );
    appendAudit(
      'Receiving Facility Focal',
      'Receiving Facility Focal',
      'FACILITY_ACKNOWLEDGED',
      caseId,
      'Confirmed referral receipt via Receiving Facility Desk.'
    );
  };

  const handleConfirmAttendance = (caseId: string) => {
    const ts = nowTimestamp();
    setCases((prev) =>
      prev.map((c) =>
        c.id === caseId
          ? {
              ...c,
              stage: 'Attended',
              status: 'Active',
              milestones: {
                ...c.milestones,
                facilityAcknowledgedAt: c.milestones.facilityAcknowledgedAt ?? ts,
                patientAttendedAt: ts,
              },
            }
          : c
      )
    );
    appendAudit(
      'Receiving Facility Focal',
      'Receiving Facility Focal',
      'ATTENDANCE_CONFIRMED',
      caseId,
      'Confirmed patient clinical attendance at receiving facility.'
    );
  };

  const handleDocumentClosure = (e: FormEvent) => {
    e.preventDefault();
    if (!selectedCase) return;
    const source = outcomeSourceInput.trim() || `${selectedCase.receivingFacility} Focal`;
    const ts = nowTimestamp();

    setCases((prev) =>
      prev.map((c) =>
        c.id === selectedCase.id
          ? {
              ...c,
              stage: 'Closed',
              status: 'Closed Verified',
              slaHoursRemaining: 0,
              closureReason: closureReasonInput,
              outcomeSource: source,
              milestones: {
                ...c.milestones,
                facilityAcknowledgedAt: c.milestones.facilityAcknowledgedAt ?? ts,
                patientAttendedAt: c.milestones.patientAttendedAt ?? ts,
                evaluationCompletedAt: c.milestones.evaluationCompletedAt ?? ts,
                outcomeDocumentedAt: ts,
              },
            }
          : c
      )
    );

    appendAudit(
      source,
      'Receiving Facility Focal',
      'OUTCOME_VERIFIED_CLOSURE',
      selectedCase.id,
      `Closed case with verified outcome: ${closureReasonInput}`
    );
    setOutcomeSourceInput('');
  };

  const handleEscalateToClinicalLead = (caseId: string, reason: string) => {
    setCases((prev) =>
      prev.map((c) =>
        c.id === caseId
          ? {
              ...c,
              stage: 'Escalated',
              status: 'Overdue SLA',
              notes: `${c.notes} | Escalated: ${reason}`,
            }
          : c
      )
    );
    appendAudit(
      'System SLA Monitor',
      'Programme Coordinator',
      'SLA_ESCALATION_TRIGGERED',
      caseId,
      reason
    );
  };

  const handleLogBarrierResolution = (caseId: string, barrierNote: string) => {
    setCases((prev) =>
      prev.map((c) =>
        c.id === caseId
          ? {
              ...c,
              status: 'Active',
              stage: c.stage === 'Escalated' ? 'Contacted' : c.stage,
              slaHoursRemaining: 24,
              notes: `Resolution logged: ${barrierNote}`,
            }
          : c
      )
    );
    appendAudit(
      'Miriam Wanjiku',
      'Programme Coordinator',
      'BARRIER_RESOLUTION_LOGGED',
      caseId,
      barrierNote
    );
  };

  const handleReassignOwner = (caseId: string, newOwner: string) => {
    setCases((prev) =>
      prev.map((c) => (c.id === caseId ? { ...c, coordinator: newOwner } : c))
    );
    appendAudit(
      'Programme Manager',
      'Programme Manager',
      'CASE_REASSIGNED',
      caseId,
      `Named ownership transferred to ${newOwner}.`
    );
  };

  const handleSendMessage = (
    caseId: string,
    channel: 'SMS' | 'WhatsApp',
    templateName: string
  ) => {
    const target = cases.find((c) => c.id === caseId);
    if (!target) return;
    const status = target.optedOut ? 'Blocked (Opt-out)' : 'Delivered';

    setCommsLog((prev) => [
      {
        id: `MSG-${900 + prev.length + 1}`,
        caseId,
        patientCode: target.patientCode,
        channel,
        templateName,
        deliveryStatus: status,
        timestamp: nowTimestamp(),
      },
      ...prev,
    ]);

    appendAudit(
      target.coordinator,
      'Programme Coordinator',
      target.optedOut ? 'MESSAGE_BLOCKED_OPTOUT' : 'DISCREET_MESSAGE_SENT',
      caseId,
      target.optedOut
        ? `Blocked ${channel} template (${templateName}) due to recorded patient opt-out.`
        : `Sent discreet ${channel} template "${templateName}".`
    );
  };

  const handleToggleOptOut = (caseId: string) => {
    const target = cases.find((c) => c.id === caseId);
    if (!target) return;
    const nextOptOut = !target.optedOut;
    setCases((prev) =>
      prev.map((c) => (c.id === caseId ? { ...c, optedOut: nextOptOut } : c))
    );
    appendAudit(
      'Data Protection Contact',
      'Data Protection Contact',
      nextOptOut ? 'CONSENT_OPTOUT_RECORDED' : 'CONSENT_RESTORED',
      caseId,
      nextOptOut
        ? 'Patient opted out of automated SMS/WhatsApp; routed to human coordinator.'
        : 'Patient follow-up consent restored.'
    );
  };

  const handleUpdateRulePackSla = (
    id: string,
    ackSlaHours: number,
    evalTargetDays: number
  ) => {
    setRulePacks((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, ackSlaHours, evalTargetDays } : p
      )
    );
    appendAudit(
      'Dr. Grace Njeri',
      'Partner Clinical Lead',
      'RULE_PACK_UPDATED',
      id,
      `Updated facility acknowledgment SLA to ${ackSlaHours}h and evaluation target to ${evalTargetDays} days.`
    );
  };

  const handleCreateNewCase = (e: FormEvent) => {
    e.preventDefault();
    if (!newPatientCode.trim() && !newPatientName.trim()) {
      setNewCaseError('Please enter a patient name or identifier code.');
      return;
    }

    const newId = `REF-2026-0${418 + cases.length + 1}`;
    const ts = nowTimestamp();
    const code = newPatientCode.trim().toUpperCase() || `PT-${8850 + cases.length}`;
    const name = newPatientName.trim() || `Patient ${code}`;
    const created: ReferralCase = {
      id: newId,
      patientCode: code,
      patientName: name,
      patientLabel: newPatientLabel.trim() || 'Cohort NBO · Screened',
      pathway: newPathway,
      sourceProgram: newSourceProgram,
      coordinator: newCoordinator,
      receivingFacility: newFacility,
      stage: 'Handoff Sent',
      status: 'Awaiting Ack',
      consentSms: newConsentSms,
      consentWhatsApp: false,
      optedOut: false,
      createdAt: ts,
      dueDate: '2026-11-23',
      slaHoursRemaining: 36,
      redFlag: newRedFlag,
      notes: newRedFlag
        ? 'Red-flag positive screen logged with expedited clinical escalation.'
        : 'Positive screen logged; awaiting receiving facility acknowledgment.',
      milestones: {
        referralIssuedAt: ts,
      },
    };

    setCases((prev) => [created, ...prev]);
    appendAudit(
      newCoordinator,
      'Programme Coordinator',
      'CASE_CREATED',
      newId,
      `Logged ${newPathway} positive screen (${created.patientName} · ${created.patientCode}) routed to ${newFacility}.`
    );

    setNewPatientName('');
    setNewPatientCode('');
    setNewPatientLabel('');
    setNewRedFlag(false);
    setNewCaseError(null);
    setNewCaseModalOpen(false);
    setActiveTab('cases');
  };

  const handleCsvImport = (e: FormEvent) => {
    e.preventDefault();
    const lines = csvText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      setCsvFeedback('Please enter at least one CSV row to import.');
      return;
    }

    const ts = nowTimestamp();
    const imported: ReferralCase[] = [];

    lines.forEach((line, index) => {
      const cols = line.split(',').map((s) => s.trim());
      if (cols.length >= 2) {
        const id = `REF-2026-0${418 + cases.length + index + 1}`;
        const pathwayVal: PathwayName =
          cols[2] === 'NCD Screening'
            ? 'NCD Screening'
            : cols[2] === 'Male Reproductive Health'
            ? 'Male Reproductive Health'
            : 'Cancer Screening';

        imported.push({
          id,
          patientCode: cols[0] || `PT-IMP-${index + 1}`,
          patientName: `Imported Patient ${cols[0] || index + 1}`,
          patientLabel: cols[1] || 'CSV Imported Cohort',
          pathway: pathwayVal,
          sourceProgram: cols[3] || 'Secure CSV Intake',
          coordinator: cols[4] || 'Miriam Wanjiku',
          receivingFacility: cols[5] || INITIAL_FACILITIES[0].name,
          stage: 'Handoff Sent',
          status: 'Awaiting Ack',
          consentSms: true,
          consentWhatsApp: false,
          optedOut: false,
          createdAt: ts,
          dueDate: '2026-11-24',
          slaHoursRemaining: 48,
          redFlag: false,
          notes: 'Imported via Phase 1 Secure CSV Intake.',
          milestones: { referralIssuedAt: ts },
        });
      }
    });

    if (imported.length === 0) {
      setCsvFeedback('Could not parse valid rows. Expected comma-separated columns.');
      return;
    }

    setCases((prev) => [...imported, ...prev]);
    appendAudit(
      'Programme Manager',
      'Programme Manager',
      'CSV_BATCH_IMPORTED',
      `BATCH-${imported.length}`,
      `Imported ${imported.length} consented referrals via secure CSV intake.`
    );
    setCsvFeedback(`Successfully imported ${imported.length} cases into the active queue.`);
    setTimeout(() => {
      setCsvFeedback(null);
      setCsvModalOpen(false);
      setActiveTab('cases');
    }, 900);
  };

  const overdueCount = cases.filter((c) => c.status === 'Overdue SLA').length;
  const awaitingAckCount = cases.filter((c) => c.status === 'Awaiting Ack').length;

  const NAV_ITEMS: Array<{
    id: DashboardTab;
    label: string;
    icon: typeof LayoutDashboard;
    count?: number;
  }> = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'cases', label: 'Referrals & Cases', icon: ClipboardList, count: cases.length },
    { id: 'facilities', label: 'Facility Desk', icon: Building2, count: awaitingAckCount },
    { id: 'escalations', label: 'SLA Escalations', icon: AlertTriangle, count: overdueCount },
    { id: 'comms', label: 'Patient Comms', icon: MessageSquare },
    { id: 'pathways', label: 'Pathway Rules', icon: GitBranch },
    { id: 'audit', label: 'Audit & Exports', icon: FileCheck2 },
    { id: 'settings', label: 'Team & Settings', icon: Settings },
  ];

  const activeLabel = NAV_ITEMS.find((n) => n.id === activeTab)?.label ?? 'Overview';

  const SidebarContent = (
    <div className="flex flex-col h-full justify-between bg-[#061B3A] text-white w-64 p-4">
      <div className="space-y-6">
        <div className="px-2 pt-1 flex items-center justify-between">
          <PathoraMark variant="dark" />
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="lg:hidden text-slate-300 hover:text-white p-1"
            aria-label="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav aria-label="Dashboard navigation" className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === activeTab;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileNavOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium rounded-xl transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-[#008E97] text-white'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                <span className="inline-flex items-center gap-2.5 truncate">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {typeof item.count === 'number' && item.count > 0 && (
                  <span
                    className={`font-mono text-[11px] tabular-nums ${
                      isActive ? 'text-teal-50' : 'text-slate-400'
                    }`}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="pt-4 border-t border-white/15 space-y-3">
        <div className="px-2 text-xs text-slate-300">
          <p className="font-semibold text-white truncate">
            {currentUser?.name || 'Miriam Wanjiku'}
          </p>
          <p className="text-[11px] text-slate-400 truncate">
            {currentUser?.role || 'Programme Coordinator'}
          </p>
        </div>

        <button
          type="button"
          onClick={onExitDashboard}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-teal-100 bg-white/10 hover:bg-white/15 rounded-xl transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-[#F8FAFC] text-[#061B3A]">
      {/* Desktop Fixed Sidebar (256px) */}
      <aside className="hidden lg:block shrink-0 sticky top-0 h-screen">
        {SidebarContent}
      </aside>

      {/* Mobile Sidebar Overlay */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden flex bg-[#061B3A]/60 backdrop-blur-sm"
          onClick={() => setMobileNavOpen(false)}
        >
          <div onClick={(e) => e.stopPropagation()} className="h-full">
            {SidebarContent}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract: Breadcrumb on Left, Global Referral Search + Action Buttons on Right */}
        <header className="sticky top-0 z-30 h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-3 sm:gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-2 rounded-lg border border-slate-200 text-[#061B3A] hover:bg-slate-50 cursor-pointer"
              aria-label="Open navigation menu"
            >
              <Menu className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2 text-sm truncate">
              <span className="text-slate-500 hidden xl:inline">Pathora Workspace</span>
              <span className="text-slate-300 hidden xl:inline">/</span>
              <h1 className="font-display font-bold text-[#061B3A] truncate">
                {activeLabel}
              </h1>
            </div>
          </div>

          {/* Global Referral Lookup Search Bar */}
          {(() => {
            const trimmed = globalQuery.trim().toLowerCase();
            const searchMatches = trimmed
              ? cases.filter(
                  (c) =>
                    c.patientName.toLowerCase().includes(trimmed) ||
                    c.id.toLowerCase().includes(trimmed) ||
                    c.patientCode.toLowerCase().includes(trimmed)
                )
              : [];

            return (
              <div className="relative flex-1 max-w-sm md:max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
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
                  placeholder="Lookup referral by patient name or ID..."
                  aria-label="Lookup referral by patient name or ID"
                  className="w-full pl-9 pr-8 py-2 text-xs sm:text-sm bg-[#F8FAFC] border border-slate-200 rounded-lg text-[#061B3A] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#009CA6] focus:bg-white transition-colors"
                />
                {globalQuery && (
                  <button
                    type="button"
                    onClick={() => setGlobalQuery('')}
                    aria-label="Clear referral search"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#061B3A] cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}

                {searchFocused && trimmed.length > 0 && (
                  <div className="absolute left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden z-50">
                    {searchMatches.length === 0 ? (
                      <div className="px-4 py-3 text-xs text-slate-500 flex items-center justify-between gap-2">
                        <span>No referrals match &ldquo;{globalQuery}&rdquo;</span>
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setGlobalQuery('');
                          }}
                          className="font-semibold text-[#00828C] cursor-pointer"
                        >
                          Clear
                        </button>
                      </div>
                    ) : (
                      <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                        <div className="px-3.5 py-2 bg-slate-50 text-[11px] font-semibold text-slate-500 flex items-center justify-between">
                          <span>Matching Referrals</span>
                          <span className="font-mono tabular-nums">{searchMatches.length}</span>
                        </div>
                        {searchMatches.map((match) => {
                          const journey = deriveReferralJourney(match);
                          return (
                            <button
                              key={match.id}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setSelectedCaseId(match.id);
                                setGlobalQuery('');
                                setSearchFocused(false);
                              }}
                              className="w-full text-left px-3.5 py-2.5 hover:bg-slate-50 transition-colors flex items-center justify-between gap-3 cursor-pointer"
                            >
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-[#061B3A] truncate">
                                  {match.patientName}{' '}
                                  <span className="font-mono font-normal text-slate-500">
                                    ({match.patientCode})
                                  </span>
                                </p>
                                <p className="text-[11px] text-slate-500 truncate">
                                  <span className="font-mono text-[#00828C] font-medium">
                                    {match.id}
                                  </span>{' '}
                                  · {match.pathway}
                                </p>
                              </div>
                              <div className="text-right shrink-0">
                                <span className="block text-[11px] font-semibold text-[#061B3A]">
                                  {journey.currentStageLabel}
                                </span>
                                <span className="font-mono text-[10px] tabular-nums text-slate-500">
                                  {journey.completedCount}/4 steps
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setCsvModalOpen(true)}
              className="hidden md:inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#061B3A] bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Import CSV</span>
            </button>
            <button
              type="button"
              onClick={() => setNewCaseModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 sm:px-4 py-2 text-xs font-semibold text-white bg-[#008E97] hover:bg-[#00767E] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Log Positive Screen</span>
              <span className="sm:hidden">Log Screen</span>
            </button>
          </div>
        </header>

        {/* Active Page Viewport */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1320px] w-full mx-auto">
          {activeTab === 'overview' && (
            <OverviewView
              cases={cases}
              onSelectCase={(c) => setSelectedCaseId(c.id)}
              onNavigate={(tab) => setActiveTab(tab)}
            />
          )}
          {activeTab === 'cases' && (
            <CasesView
              cases={cases}
              onSelectCase={(c) => setSelectedCaseId(c.id)}
              onOpenNewCase={() => setNewCaseModalOpen(true)}
              onOpenCsvImport={() => setCsvModalOpen(true)}
            />
          )}
          {activeTab === 'facilities' && (
            <FacilitiesView
              facilities={facilities}
              cases={cases}
              onAcknowledgeCase={handleAcknowledgeCase}
              onConfirmAttendance={handleConfirmAttendance}
              onSelectCase={(c) => setSelectedCaseId(c.id)}
            />
          )}
          {activeTab === 'escalations' && (
            <EscalationsView
              cases={cases}
              onEscalateToClinicalLead={handleEscalateToClinicalLead}
              onLogBarrierResolution={handleLogBarrierResolution}
              onSelectCase={(c) => setSelectedCaseId(c.id)}
            />
          )}
          {activeTab === 'comms' && (
            <CommsConsentView
              cases={cases}
              commsLog={commsLog}
              onSendMessage={handleSendMessage}
              onToggleOptOut={handleToggleOptOut}
            />
          )}
          {activeTab === 'pathways' && (
            <PathwaysView
              rulePacks={rulePacks}
              onUpdateRulePackSla={handleUpdateRulePackSla}
            />
          )}
          {activeTab === 'audit' && (
            <AuditView
              auditEvents={auditEvents}
              cases={cases}
              onExportLogged={(exportType) =>
                appendAudit(
                  'Miriam Wanjiku',
                  'Programme Coordinator',
                  'DATA_EXPORTED',
                  'REPORT',
                  `Exported ${exportType}.`
                )
              }
            />
          )}
          {activeTab === 'settings' && (
            <SettingsView
              team={team}
              onToggleMemberActive={(id) =>
                setTeam((prev) =>
                  prev.map((m) => (m.id === id ? { ...m, active: !m.active } : m))
                )
              }
              onAddTeamMember={(member) => {
                const newMember: TeamMember = {
                  ...member,
                  id: `USR-0${team.length + 1}`,
                  active: true,
                };
                setTeam((prev) => [...prev, newMember]);
                appendAudit(
                  'Programme Manager',
                  'Programme Manager',
                  'TEAM_USER_ADDED',
                  newMember.id,
                  `Added ${newMember.name} as ${newMember.role}.`
                );
              }}
            />
          )}
        </main>
      </div>

      {/* Case Detail Slide-Over Drawer */}
      {selectedCase && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-[#061B3A]/50 backdrop-blur-sm"
          onClick={() => setSelectedCaseId(null)}
        >
          <div
            className="w-full max-w-lg bg-white h-full overflow-y-auto p-6 shadow-2xl border-l border-slate-200 flex flex-col justify-between space-y-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                  <span className="font-mono text-xs font-bold text-[#00828C]">
                    {selectedCase.id} · {selectedCase.patientCode}
                  </span>
                  <h2 className="font-display text-lg font-bold text-[#061B3A] mt-0.5">
                    {selectedCase.patientName} — {selectedCase.pathway}
                  </h2>
                  <p className="text-xs text-slate-500">{selectedCase.sourceProgram}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedCaseId(null)}
                  className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:text-[#061B3A] cursor-pointer"
                  aria-label="Close case details"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Visual 4-Stage Progress Tracker */}
              <ReferralProgressTracker referral={selectedCase} variant="full" />

              {/* Distinct Closed-Loop Milestones */}
              <div className="space-y-2.5">
                <h3 className="text-xs font-semibold text-slate-500">
                  Audit Event Timestamps
                </h3>
                <div className="bg-[#F8FAFC] border border-slate-200 rounded-xl p-4 space-y-2.5 text-xs">
                  {[
                    { label: '1. Referral Issued', ts: selectedCase.milestones.referralIssuedAt },
                    {
                      label: '2. Facility Acknowledged (Appointment Scheduled)',
                      ts: selectedCase.milestones.facilityAcknowledgedAt,
                    },
                    { label: '3. Patient Attended', ts: selectedCase.milestones.patientAttendedAt },
                    {
                      label: '4. Evaluation Completed',
                      ts: selectedCase.milestones.evaluationCompletedAt,
                    },
                    {
                      label: '5. Care Completed (Outcome Documented)',
                      ts: selectedCase.milestones.outcomeDocumentedAt,
                    },
                  ].map((m) => (
                    <div key={m.label} className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-2 font-medium text-[#061B3A]">
                        {m.ts ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                        )}
                        {m.label}
                      </span>
                      <span className="font-mono tabular-nums text-slate-500">
                        {m.ts ?? 'Pending'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Ownership & Facility Details */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="border border-slate-200 rounded-xl p-3">
                  <label htmlFor="reassign-owner" className="block text-slate-500 mb-1">
                    Named Owner
                  </label>
                  <select
                    id="reassign-owner"
                    value={selectedCase.coordinator}
                    onChange={(e) => handleReassignOwner(selectedCase.id, e.target.value)}
                    className="w-full font-semibold text-[#061B3A] bg-transparent focus:outline-none"
                  >
                    <option value="Miriam Wanjiku">Miriam Wanjiku</option>
                    <option value="Peter Omondi">Peter Omondi</option>
                    <option value="Amina Salim">Amina Salim</option>
                  </select>
                </div>
                <div className="border border-slate-200 rounded-xl p-3">
                  <span className="block text-slate-500 mb-1">Receiving Facility</span>
                  <span className="font-semibold text-[#061B3A] block truncate">
                    {selectedCase.receivingFacility}
                  </span>
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl p-3.5 text-xs space-y-1">
                <span className="font-semibold text-slate-500">Operational Notes</span>
                <p className="text-slate-700 leading-relaxed">{selectedCase.notes}</p>
              </div>

              {/* Stage Quick Actions or Verified Closure Form */}
              {selectedCase.status === 'Closed Verified' ? (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs space-y-1">
                  <p className="font-bold text-emerald-800">Verified Terminal Outcome Recorded</p>
                  <p className="text-emerald-900">{selectedCase.closureReason}</p>
                  <p className="text-emerald-700">Source: {selectedCase.outcomeSource}</p>
                </div>
              ) : (
                <div className="space-y-4 pt-2 border-t border-slate-100">
                  <div className="flex flex-wrap gap-2">
                    {!selectedCase.milestones.facilityAcknowledgedAt && (
                      <button
                        type="button"
                        onClick={() => handleAcknowledgeCase(selectedCase.id)}
                        className="px-3.5 py-2 text-xs font-semibold text-white bg-[#008E97] rounded-lg cursor-pointer"
                      >
                        Record Facility Ack
                      </button>
                    )}
                    {!selectedCase.milestones.patientAttendedAt && (
                      <button
                        type="button"
                        onClick={() => handleConfirmAttendance(selectedCase.id)}
                        className="px-3.5 py-2 text-xs font-semibold text-white bg-[#061B3A] rounded-lg cursor-pointer"
                      >
                        Confirm Patient Attendance
                      </button>
                    )}
                  </div>

                  <form
                    onSubmit={handleDocumentClosure}
                    className="bg-[#F8FAFC] border border-slate-200 rounded-xl p-4 space-y-3"
                  >
                    <h4 className="text-xs font-bold text-[#061B3A]">
                      Document Verified Outcome &amp; Close Case
                    </h4>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Terminal Closure Reason
                      </label>
                      <select
                        value={closureReasonInput}
                        onChange={(e) => setClosureReasonInput(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg"
                      >
                        <option value="Clinical evaluation completed & care plan documented">
                          Clinical evaluation completed &amp; care plan documented
                        </option>
                        <option value="Confirmatory diagnostic negative · Returned to routine screening">
                          Confirmatory diagnostic negative · Returned to routine screening
                        </option>
                        <option value="Patient declined further care (documented consent)">
                          Patient declined further care (documented consent)
                        </option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Authorized Outcome Source (Clinician / Facility Desk)
                      </label>
                      <input
                        type="text"
                        value={outcomeSourceInput}
                        onChange={(e) => setOutcomeSourceInput(e.target.value)}
                        placeholder={`e.g. Focal Clinician at ${selectedCase.receivingFacility}`}
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg"
                      />
                    </div>
                    <button
                      type="submit"
                      className="w-full py-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors cursor-pointer"
                    >
                      Verify Outcome &amp; Close Case
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Log Positive Screen Modal */}
      {newCaseModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#061B3A]/60 backdrop-blur-sm"
          onClick={() => setNewCaseModalOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="font-display text-lg font-bold text-[#061B3A]">
                Log Positive Screen / New Referral
              </h2>
              <button
                type="button"
                onClick={() => setNewCaseModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-[#061B3A] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {newCaseError && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                {newCaseError}
              </div>
            )}

            <form onSubmit={handleCreateNewCase} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-[#061B3A] mb-1">
                    Patient Name
                  </label>
                  <input
                    type="text"
                    value={newPatientName}
                    onChange={(e) => setNewPatientName(e.target.value)}
                    placeholder="Grace Mutua"
                    className="w-full px-3 py-2 bg-[#F8FAFC] border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-[#061B3A] mb-1">
                    Identifier Code
                  </label>
                  <input
                    type="text"
                    value={newPatientCode}
                    onChange={(e) => setNewPatientCode(e.target.value)}
                    placeholder="PT-8860"
                    className="w-full px-3 py-2 bg-[#F8FAFC] border border-slate-200 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-[#061B3A] mb-1">
                    Cohort Note
                  </label>
                  <input
                    type="text"
                    value={newPatientLabel}
                    onChange={(e) => setNewPatientLabel(e.target.value)}
                    placeholder="Cohort NBO · F / 41"
                    className="w-full px-3 py-2 bg-[#F8FAFC] border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#061B3A] mb-1">Pathway</label>
                  <select
                    value={newPathway}
                    onChange={(e) => setNewPathway(e.target.value as PathwayName)}
                    className="w-full px-3 py-2 bg-[#F8FAFC] border border-slate-200 rounded-lg"
                  >
                    <option value="Cancer Screening">Cancer Screening</option>
                    <option value="NCD Screening">NCD Screening</option>
                    <option value="Male Reproductive Health">Male Reproductive Health</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-[#061B3A] mb-1">Named Owner</label>
                  <select
                    value={newCoordinator}
                    onChange={(e) => setNewCoordinator(e.target.value)}
                    className="w-full px-3 py-2 bg-[#F8FAFC] border border-slate-200 rounded-lg"
                  >
                    <option value="Miriam Wanjiku">Miriam Wanjiku</option>
                    <option value="Peter Omondi">Peter Omondi</option>
                    <option value="Amina Salim">Amina Salim</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-[#061B3A] mb-1">
                  Screening Source Programme
                </label>
                <input
                  type="text"
                  value={newSourceProgram}
                  onChange={(e) => setNewSourceProgram(e.target.value)}
                  className="w-full px-3 py-2 bg-[#F8FAFC] border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#061B3A] mb-1">
                  Receiving Facility
                </label>
                <select
                  value={newFacility}
                  onChange={(e) => setNewFacility(e.target.value)}
                  className="w-full px-3 py-2 bg-[#F8FAFC] border border-slate-200 rounded-lg"
                >
                  {facilities.map((f) => (
                    <option key={f.id} value={f.name}>
                      {f.name} ({f.city})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between pt-1">
                <label className="inline-flex items-center gap-2 text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newConsentSms}
                    onChange={(e) => setNewConsentSms(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>Patient SMS follow-up consent recorded</span>
                </label>

                <label className="inline-flex items-center gap-2 text-red-700 font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newRedFlag}
                    onChange={(e) => setNewRedFlag(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>Clinical Red Flag</span>
                </label>
              </div>

              <div className="pt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setNewCaseModalOpen(false)}
                  className="px-4 py-2 text-slate-600 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 font-semibold text-white bg-[#008E97] hover:bg-[#00767E] rounded-lg cursor-pointer"
                >
                  Create Tracked Case
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Secure CSV Import Modal */}
      {csvModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#061B3A]/60 backdrop-blur-sm"
          onClick={() => setCsvModalOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="font-display text-lg font-bold text-[#061B3A]">
                  Phase 1 Secure CSV Batch Intake
                </h2>
                <p className="text-xs text-slate-500">
                  Format: PatientCode, CohortLabel, Pathway, SourceProgram, Owner, Facility
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCsvModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-[#061B3A] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCsvImport} className="space-y-4">
              <textarea
                rows={5}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                className="w-full p-3 font-mono text-xs bg-[#F8FAFC] border border-slate-200 rounded-xl text-[#061B3A]"
              />

              {csvFeedback && (
                <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                  {csvFeedback}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCsvModalOpen(false)}
                  className="px-4 py-2 text-xs text-slate-600 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-semibold text-white bg-[#061B3A] hover:bg-[#0B2954] rounded-lg cursor-pointer"
                >
                  Import Batch Referrals
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
