import type { AuthUserSession } from '../components/auth/LoginPage';
import type {
  AuditEvent,
  CommsLogEntry,
  FacilityPartner,
  MessageTemplate,
  PathwayRulePack,
  ReferralCase,
  TeamMember,
} from '../data/dashboardData';

export interface Workspace {
  cases: ReferralCase[];
  facilities: FacilityPartner[];
  templates: MessageTemplate[];
  commsLog: CommsLogEntry[];
  rulePacks: PathwayRulePack[];
  auditEvents: AuditEvent[];
  team: TeamMember[];
}

interface AuthResponse {
  token: string;
  user: AuthUserSession;
}

const TOKEN_KEY = 'pathora.sessionToken';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage unavailable (private mode); session lasts for this page only.
  }
}

let unauthorizedHandler: (() => void) | null = null;

/** Called when the server rejects the session, so the app can return to sign-in. */
export function onUnauthorized(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Cannot reach the Pathora server. Check that the backend is running.', 0);
  }

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) {
      setToken(null);
      unauthorizedHandler?.();
    }
    throw new ApiError(data.error ?? `Request failed (${res.status}).`, res.status);
  }
  return data as T;
}

export const api = {
  hasSession: () => Boolean(getToken()),

  async login(email: string, password: string) {
    const res = await request<AuthResponse>('POST', '/auth/login', { email, password });
    setToken(res.token);
    return res.user;
  },

  async signup(input: {
    name: string;
    organization: string;
    email: string;
    password: string;
    role: string;
    primaryPathway: string;
  }) {
    const res = await request<AuthResponse>('POST', '/auth/signup', input);
    setToken(res.token);
    return res.user;
  },

  async me() {
    const res = await request<{ user: AuthUserSession }>('GET', '/auth/me');
    return res.user;
  },

  async logout() {
    try {
      await request<void>('POST', '/auth/logout');
    } finally {
      setToken(null);
    }
  },

  requestDiscovery(input: { name: string; organization: string; email: string; pathway: string }) {
    return request<{ request: { id: string } }>('POST', '/discovery-requests', input);
  },

  getWorkspace: () => request<Workspace>('GET', '/workspace'),

  createCase: (input: {
    patientName: string;
    patientCode: string;
    patientLabel: string;
    pathway: string;
    sourceProgram: string;
    coordinator: string;
    receivingFacility: string;
    redFlag: boolean;
    consentSms: boolean;
  }) => request<Workspace>('POST', '/workspace/cases', input),

  importCsv: (csv: string) =>
    request<{ importedCount: number; workspace: Workspace }>('POST', '/workspace/cases/import', {
      csv,
    }),

  acknowledgeCase: (id: string) =>
    request<Workspace>('POST', `/workspace/cases/${encodeURIComponent(id)}/acknowledge`),

  confirmAttendance: (id: string) =>
    request<Workspace>('POST', `/workspace/cases/${encodeURIComponent(id)}/attendance`),

  closeCase: (id: string, closureReason: string, outcomeSource: string) =>
    request<Workspace>('POST', `/workspace/cases/${encodeURIComponent(id)}/close`, {
      closureReason,
      outcomeSource,
    }),

  escalateCase: (id: string, reason: string) =>
    request<Workspace>('POST', `/workspace/cases/${encodeURIComponent(id)}/escalate`, { reason }),

  logBarrierResolution: (id: string, note: string) =>
    request<Workspace>('POST', `/workspace/cases/${encodeURIComponent(id)}/barrier-resolution`, {
      note,
    }),

  reassignOwner: (id: string, coordinator: string) =>
    request<Workspace>('PATCH', `/workspace/cases/${encodeURIComponent(id)}/owner`, {
      coordinator,
    }),

  sendMessage: (id: string, channel: 'SMS' | 'WhatsApp', templateName: string) =>
    request<Workspace>('POST', `/workspace/cases/${encodeURIComponent(id)}/messages`, {
      channel,
      templateName,
    }),

  toggleOptOut: (id: string) =>
    request<Workspace>('POST', `/workspace/cases/${encodeURIComponent(id)}/opt-out/toggle`),

  updateRulePack: (id: string, ackSlaHours: number, evalTargetDays: number) =>
    request<Workspace>('PATCH', `/workspace/rule-packs/${encodeURIComponent(id)}`, {
      ackSlaHours,
      evalTargetDays,
    }),

  addTeamMember: (member: Omit<TeamMember, 'id' | 'active'>) =>
    request<Workspace>('POST', '/workspace/team', member),

  toggleTeamMember: (id: string) =>
    request<Workspace>('POST', `/workspace/team/${encodeURIComponent(id)}/toggle-active`),

  logExport: (exportType: string) =>
    request<Workspace>('POST', '/workspace/audit/exports', { exportType }),
};
