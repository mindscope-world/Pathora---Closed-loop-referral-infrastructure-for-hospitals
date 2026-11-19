# Data Protection Impact Assessment (draft)

**Status: DRAFT for review.** Prepared from how the system actually works. It is not legal advice and has not been
approved. It needs review and sign-off by the organisation's Data Protection Officer and legal counsel, and a decision
on registration with the Office of the Data Protection Commissioner (Kenya Data Protection Act, 2019). Items that
need a human decision are marked **[DECISION]**.

## 1. What the system does

Pathora tracks people referred from a screening programme (cancer, NCD, male reproductive health, maternal and child
health) to a receiving facility, from referral to a verified, documented outcome, so that no referral is lost. It sends
discreet reminders by SMS or WhatsApp, enforces deadlines, and keeps an audit trail.

## 2. Personal data held

| Data | Category | Where | Protection |
|---|---|---|---|
| Patient name | Identifier | `Patient.nameEnc` | AES-256-GCM, bound to the organisation |
| Phone number | Identifier / contact | `Patient.phoneEnc`, plus a keyed hash for matching an inbound STOP | AES-256-GCM; hash is keyed HMAC, not reversible |
| Programme patient code | Pseudonym | `Patient.patientCode` | Default identifier everywhere (UI, exports, FHIR, audit) |
| Referral pathway, facility, dates, stage | **Health-related** (special category) | `ReferralCase`, `CaseMilestone` | Role-based access; facility focals see only their facility |
| Referral notes, closure reason, outcome | **Health-related** free text | `ReferralCase` | Same; redacted on erasure |
| Consent records | Legal record | `Consent` (append-only) | No contact details; kept after erasure |
| Message text sent | Contact record | `CommsLog.body` | Discretion lint blocks clinical terms; removed on erasure |
| Inbound replies | Event only | `InboundMessage` | Reply text is **never stored**: only that it was an opt-out, restore, confirm or other |
| Staff names, emails | Staff identifiers | `User`, audit entries | Argon2id passwords; deactivation ends sessions |

## 3. Lawful basis and necessity

- Processing is for providing and following up health care the person has been referred for; special-category health
  data is processed for care and public-health programme purposes. **[DECISION]** Confirm the lawful basis and the
  health-data condition with counsel for each programme and partner.
- Messaging requires recorded consent per channel; opt-out is honoured on every send path (checked when a message is
  requested and again when it is sent).
- Data minimisation: exports, FHIR feeds and metrics identify people by programme code only; names reach a facility
  system only if its key was granted the `referrals:identify` scope, and each such release is audited.

## 4. Who sees what

Programme staff by role; the receiving facility only its own referrals; the DPO the audit trail and data-subject
tools; a facility's system, only through a scoped, revocable key. Cross-organisation access is blocked at the data layer
and covered by tests. **[DECISION]** Data-sharing agreements between the programme and each facility.

## 5. Risks and mitigations

| Risk | Likelihood / impact | Mitigation | Residual |
|---|---|---|---|
| Unauthorised access to referral data | Medium / high | RBAC, tenant scoping, lockout, short sessions, encryption of identifiers, audit | Low; no MFA yet (see security checklist) |
| Disclosure through an SMS seen by a third party | Medium / high | Discreet wording enforced by lint, no clinical terms, quiet hours, opt-out | Medium: SMS is not private; consent wording must say so **[DECISION]** |
| Over-retention | Medium / medium | Per-organisation `retentionDays`; hourly job erases personal data once every referral has been closed longer than the window | Low |
| Failure to honour erasure or access requests | Low / high | DPO tools: subject access export and erasure, both audited; erasure keeps the audit chain valid | Backups: see below |
| Tampering with the record of who did what | Low / high | Append-only, hash-chained audit trail; `scripts/verify-audit-chain.ts` | Low |
| Loss of a facility key or signing secret | Medium / medium | Hashed storage, scopes, expiry, instant revocation, per-key rate limits | Low |
| Provider (SMS) or hosting breach | Low / high | Provider receives only the number and the discreet text; hosting must be a compliant region with encryption at rest **[DECISION]** | Depends on hosting |
| Export files lingering | Medium / medium | Patient code only, signed expiring links, deleted after 7 days | Low |

## 6. Retention and erasure

- **Retention:** each organisation sets `retentionDays` (default 365). When every referral of a person has been closed for
  longer than that, their personal data is erased automatically. Open or recently closed follow-up is never touched.
- **What erasure removes:** name, phone and its lookup hash, name search tokens, cohort label, referral notes and closure
  narrative, and the text of messages sent to them.
- **What it keeps, and why:** the pseudonymous code and the referral rows (programme statistics and accountability), the
  consent history (a legal record without contact details), and the audit trail (append-only; it holds referral numbers and
  patient codes, never names or numbers, so it never needs to be altered).
- **On request:** the DPO uses `GET /api/privacy/patients/:code/export` (subject access) and `POST .../erasure` (refused
  while a referral is open). Both are audited.
- **Backups:** database backups taken before an erasure still contain the person's data until they expire. **[DECISION]**
  Set a backup retention period no longer than the shortest erasure commitment you are prepared to make, and follow
  the post-restore procedure in `docs/operations.md`.

## 7. Open items before go-live

1. DPO and counsel sign-off; ODPC registration **[DECISION]**
2. Lawful basis and consent wording per programme, including the SMS-privacy caveat **[DECISION]**
3. Data-sharing agreements with receiving facilities **[DECISION]**
4. Hosting region, encryption at rest, backup retention **[DECISION]**
5. Breach notification procedure (72-hour clock) and contacts **[DECISION]**
6. Independent penetration test (`docs/security-checklist.md`)
7. Multi-factor authentication for facility and clinical roles
