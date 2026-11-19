import fs from 'node:fs';
import path from 'node:path';
import {
  AuditEvent,
  CommsLogEntry,
  FacilityPartner,
  INITIAL_AUDIT_EVENTS,
  INITIAL_CASES,
  INITIAL_COMMS_LOG,
  INITIAL_FACILITIES,
  INITIAL_RULE_PACKS,
  INITIAL_TEAM,
  MESSAGE_TEMPLATES,
  MessageTemplate,
  PathwayRulePack,
  ReferralCase,
  TeamMember,
} from '../../src/data/dashboardData.ts';
import { hashPassword } from './passwords.ts';

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: string;
  organization: string;
  primaryPathway?: string;
  passwordHash: string;
  createdAt: string;
}

export interface SessionRecord {
  token: string;
  userId: string;
  expiresAt: number;
}

export interface DiscoveryRequest {
  id: string;
  name: string;
  organization: string;
  email: string;
  pathway: string;
  createdAt: string;
}

export interface Database {
  counters: {
    case: number;
    patient: number;
    audit: number;
    message: number;
    team: number;
    user: number;
    discovery: number;
  };
  users: UserRecord[];
  sessions: SessionRecord[];
  discoveryRequests: DiscoveryRequest[];
  cases: ReferralCase[];
  facilities: FacilityPartner[];
  templates: MessageTemplate[];
  commsLog: CommsLogEntry[];
  rulePacks: PathwayRulePack[];
  auditEvents: AuditEvent[];
  team: TeamMember[];
}

const DATA_DIR = process.env.PATHORA_DATA_DIR
  ? path.resolve(process.env.PATHORA_DATA_DIR)
  : path.resolve(import.meta.dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

export const DEMO_EMAIL = 'coordinator@nairobi-screening.org';
export const DEMO_PASSWORD = 'pathora-demo';

function seed(): Database {
  const clone = <T>(v: T): T => structuredClone(v);
  return {
    counters: {
      case: 424,
      patient: 8859,
      audit: 505,
      message: 903,
      team: INITIAL_TEAM.length,
      user: 1,
      discovery: 0,
    },
    users: [
      {
        id: 'ACC-001',
        name: 'Miriam Wanjiku',
        email: DEMO_EMAIL,
        role: 'Programme Coordinator',
        organization: 'Nairobi Preventive Screening Network',
        primaryPathway: 'Cancer Screening',
        passwordHash: hashPassword(DEMO_PASSWORD),
        createdAt: new Date().toISOString(),
      },
    ],
    sessions: [],
    discoveryRequests: [],
    cases: clone(INITIAL_CASES),
    facilities: clone(INITIAL_FACILITIES),
    templates: clone(MESSAGE_TEMPLATES),
    commsLog: clone(INITIAL_COMMS_LOG),
    rulePacks: clone(INITIAL_RULE_PACKS),
    auditEvents: clone(INITIAL_AUDIT_EVENTS),
    team: clone(INITIAL_TEAM),
  };
}

function load(): Database {
  if (fs.existsSync(DB_FILE)) {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) as Database;
  }
  const fresh = seed();
  persist(fresh);
  return fresh;
}

function persist(data: Database) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

export const db: Database = load();

/** Persist the in-memory database to disk. Call after every mutation. */
export function save() {
  persist(db);
}

export function resetDatabase() {
  const fresh = seed();
  Object.assign(db, fresh);
  save();
}

export function nextId(
  counter: keyof Database['counters'],
  format: (n: number) => string
): string {
  db.counters[counter] += 1;
  return format(db.counters[counter]);
}
