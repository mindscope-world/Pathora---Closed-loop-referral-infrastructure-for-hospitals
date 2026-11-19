# Pathora Backend Implementation Plan

Derived from an analysis of the current frontend (`src/`, ~6.9k lines, React 19 + Vite + Tailwind, no backend calls yet).

---

## 1. What the frontend tells us

### 1.1 Current state
- **100% client-side mock.** `DashboardShell.tsx` holds all state in `useState`, seeded from `src/data/dashboardData.ts` (`INITIAL_CASES`, `INITIAL_FACILITIES`, `MESSAGE_TEMPLATES`, `INITIAL_COMMS_LOG`, `INITIAL_RULE_PACKS`, `INITIAL_AUDIT_EVENTS`, `INITIAL_TEAM`). Reloading loses everything.
- **No real auth.** `LoginPage` accepts any email/password and fabricates an `AuthUserSession {name, role, organization, email}`. `SignupPage` does the same. `App.tsx` switches views with a `viewMode` state, with no router and no tokens.
- **Lead capture goes nowhere.** `DiscoveryModal` validates name/org/email/pathway and shows a success screen, but nothing is sent.
- **Business logic lives in the browser** and must move server-side: stage/status transitions, SLA computation, ID generation, audit-event creation, opt-out enforcement, CSV parsing, dashboard aggregations.
- **Express, dotenv, tsx and `@google/genai` are already in `package.json`**, and `npm run clean` removes `server.js`. The project was scaffolded for an Express server, though none exists yet. `GEMINI_API_KEY` is unused by any current code.

### 1.2 Domain model inferred from `dashboardData.ts`

| Entity | Key fields | Notes |
|---|---|---|
| **ReferralCase** | id (`REF-2026-0418`), patientCode, patientName, patientLabel, pathway, sourceProgram, coordinator, receivingFacility, stage, status, consentSms, consentWhatsApp, optedOut, createdAt, dueDate, slaHoursRemaining, redFlag, notes, closureReason, outcomeSource, milestones | `slaHoursRemaining`, `status` and `dueDate` are **derived** and must be computed server-side. |
| **CaseMilestones** | referralIssuedAt, facilityAcknowledgedAt, patientAttendedAt, evaluationCompletedAt, outcomeDocumentedAt | "Sent", "received" and "acknowledged" are tracked as distinct timestamps. |
| **FacilityPartner** | name, type, city, focalPerson, interopMethod (Portal+CSV / API Ready / Status-Return Desk), avgAckHours | `avgAckHours` is computed from case data. |
| **MessageTemplate** | name, pathway, channel (SMS/WhatsApp), language (EN/SW), body with `{facility}` `{phone}` placeholders, reviewedBy | |
| **CommsLogEntry** | caseId, channel (SMS/WhatsApp/Voice Call), templateName, deliveryStatus (Delivered/Read/Blocked (Opt-out)/Human Routed), timestamp | |
| **PathwayRulePack** | name, version, status (Active/Configured/Coming Soon), ackSlaHours, contactSlaHours, evalTargetDays, clinicalOwner, redFlagRule, closureCriteria | Versioned. Editing SLAs bumps the version and writes an audit event. |
| **AuditEvent** | timestamp, actor, role, action, resourceId, detail | Presented as "immutable". Must be append-only. |
| **TeamMember** | name, role (5 roles), organization, accessScope, active | |
| **Lead** (DiscoveryModal) | name, organization, email, pathway | |

Enums:
- **Stage:** Intake, Assigned, Contacted, Handoff Sent, Acknowledged, Attended, Escalated, Closed.
- **Status:** Active, Awaiting Ack, Overdue SLA, Closed Verified.
- **Pathways:** Cancer Screening, NCD Screening, Male Reproductive Health (plus Maternal & Child Health, "Coming Soon").

### 1.3 Operations the UI performs (the API surface)

| UI action | Handler | Required backend behaviour |
|---|---|---|
| Sign in / sign up | `LoginPage`, `SignupPage` | Real authentication, org onboarding, role assignment |
| Request walkthrough | `DiscoveryModal` | Persist lead, notify sales |
| Create referral | `handleCreateNewCase` | Validate, generate ID, set SLA from rule pack, audit |
| CSV import | `handleCsvImport` | Server-side parse, per-row validation, batch audit |
| Facility acknowledges | `handleAcknowledgeCase` | Stage → Acknowledged, milestone, audit |
| Confirm attendance | `handleConfirmAttendance` | Stage → Attended, milestone, audit |
| Document closure | `handleDocumentClosure` | Requires reason and outcome source → Closed Verified |
| Escalate to clinical lead | `handleEscalateToClinicalLead` | Stage → Escalated, notify, audit |
| Log barrier resolution | `handleLogBarrierResolution` | Reset SLA clock, audit |
| Reassign owner | `handleReassignOwner` | Named-ownership transfer, audit |
| Send message | `handleSendMessage` | **Block if opted out**, send via provider, log delivery, audit |
| Toggle opt-out | `handleToggleOptOut` | Update consent, audit |
| Edit SLA rules | `handleUpdateRulePackSla` | Clinical-lead-only, version bump, audit |
| Synthetic pathway test | `PathwaysView.runSyntheticTest` | Run in isolation from live metrics |
| Export referrals/audit CSV | `AuditView` | Server-generated, RBAC-gated, export itself audited |
| Add/deactivate team member | `SettingsView` | Invite flow, role scope |
| Global search | `DashboardShell` | Search by case ID/code/name/facility |
| Dashboard aggregates | `OverviewView`, `DashboardSummary` | Funnel, pathway breakdown, overdue/awaiting counts, completion rate, upcoming appointments |

---

## 2. Architecture decisions

| Concern | Decision | Rationale |
|---|---|---|
| Runtime | **Node 22 + TypeScript + Express 4** | Already in `package.json`. Share types with the frontend. |
| Database | **PostgreSQL** | Relational, strong constraints, row-level security available. |
| ORM / migrations | **Prisma** (or Drizzle) | Typed client, migration history. |
| Validation | **Zod** | One schema serves the API contract and the frontend types. |
| Auth | **Email + password (argon2id) with short-lived JWT access token and rotating refresh token in an httpOnly cookie**. Optionally add OIDC later. | Replaces the mock login. |
| Authorisation | **RBAC + tenant scoping** per organisation | The 5 roles already exist in the UI. |
| Background jobs | **pg-boss** (Postgres-backed queue) or BullMQ + Redis | SLA monitor, message sending, exports. |
| Messaging | **Provider adapter** (Africa's Talking for SMS and WhatsApp/Voice in Kenya; Twilio as an alternative) | The Kiswahili and Kenya-first design fits. |
| API style | REST under `/api/v1`, OpenAPI generated from Zod | |
| Layout | `server/` folder alongside `src/`, same repo, shared `shared/types.ts` | `npm run clean` already references `server.js`. |
| Dev proxy | Vite `server.proxy` for `/api` → `localhost:4000` | Avoids CORS locally. |

### Privacy and compliance (design constraint, not an afterthought)
This is health data in Kenya, so the **Data Protection Act 2019** applies. Health data is *sensitive personal data*.
- The UI intentionally keeps SMS content free of clinical detail. The backend must enforce this in templates.
- Minimise stored identifiers. Encrypt `patientName` and phone at rest (column-level, AES-GCM with a KMS-held key). Show `patientCode` by default.
- Consent is a first-class record with a lawful basis, timestamp and channel, rather than the boolean flags the mock uses.
- Retention is configurable per org (the Settings UI already exposes `retentionDays`).
- Every read of a patient's identifiable data is audited.

---

## 3. Target repository layout

```
server/
  index.ts                 # app bootstrap, graceful shutdown
  config/env.ts            # zod-validated env
  db/
    schema.prisma
    migrations/
    seed.ts                # port of dashboardData.ts
  middleware/
    auth.ts  rbac.ts  tenant.ts  validate.ts  rateLimit.ts  errorHandler.ts  requestId.ts
  modules/
    auth/        routes.ts controller.ts service.ts
    leads/
    organizations/
    users/
    facilities/
    cases/       # routes, service, stateMachine.ts, sla.ts, csvImport.ts
    comms/       # routes, service, providers/{africastalking,mock}.ts, webhooks.ts
    rulePacks/
    escalations/
    audit/
    reports/     # metrics + exports
    search/
  jobs/
    slaMonitor.ts  sendMessage.ts  exportGenerator.ts  retentionPurge.ts
  lib/
    crypto.ts  ids.ts  time.ts  csv.ts  logger.ts
shared/
  types.ts                 # enums + DTOs reused by src/
```

---

## 4. Data model (Prisma sketch)

```prisma
model Organization {
  id String @id @default(cuid())
  name String
  type OrgType            // PROGRAMME | FACILITY | CLINICAL_PARTNER
  retentionDays Int @default(365)
  dpoContact String?
  createdAt DateTime @default(now())
}

model User {
  id String @id @default(cuid())
  orgId String
  email String @unique
  passwordHash String
  name String
  role Role               // PROGRAMME_MANAGER | PROGRAMME_COORDINATOR | FACILITY_FOCAL | CLINICAL_LEAD | DPO
  facilityId String?      // required for FACILITY_FOCAL
  accessScope String
  active Boolean @default(true)
  lastLoginAt DateTime?
}

model RefreshToken { id String @id; userId String; tokenHash String; expiresAt DateTime; revokedAt DateTime? }

model Facility {
  id String @id @default(cuid())
  orgId String
  name String
  type FacilityType
  city String
  focalUserId String?
  interopMethod InteropMethod
}

model Patient {
  id String @id @default(cuid())
  orgId String
  patientCode String
  nameEnc Bytes           // encrypted
  phoneEnc Bytes?         // encrypted
  label String            // "Cohort NBO · F / 44"
  @@unique([orgId, patientCode])
}

model Consent {
  id String @id @default(cuid())
  patientId String
  channel Channel         // SMS | WHATSAPP | VOICE
  granted Boolean
  lawfulBasis String
  recordedBy String
  recordedAt DateTime @default(now())   // append-only: current consent = latest row per channel
}

model RulePack {
  id String @id @default(cuid())
  orgId String
  pathway Pathway
  name String
  version Int
  status RulePackStatus
  ackSlaHours Int
  contactSlaHours Int
  evalTargetDays Int
  clinicalOwnerId String?
  redFlagRule String
  closureCriteria String
  effectiveFrom DateTime
}

model ReferralCase {
  id String @id @default(cuid())
  refNumber String @unique        // REF-2026-0418, per-org year sequence
  orgId String
  patientId String
  pathway Pathway
  rulePackId String               // pin the version in force at creation
  sourceProgram String
  coordinatorId String
  facilityId String
  stage Stage
  redFlag Boolean
  notes String
  closureReason String?
  outcomeSource String?
  issuedAt DateTime
  ackDueAt DateTime               // issuedAt + ackSlaHours
  dueDate DateTime
  closedAt DateTime?
  version Int @default(1)         // optimistic locking
}

model CaseMilestone {             // one row per milestone, source of truth for the tracker
  id String @id; caseId String
  type MilestoneType              // REFERRAL_ISSUED | FACILITY_ACKNOWLEDGED | PATIENT_ATTENDED | EVALUATION_COMPLETED | OUTCOME_DOCUMENTED
  occurredAt DateTime
  recordedBy String
  @@unique([caseId, type])
}

model MessageTemplate { id String @id; orgId String; name String; pathway Pathway?; channel Channel; language Lang; body String; reviewedBy String; approvedAt DateTime? }

model CommsLog {
  id String @id; caseId String; channel Channel; templateId String?
  status DeliveryStatus           // QUEUED | SENT | DELIVERED | READ | FAILED | BLOCKED_OPTOUT | HUMAN_ROUTED
  providerMessageId String?; sentAt DateTime
}

model AuditEvent {                // append-only, hash-chained
  id BigInt @id @default(autoincrement())
  orgId String
  at DateTime @default(now())
  actorId String?; actorLabel String; actorRole String
  action String; resourceType String; resourceId String
  detail String
  prevHash String; hash String
}

model Lead { id String @id; name String; organization String; email String; pathway String; createdAt DateTime @default(now()); handledAt DateTime? }
model ExportJob { id String @id; orgId String; type String; requestedBy String; status String; fileKey String?; createdAt DateTime }
```

Design notes:
- **`stage` is stored; `status` is derived.** Status is computed by `sla.ts` from `stage`, `ackDueAt`, `now` and `closedAt`. The mock stores both and they can drift.
- **Milestones are rows, not columns on the case.** This matches the UI's insistence that sent, received and acknowledged are separate facts.
- **Pin `rulePackId` on each case.** Editing an SLA later must not retroactively change open cases.
- **AuditEvent is append-only.** Revoke `UPDATE`/`DELETE` for the app DB role and chain hashes for tamper evidence. This backs the "Immutable Audit Log" label in the UI.

---

## 5. Step-by-step implementation

Each phase ends in something demoable and testable. Phases 0–4 give a usable core (real auth, real cases, real audit). Phases 5+ add automation and integrations.

### Phase 0: Foundations (½–1 day)
1. Create `server/` and `shared/`. Add `tsconfig.server.json`.
2. Install: `zod prisma @prisma/client argon2 jsonwebtoken cookie-parser helmet cors express-rate-limit pino pino-http pg-boss csv-parse vitest supertest`.
3. Add scripts: `dev:server` (`tsx watch server/index.ts`), `dev:all` (concurrently), `build:server` (esbuild → `server.js`, matching the existing `clean` script), `test`.
4. `config/env.ts`: validate `DATABASE_URL`, `JWT_SECRET`, `COOKIE_SECRET`, `FIELD_ENCRYPTION_KEY`, `APP_URL`, provider keys. Update `.env.example`.
5. Bootstrap Express with `helmet`, CORS locked to `APP_URL`, JSON body limit, request-id, pino logging, central error handler, `/healthz`.
6. Add the Vite proxy for `/api`.
7. Docker Compose with Postgres for local dev.

**Exit:** `GET /healthz` returns 200 and the Vite app can reach it through the proxy.

### Phase 1: Schema, migrations and seed (1 day)
1. Write `schema.prisma` per §4 and run the first migration.
2. DB role setup: app role gets `INSERT`/`SELECT` only on `AuditEvent`.
3. `seed.ts` ports `dashboardData.ts`. Split `patientName` into encrypted `Patient` rows, convert hard-coded timestamps to real dates, create users and rule packs.
4. Implement `lib/ids.ts` for `REF-YYYY-NNNN`, using a per-org per-year sequence inside a transaction. Do not use `cases.length + 1` as the frontend does.

**Exit:** `prisma migrate dev && prisma db seed` yields a DB equivalent to the demo data.

### Phase 2: Auth, tenancy and RBAC (1.5 days)
1. `POST /auth/signup` creates the Organization plus first `PROGRAMME_MANAGER`. Email verification is a follow-up.
2. `POST /auth/login` returns an access token (15 min) and sets a rotating refresh cookie. `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`.
3. Rate limit and lock out login. Hash with argon2id.
4. `tenant.ts` injects `orgId` on every query, and all repository functions take it. Consider Postgres RLS as defence in depth.
5. `rbac.ts` permission matrix, derived from the UI's `accessScope` text:

| Capability | Manager | Coordinator | Facility Focal | Clinical Lead | DPO |
|---|:-:|:-:|:-:|:-:|:-:|
| Create/import cases | ✓ | ✓ | | | |
| Acknowledge / confirm attendance / close | | | ✓ (own facility) | | |
| Escalate, log barrier | ✓ | ✓ | | ✓ | |
| Reassign owner | ✓ | | | | |
| Edit rule-pack SLAs | | | | ✓ | |
| Toggle consent / opt-out | | | | | ✓ |
| View audit, exports | ✓ | | | ✓ | ✓ |
| Manage team | ✓ | | | | |

6. **Frontend:** replace the mock in `LoginPage`/`SignupPage` with `fetch` calls. Add an `AuthProvider` and keep the token in memory. Fix the form defaults that prefill an email and password.

**Exit:** wrong password is rejected, a Facility Focal cannot read another facility's cases, and tenant isolation is covered by tests.

### Phase 3: Core referral engine (3 days), the heart of the product
1. **`stateMachine.ts`** defines legal transitions:
   `Intake → Assigned → Contacted → Handoff Sent → Acknowledged → Attended → Closed`, with `Escalated` reachable from `Handoff Sent`, `Contacted` and `Acknowledged` and returning to `Contacted` via barrier resolution. Reject illegal moves with 409.
2. **`sla.ts`** computes `slaHoursRemaining` and `status`, covering Awaiting Ack, Overdue SLA and Closed Verified. Pure functions with unit tests, because the whole product claim depends on them.
3. Endpoints:
   - `POST /cases` (create, with `Idempotency-Key` header)
   - `GET /cases?status=&pathway=&q=&cursor=` (filters mirror `CasesView`)
   - `GET /cases/:id` (case with milestones, timeline, comms and audit)
   - `POST /cases/:id/acknowledge`
   - `POST /cases/:id/attendance`
   - `POST /cases/:id/close` (requires `closureReason` and `outcomeSource`; also requires attendance, which the mock does not enforce because it back-fills missing milestones)
   - `POST /cases/:id/escalate`
   - `POST /cases/:id/barrier-resolution`
   - `POST /cases/:id/reassign`
4. Every mutation runs in **one transaction** that updates the case, writes the milestone and appends the audit event. Use optimistic locking via `version`.
5. Actor identity comes from the JWT. The frontend currently hard-codes actors such as `'Miriam Wanjiku'`.
6. **CSV import** (`POST /cases/import`):
   - Accept multipart upload or text. Parse server-side with `csv-parse`.
   - Validate each row (pathway enum, facility exists, coordinator exists, duplicate patientCode).
   - Return a per-row report `{imported, rejected:[{row, reason}]}`. Support `dryRun=true`.
   - Cap the size. Write one `CSV_BATCH_IMPORTED` audit event plus per-case events.
   - Require a consent column or an attestation checkbox, since the mock hard-codes `consentSms: true`.
7. Global search `GET /search?q=` over refNumber, patientCode, patient name (via a blind index or HMAC of normalised name, since the name is encrypted) and facility.
8. **Frontend:** introduce an API client and TanStack Query (or a small hook layer). Replace the `useState` data and handlers in `DashboardShell` with mutations and refetch. Remove `nowTimestamp()` and `INITIAL_*` imports.

**Exit:** the full lifecycle (create → ack → attend → close) works through the API with audit rows. Illegal transitions are rejected.

> **Phase 3 as built** (differences from the steps above, and why)
> - **SLA clock:** one stored deadline, `slaDueAt` = the deadline for the *next required action*: ack SLA until the facility acknowledges, then the evaluation target, reset to `now + contactSla` when a barrier is resolved. `status` and `slaHoursRemaining` are derived on read (`sla.ts`); an escalated case always reads as Overdue SLA even if its clock has time left.
> - **State machine:** escalation is also allowed from `ATTENDED` (an overdue outcome must be escalatable). Resolving a barrier returns an escalated case to its *real* progress (`HANDOFF_SENT` / `ACKNOWLEDGED` / `ATTENDED`), never back to `CONTACTED`. Milestones can no longer be skipped or back-filled.
> - **Names are searchable** through a keyed-HMAC word index (`Patient.nameTokens`): whole-word match only, no prefix search.
> - **Extra endpoints the dashboard needed:** `GET /facilities`, `GET /cases/assignees`, `PUT /cases/:id/opt-out` (DPO only; the full consent API remains Phase 7).
> - **Reference numbers are unique per organisation**, not globally (found by tests).
> - **Auditing:** case creation/changes are audited with the patient *code*, never the name. Opening a case (`GET /cases/:id`) is audited; list reads are not.
> - **CSV import** is batched (fixed query count; 500 rows ≈ 1.5 s), reports per-row errors, supports `dryRun`, and requires a consent attestation.
> - **Still mock in the UI:** comms log, rule packs, the Audit view, and team (Phases 4-7).

### Phase 4: Audit trail and exports (1.5 days)
1. `audit.append(tx, event)` is the only write path, and it computes `hash = sha256(prevHash || canonicalJSON(event))`.
2. `GET /audit?q=&from=&to=&cursor=` (the UI filters on case ID, actor and action).
3. `GET /audit/verify` walks the chain and reports breaks. Surface this as a compliance feature.
4. `POST /exports` creates an `ExportJob` (cases CSV or audit CSV). Generate asynchronously, store in object storage, and return a short-lived signed URL. The export itself writes an `EXPORT_GENERATED` audit event, which the UI's `onExportLogged` already expects.
5. CSV hardening: escape formula-injection characters (`=`, `+`, `-`, `@`) in cells.
6. **Frontend:** replace `triggerCsvDownload` with calls to the export endpoints.

**Exit:** exports reproduce the demo CSVs, and tampering with a row makes `/audit/verify` fail.

> **Phase 4 as built** (differences from the steps above, and why)
> - **Queue:** generation runs from a small database-backed queue (the `ExportJob` table, claimed with `FOR UPDATE SKIP LOCKED`, with crash recovery and retention expiry) rather than pg-boss. It needs no new infrastructure, is multi-instance safe, and is directly testable. pg-boss is still installed for Phase 6 if the SLA monitor wants it.
> - **Storage:** a `FileStore` interface with a local-disk implementation (`EXPORT_DIR`, owner-only files, atomic publish). Production should add an S3/GCS implementation behind the same interface.
> - **Download links:** HMAC-signed, 5 minutes, bound to one export and organisation, re-checked against the requester's *current* permissions when used. They are served by the API itself, and the token is redacted from request logs.
> - **Audit trail:** `EXPORT_REQUESTED`, `EXPORT_GENERATED`, `EXPORT_FAILED` and `EXPORT_DOWNLOADED` are all recorded. Audit exports include every hashed field plus each event's hash, so a recipient can recompute the chain from the file alone (a test does exactly this). Each export records its SHA-256 and, for audit exports, the chain tip it ends at.
> - **`GET /audit/verify`** also returns the chain's tip hash: record it outside the database and any later change to earlier history becomes provable.
> - **CSV safety:** text cells that would start with `= + - @` are neutralised (spreadsheet formula injection); numbers are written as numbers. The referral export contains **no patient names**, only programme codes.
> - **Guard:** a test fails the build if any code other than `audit/append.ts` writes `AuditEvent` rows.
> - **UI:** the Audit screen now reads the server's trail (search, load-more, integrity check, recent exports). The local demo audit log in the dashboard has been removed. Actions on still-mock features (comms sends, rule-pack edits, team changes) no longer appear in it, because they do not exist on the server yet.

### Phase 5: Facilities, team and organisation settings (1 day)
1. Facilities: `GET/POST/PATCH /facilities`. `avgAckHours` is computed from milestones (a view or a nightly rollup).
2. Team: `GET /users`, `POST /users/invite` (emails a signed invite link and sets the password on acceptance), `PATCH /users/:id` (deactivate). Deactivation revokes refresh tokens. Do not hard-delete, because audit rows reference users.
3. Organisation: `GET/PATCH /organization` for `name`, `dpoContact`, `retentionDays`. The frontend's "Save" button currently only sets a notice.
4. Receiving-facility API keys are a Phase 8 item.

**Exit:** a manager can invite a facility focal, who then logs in and sees only their facility's referrals.

> **Phase 5 as built** (differences from the steps above, and why)
> - **Invitations, not "add user":** a manager invites by email + role; the invitee follows a single-use link (7 days, only a hash is stored, token travels in a request *body* so it never reaches access logs) and chooses their own password. Re-inviting replaces the earlier link. Accepting is atomic, so simultaneous attempts create exactly one account.
> - **Email is optional:** with `SMTP_URL` set an email (plain text only) is sent; without it, the inviter is shown the link once and shares it themselves. The SMTP path is tested against nodemailer's JSON transport, not a real mail server.
> - **Safeguards:** you cannot suspend or re-role yourself; the last active Programme Manager cannot be removed (enforced with a row lock, tested with simultaneous mutual demotion); deactivation ends every session immediately; role changes apply on the next request.
> - **Account-existence privacy:** an invitation to an address that already has an account (in any organisation) fails with one generic message. It still distinguishes "cannot invite" from success, which is inherent to a one-email-one-account model.
> - **Organisation settings** are validated server-side (retention 30-3650 days) and every change is audited with before → after. **Facilities** can be added and edited (names unique per organisation; renames keep existing referrals attached). Facilities are not deletable.
> - **Free-text names reject control characters** (header/CSV injection), across signup, team, facility and organisation inputs.
> - **Seed:** the demo organisation now includes a Programme Manager (`joyce.wairimu@demo.pathora.test`); before, nobody in it could manage anything.
> - **Tests:** argon2 uses a minimal cost under `NODE_ENV=test` only (production keeps the defaults), which removed hashing as the dominant and flaky part of the suite.

### Phase 6: Rule packs and the SLA monitor (2 days)
1. `GET /rule-packs`, `PATCH /rule-packs/:id` (Clinical Lead only). Editing creates a **new version row** (`effectiveFrom = now`). Existing cases keep their pinned pack. Writes a `RULE_PACK_UPDATED` audit event.
2. Server-side bounds validation (the UI uses `Math.max(4, …)` and `Math.max(1, …)`, which is not authoritative).
3. `POST /rule-packs/:id/synthetic-test` runs the scenario in a rolled-back transaction or against flagged `isSynthetic` rows excluded from all metrics, which satisfies the UI's "Live Data Isolation" promise.
4. **SLA monitor job** runs every few minutes on pg-boss:
   - Finds open cases past `ackDueAt` and sets them to Overdue SLA (derived), then emits one `SLA_ESCALATION_TRIGGERED` audit event per breach (idempotent).
   - Applies red-flag rules: for example cancer red flags unacknowledged over 24h, and severe hypertension routed to a human within 4h. Model these as structured rule JSON, not free text, and keep the text for display only.
   - Notifies the coordinator and clinical lead.
5. `GET /escalations` returns cases where status is Overdue SLA, stage is Escalated, `redFlag` is set, or SLA remaining is 12 hours or less (matching the `EscalationsView` filter).

**Exit:** a case left unacknowledged past its SLA automatically appears in the escalation queue with an audit entry. No manual trigger is needed.

> **Phase 6 as built** (differences from the steps above, and why)
> - **Pack ids are the stable key** (`RP-CANCER`), not a row id, so the URL survives new versions. `PATCH` publishes a new version row; earlier versions are never edited, every open referral stays pinned to the version it was created under, and the audit entry says so. `GET /rule-packs/:key/versions` is the approval history (who approved which version).
> - **Bounds are enforced on the server and checked together:** acknowledgment and contact 1-168h, evaluation 1-90 days, red-flag timer 1-168h; contact <= acknowledgment, evaluation target after the acknowledgment deadline, red-flag timer within the evaluation target. Activating a pathway requires a named clinical owner (a Partner Clinical Lead).
> - **Red-flag rules are structured** (`redFlagPolicy.unacknowledgedHours`), enforced by the monitor; the original wording stays for display. Cancer = 24h, NCD = 4h; the male-health and MCH wording describes routing, not a timer, so they have none.
> - **The monitor** records each missed deadline once (`SlaBreach`, unique per case + kind + deadline: safe under concurrent runs and multiple instances) and audits it as `SLA_BREACH_DETECTED`. Red-flag breaches additionally **escalate the referral** (`SLA_ESCALATION_TRIGGERED`). It never overrides a person: once someone clears an escalation the same deadline is not escalated again. A resolved barrier gives a new deadline, which can breach again.
> - **Notifications:** in-app (bell + `GET /notifications`), plus plain-text email when SMTP is configured. Text carries the referral number and facility only, never patient details. Recipients: the case owner, and the pack's clinical owner (or every active clinical lead if none is named).
> - **The synthetic gate test is real.** The old screen printed four hard-coded "success" lines whatever the rules were, including a "failed-contact fallback" that does not exist yet. The new one runs the actual monitor against fixture referrals inside a transaction that is always rolled back, reports PASSED / FAILED / SKIPPED per check using the pack's own numbers, then verifies nothing was left behind. The only trace is one `RULE_PACK_GATE_TESTED` audit entry. The failed-contact fallback check returns with Phase 7.
> - **`GET /escalations`** implements the dashboard's attention rule server-side (a test proves both agree); the screen itself still filters the case list it already holds.
> - **Not done:** applying a changed SLA to referrals that are already open (deliberately: they keep their pinned rules).

### Phase 7: Patient communications and consent (2.5 days)
1. Templates: CRUD with an approval workflow (`reviewedBy`, `approvedAt`). Only approved templates can be sent. Validate placeholders. Lint that bodies contain no clinical terms.
2. `POST /cases/:id/messages {templateId, channel}`:
   - **Hard-block** if the latest consent for that channel is not granted or the patient is opted out. Return `BLOCKED_OPTOUT`, write a `MESSAGE_BLOCKED_OPTOUT` audit event, and route to a human task. The block happens on the server, not just in the UI.
   - Otherwise enqueue a `sendMessage` job. The provider adapter sends and records `providerMessageId`.
3. `POST /webhooks/africastalking` (and WhatsApp) handles delivery receipts, moving the log from `SENT` to `DELIVERED` or `READ`. Verify signatures and make the handler idempotent.
4. Inbound replies ("1", "NDIYO", "STOP"): parse and update consent or opt-out automatically. Writes `CONSENT_OPTOUT_RECORDED`.
5. `PUT /patients/:id/consent` (DPO role) records an append-only consent row, replacing the current `handleToggleOptOut` boolean flip.
6. Quiet hours, per-patient rate limits, and retry with backoff.
7. A `MockProvider` for dev and tests, selected by env.
8. **Frontend:** `CommsConsentView` calls the real endpoints. The delivery log polls or uses SSE.

**Exit:** an opted-out patient cannot be messaged by any path. Delivery receipts update the log.

> **Phase 7 as built** (differences from the steps above, and why)
> - **Consent is enforced twice.** At request time (`POST /cases/:id/messages`) per channel (SMS consent does not allow WhatsApp; an opt-out blocks everything), and again at the moment of sending, because a patient can reply STOP between queueing and sending. A refusal is recorded in the delivery log, audited, and handed to a person (a notification to the case owner); it never just disappears. The old screen recorded "Delivered" for everything and only looked at the case-level opt-out.
> - **Nothing is sent from the request.** Messages are queued; a worker (database-backed queue, `FOR UPDATE SKIP LOCKED`, safe across instances) delivers them. Quiet hours (21:00-07:00 EAT), a limit of 3 automated messages per patient per 24h (race-safe), and retries with backoff (1 min, 5 min, 30 min, 2 h, then give up) all live there. A retry is never scheduled into quiet hours.
> - **A missed message is better than a duplicate.** If a worker dies mid-send we cannot know whether the provider accepted the message, so it is marked failed and a person is asked to check; it is not retried.
> - **Templates have an approval workflow:** staff draft, the Partner Clinical Lead approves, only approved templates can be sent, and editing approved wording withdraws the approval. Wording is linted (no clinical terms in English or Kiswahili, no links, only `{facility}` and `{phone}`), and re-checked at approval and again at send time. The lint flagged the demo template TPL-01 ("...from the screening team"): "screening" reveals a health screening to anyone reading a lock screen, so the demo wording was changed. Remove "screening"/"screened" from `CLINICAL_TERMS` if your clinical advisers disagree.
> - **Patient phone numbers** did not exist anywhere. They are captured at intake (form, CSV column 8, or `PUT /cases/:id/contact`), normalised to E.164, stored encrypted, never returned by the API (only `hasPhone`) and never written to the audit trail or logs. A keyed hash (deliberately not organisation-scoped) lets a reply find the patient.
> - **Webhooks** (`/api/webhooks/messaging/delivery|inbound`) are authenticated by a shared secret on the URL (`MESSAGING_WEBHOOK_SECRET`, redacted from logs). Receipts only move a message forward (a late "Sent" cannot undo "Delivered"). Patient replies are understood by keyword (STOP/ACHA, START/ANZA, 1/NDIYO) and **the reply text is never stored**; STOP applies to every programme that has been messaging that number.
> - **Provider:** an Africa's Talking SMS adapter, written from the provider's documented API and tested against recorded-style responses only. It has never talked to the live service: verify against the AT sandbox (`AT_BASE_URL`) before go-live. WhatsApp is not wired to any provider yet (such a request is handed to a person). A mock provider is used in development and tests and simulates delivery receipts in development.
> - **Synthetic gate test** gained the two checks Phase 6 promised: a patient who opted out is never messaged, and an undeliverable message reaches a person.
> - **Not done:** inbound WhatsApp, voice calls, per-organisation quiet hours, and deleting/ageing out old delivery logs (Phase 11).

### Phase 8: Reporting and dashboard metrics (1.5 days)
Move the client-side aggregations to the server so they are accurate over paginated data.
1. `GET /metrics/overview` returns:
   - cumulative funnel (5 steps as defined in `OverviewView.FUNNEL_ORDER`)
   - counts by pathway
   - active, awaiting-ack and overdue counts
   - completion rate
   - median time-to-acknowledge and time-to-close
   - verified-closed count
2. `GET /metrics/upcoming` returns appointments due in the next 7 days. Replace the hard-coded reference date `'2026-11-19'` in `DashboardSummary` with server `now`.
3. Optional: a nightly materialised view for large tenants. Add indexes on `(orgId, stage)`, `(orgId, facilityId)` and `(orgId, ackDueAt)`.
4. Scheduled funder or clinical-governance report generation, reusing the export job.

**Exit:** the Overview screen renders from `/metrics/overview` only.

#### Phase 8 as built

- **Server-side metrics.** `GET /api/metrics/overview` (funnel, status counts, the four summary-card figures, per-pathway
  table, median time to acknowledge / to verified close with sample sizes) and `GET /api/metrics/upcoming` (count plus the
  soonest 10 referrals). The arithmetic is one pure module (`server/modules/metrics/compute.ts`) that uses `deriveStatus`,
  so the Overview, the exports and the SLA monitor cannot disagree. Funnel steps live in `shared/types.ts` (`FUNNEL_STEPS`).
  Both endpoints exclude simulation referrals, are scoped like the case list (a facility focal sees only their facility),
  and carry no patient data. "Today" is a calendar day in East Africa Time, so "due this week" is day 0 to day +7 EAT.
- **Parity is tested, not assumed.** `metrics.test.ts` keeps the formulas the screen used to run in the browser as a
  reference and asserts the server returns the same numbers on a mixed dataset, including the EAT-midnight and day +7/+8
  boundaries. One pre-existing quirk is preserved on purpose: funnel step 3 ("Acknowledged") counts by stage, so an
  escalated referral the facility had already acknowledged is not in it.
- **Frontend.** `useMetrics` reloads whenever the workspace's case list changes (every action and its 60 s refresh);
  `OverviewView`/`DashboardSummary` render the server figures, keep the last good numbers on a failed refresh, and show
  the two medians. The priority queue still derives from the loaded cases (it needs rows, not counts).
- **Reports.** New export type `GOVERNANCE_CSV` (programme performance by pathway and facility, with subtotals and a
  programme total; aggregates only, no patient identifiers) and `ReportSchedule` (weekly = Mondays, monthly = the 1st,
  06:00 EAT). `reportScheduler` queues an ordinary `ExportJob` in the owner's name for the period that just ended, so the
  existing worker, retention, signed download and audit apply. Claimed by compare-and-set on `nextRunAt` (safe on several
  servers); after downtime it produces one catch-up report, not a backlog; it pauses (and audits) a schedule whose owner
  lost export access. `/api/report-schedules` needs `exports.create`; capped at 10 per organisation; the audit-trail
  export cannot be scheduled (also enforced by a DB CHECK).
- **Deliberately not built: the materialised view.** Metrics are computed per request over a narrow select (no patient
  data) using the existing `(orgId, stage|facilityId|slaDueAt|pathway)` indexes. That is comfortable for pilot volumes
  (the workspace already loads every case). If an organisation reaches tens of thousands of referrals, add a rollup table
  refreshed by the SLA monitor behind the same endpoints; nothing else changes.

### Phase 9: Public site, leads and the AI layer (1 day)
1. `POST /leads` from `DiscoveryModal`. Zod validation (matching the current regex check), honeypot field and strict rate limit, and no auth. Email notification to the team.
2. **`@google/genai` (optional, scoped):** the dependency and `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` suggest AI was planned. Keep the server-side key and **never send identifiable patient data**. Reasonable low-risk uses: drafting Kiswahili/English template variants for clinical review, and summarising de-identified programme metrics. Anything touching clinical decisions stays out of scope, because the product pitch is *deterministic* rules approved by a clinical lead.

#### Phase 9 as built

- **`POST /api/leads`** (public, no auth) behind `DiscoveryModal`. Validation matches the form's email check plus length
  caps and no control characters (so names cannot inject mail headers); the email is lower-cased. A filled honeypot field
  or a repeat of the same email + pathway within 24 h is dropped silently and still returns `202 {ok:true}`, so bots learn
  nothing and double-clicks make no duplicates. Strict per-IP limit (5/hour). The lead is saved first; the team email
  (`LEADS_NOTIFY_EMAIL`, needs `SMTP_URL`) is best effort and never fails the request.
- **Frontend.** The modal posts to the server, shows a sending state, maps server errors (validation, rate limit, network)
  to messages, and its confirmation text no longer claims a brief was already prepared. Hidden honeypot input.
- **Not built: the AI layer.** It was marked optional, needs a live key to verify, and `@google/genai` is still an unused
  dependency. If added: server-side only, de-identified inputs only, drafts for clinical review, never rules or decisions.

### Phase 10: Interoperability (Phase 2 product scope, 3+ days)
The landing copy promises "secure CSV now, partner EMR APIs and FHIR later".
1. Per-facility API keys (hashed, scoped) for `Status-Return` callbacks, with an HMAC-signed webhook for `acknowledge` and `outcome`.
2. A FHIR R4 `ServiceRequest` (outbound referral) and `Task` (status return) mapping layer. Keep it behind an adapter so the core domain stays FHIR-agnostic.
3. SFTP or portal drop for the `Portal + CSV` facilities.

#### Phase 10 as built

- **Facility API keys.** `FacilityApiKey` (per facility, scoped `referrals:read` / `referrals:identify` / `status:write`,
  optional expiry, revocable, max 5 active per facility). Managed by the programme manager at
  `/api/facilities/:id/api-keys` (permission `integrations.manage`). The secret and a separate HMAC **signing secret** are
  shown once; only a SHA-256 of the secret and an encrypted signing secret are stored, and the audit trail records the key's
  name and scopes, never a secret. One identical `401` for unknown / wrong / revoked / expired keys.
- **Signed callbacks.** `POST` calls need `X-Pathora-Signature: t=…,v1=HMAC-SHA256(secret, "<t>." + raw body)` with a 5-minute
  window (the timestamp is part of what is signed). The integration routes keep the body raw so the exact bytes are verified.
- **Status return** (`/api/integrations/v1`): `referrals/:ref/acknowledge|attendance|outcome`, FHIR `Task`, and a CSV
  upload. They call the **same case actions as the dashboard** (state machine, optimistic lock, audit, SLA reset) as the
  facility's own identity: scoped to that facility (another facility's or organisation's referral is a 404), recorded as
  "Facility system (API)", with no person attributed. Idempotent (a repeat returns `already_recorded`), safe under races, and
  out-of-order steps are refused rather than back-filled.
- **FHIR R4 adapter** (`server/integrations/fhir`): `ServiceRequest` (outbound referral), `Task` (status), searchset
  `Bundle`, `CapabilityStatement`, `OperationOutcome` errors. The core domain knows nothing about FHIR. Patients are
  identified by programme code only unless the key has `referrals:identify`; each release of names is audited.
- **File route:** `GET /referrals.csv` and `POST /status-returns.csv` (up to 500 rows, per-row results) for Portal + CSV
  facilities. Integrator guide: `docs/facility-integration.md`.
- **Limits:** 300 requests/minute per key; failed authentication is throttled per IP (successes never count toward it).
- **Deliberately not built:** a hosted **SFTP** drop (needs infrastructure: a managed SFTP gateway writing to a bucket plus a
  worker that feeds the CSV endpoint's logic), **outbound push** of referrals to facility endpoints (facilities pull today;
  a push needs retries, dead-lettering and per-facility endpoint config), and a **UI** for key management (API only).

### Phase 11: Hardening, observability, deployment (2 days)
1. **Security:** OWASP review, secrets in a manager, CSP headers, dependency audit, backup and restore drill, and a pen-test checklist.
2. **Data protection:** retention purge job driven by `retentionDays`, a data subject access and erasure procedure (erasure must preserve the audit chain by redacting payloads, not rows), and a DPIA document.
3. **Observability:** pino JSON logs without PII, OpenTelemetry traces, and metrics for queue depth, SLA job lag and send failures.
4. **Deployment:** Dockerfile (multi-stage), the server serves the built `dist/` in production (Express static plus SPA fallback), and CI running lint, tests, migration check and build. The `APP_URL` placeholder indicates a Cloud Run target. Use a managed Postgres with PITR and a Kenyan or compliant region.

---

## 6. API summary (v1)

```
POST   /auth/signup | /auth/login | /auth/refresh | /auth/logout      GET /auth/me
POST   /leads                                                          (public)
GET    /organization                      PATCH /organization
GET    /users            POST /users/invite      PATCH /users/:id
GET    /facilities       POST /facilities        PATCH /facilities/:id
GET    /cases            POST /cases             GET /cases/:id
POST   /cases/import
POST   /cases/:id/acknowledge | /attendance | /close | /escalate | /barrier-resolution | /reassign
POST   /cases/:id/messages
GET    /escalations
GET    /templates        POST /templates         POST /templates/:id/approve
GET    /comms-log
PUT    /patients/:id/consent
GET    /rule-packs       PATCH /rule-packs/:id   POST /rule-packs/:id/synthetic-test
GET    /audit            GET /audit/verify
POST   /exports          GET /exports/:id
GET    /metrics/overview GET /metrics/upcoming
GET    /search?q=
POST   /webhooks/messaging | /webhooks/facility-status
```

---

## 7. Testing strategy
- **Unit (Vitest):** `sla.ts`, `stateMachine.ts`, consent resolution, CSV parser, audit hash chain. These are pure and critical.
- **Integration (Supertest + a throwaway Postgres):** every endpoint, plus **tenant isolation** and **RBAC** matrix tests (each role × each endpoint).
- **Contract:** generate OpenAPI from Zod and type-check the frontend client against it.
- **Property tests:** random transition sequences never reach an illegal state.
- **E2E (Playwright):** login → create referral → facility acknowledges → close, asserting audit rows.
- **Security:** opt-out cannot be bypassed on any send path, formula-injection export test, and token replay and rotation tests.

---

## 8. Frontend migration checklist
- [ ] Add router (React Router) and replace `viewMode` state in `App.tsx`. Protect `/dashboard/*`.
- [ ] `AuthProvider` and API client with refresh-on-401.
- [ ] Replace `INITIAL_*` seeds and `useState` data in `DashboardShell.tsx` (1263 lines) with queries and mutations. Consider splitting that file by view while doing so.
- [ ] Remove `nowTimestamp()`, ID generation, the hard-coded `'2026-11-19'` dates, and the hard-coded actors in `appendAudit` calls.
- [ ] Share enums and types from `shared/types.ts` and delete the duplicates in `dashboardData.ts`.
- [ ] Loading, empty and error states for each view (none exist today).
- [ ] Login and signup: remove the prefilled credentials and the "enter any details" copy.
- [ ] `DiscoveryModal` posts to `/leads` and handles server errors.
- [ ] Keep `pathoraData.ts` (static marketing content) as is.

---

## 9. Suggested timeline

| Phase | Effort | Cumulative |
|---|---|---|
| 0 Foundations | 1 d | 1 d |
| 1 Schema & seed | 1 d | 2 d |
| 2 Auth / RBAC | 1.5 d | 3.5 d |
| 3 Referral engine | 3 d | 6.5 d |
| 4 Audit & exports | 1.5 d | 8 d |
| 5 Facilities / team / org | 1 d | 9 d |
| 6 Rule packs & SLA monitor | 2 d | 11 d |
| 7 Comms & consent | 2.5 d | 13.5 d |
| 8 Metrics | 1.5 d | 15 d |
| 9 Leads (+ optional AI) | 1 d | 16 d |
| 11 Hardening & deploy | 2 d | 18 d |
| 10 Interop (post-pilot) | 3+ d | 21+ d |

**MVP for a pilot = Phases 0–6 plus the opt-out enforcement from Phase 7 (~13 working days).** Frontend integration work runs in parallel with each phase.

---

## 10. Open questions to resolve before building
1. **Hosting and data residency:** is Cloud Run (implied by `APP_URL`) acceptable, and must data stay in Kenya?
2. **Patient identity:** do we store names and phones at all, or only a programme-issued `patientCode` with contact handled by the coordinator? This is the biggest privacy lever.
3. **Messaging provider:** Africa's Talking, Twilio, or the WhatsApp Business API directly? This needs sender-ID and template approvals that have lead times.
4. **Tenancy model:** is each programme its own organisation, with facilities as cross-org partners who see only referrals addressed to them? The UI mixes both, so this needs a decision before the schema is final.
5. **Auth:** is email + password enough for the pilot, or do partners need SSO or MFA (recommended for facility and clinical roles)?
6. **Clinical sign-off:** who approves the structured red-flag rules (the Phase 6 JSON), given that the current rules are free-text strings?
7. **Case-ID format:** is `REF-YYYY-NNNN` per organisation or global?
