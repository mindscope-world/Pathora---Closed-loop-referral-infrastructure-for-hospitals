# Security review and pen-test checklist

An engineering review of the application against the OWASP Top 10, plus a checklist for an external penetration test.
It states what the code does today and what it does **not** do. It is not a substitute for an independent test.
Last reviewed against the code at Phase 11.

## 1. OWASP Top 10 (2021) review

| Risk | Controls in this codebase | Where verified |
|---|---|---|
| **A01 Broken access control** | Role → permission matrix (`shared/permissions.ts`) enforced server-side on every route; facility focals limited to their facility by `caseScope`; every tenant table filtered by `forOrg(orgId)`; cross-tenant and cross-facility access returns 404 (existence not leaked); integration keys act as one facility only | RBAC matrix, tenant-isolation, `integrations`, `privacy` tests |
| **A02 Cryptographic failures** | Patient name and phone encrypted with AES-256-GCM, context-bound (AAD per organisation); passwords hashed with argon2id; API secrets stored as SHA-256 of 256-bit random values; signing secrets encrypted; HMAC-SHA256 for signed links, webhooks and callbacks; constant-time comparisons; production refuses placeholder or reused secrets and a non-https `APP_URL` | `crypto`, `signedUrl`, `integrations`, `env` tests |
| **A03 Injection** | Prisma parameterised queries only (the few raw queries use tagged templates); zod validation on every body; CSV formula neutralisation on every export; single-line validation on text that reaches email headers, audit entries or CSV; React escapes output | `csv`, `leads`, `reports` tests |
| **A04 Insecure design** | State machine that never back-fills history; consent checked at request and again at dispatch; deterministic, clinician-approved rules (no AI in clinical decisions); least-data defaults (patient code, not name, in exports, FHIR and metrics) | `stateMachine`, `messages`, `integrations` tests |
| **A05 Security misconfiguration** | Helmet with a strict CSP (script-src `'self'` only, no eval, no inline script, `frame-ancestors 'none'`), HSTS, nosniff, no-referrer; CORS locked to `APP_URL`; production config guard; `no-store` on every authenticated or patient-data response; errors hide internals in production | `staticSite` (headers), `env` tests |
| **A06 Vulnerable components** | `npm audit --omit=dev --audit-level=high` in CI (0 known vulnerabilities at review); lockfile committed; multi-stage image with production dependencies only | CI |
| **A07 Authentication failures** | argon2id; per-account lockout shared across instances; per-IP limits; short-lived access tokens; rotating httpOnly refresh cookie with reuse detection; deactivation takes effect on the next request; API keys revocable and expiring | `auth` tests |
| **A08 Software and data integrity** | Append-only, hash-chained audit trail (database triggers block UPDATE/DELETE/TRUNCATE); `scripts/verify-audit-chain.ts` re-verifies any copy; signed, expiring download links; HMAC-signed, replay-windowed integration callbacks; migrations are reviewed SQL | `audit`, `integrations` tests; backup drill |
| **A09 Logging and monitoring failures** | Audit trail for every state change, access to personal data and administrative act; JSON logs with redaction and PII scrubbing of error text; request ids; `/metrics` for queue depth, job lag, send failures | `logger`, `ops` tests |
| **A10 Server-side request forgery** | The server never fetches a user-supplied URL. Outbound calls go only to the messaging provider and SMTP host named in environment configuration | review |

## 2. Known gaps (decide before go-live)

- **No multi-factor authentication.** Recommended for facility and clinical roles (plan open question 5).
- **No independent penetration test has been performed.** Use section 3.
- **No WAF, DDoS protection or bot defence.** Put the service behind the platform's load balancer and WAF. The public `/api/leads` form relies on a honeypot, dedupe and a per-IP limit only; add a CAPTCHA if abused.
- **CSP allows inline styles** (`style-src 'unsafe-inline'`) because React and the animation library set style attributes. Scripts are fully locked down.
- **Generated exports sit on local disk** (`EXPORT_DIR`). In production mount an encrypted persistent volume or implement the `FileStore` interface for object storage; files expire after 7 days.
- **Encryption at rest, point-in-time recovery, and data residency are hosting decisions**, not application features (see the operations runbook).
- **Secrets**: the app reads `NAME_FILE` paths (Secret Manager mounts). Rotating `FIELD_ENCRYPTION_KEY` needs the re-encryption job the crypto module describes but does not yet include.
- **No OpenTelemetry tracing** (logs and metrics only).
- **Backups hold erased data until they expire.** See `docs/operations.md` for the procedure after a restore.

## 3. Penetration-test checklist

Give the tester two organisations with one user per role, a facility API key, and a staging environment.

**Authentication and session**
- [ ] Brute-force login (single account, many accounts, many IPs); confirm lockout and uniform error text
- [ ] Refresh-token replay and theft detection; logout invalidation; token use after user deactivation
- [ ] Access-token tampering (alg none, key confusion, claim changes)
- [ ] Invitation links: reuse, expiry, guessing, acceptance for another organisation

**Authorisation (the highest-value area)**
- [ ] For every endpoint, each role: allowed and denied cases match `shared/permissions.ts`
- [ ] Organisation A user reading or changing organisation B data by id, reference number, patient code, export id, API key id
- [ ] Facility focal reading or acting on another facility's referral; focal without a facility
- [ ] Integration key: other facility's referral, read-only key writing, expired and revoked keys, forged or replayed signature, body tampering
- [ ] Metrics and ops: `/metrics` without token, with a user token; `/readyz` information leakage

**Input handling**
- [ ] CSV import: formula injection, huge files, malformed quoting, encoding tricks
- [ ] Exports: open generated CSVs in a spreadsheet; check formula cells are neutralised
- [ ] Newline, control-character and oversized input in every text field (header and audit-log injection)
- [ ] Idempotency-Key reuse across users and bodies
- [ ] Integration CSV upload and FHIR Task: malformed, oversized, wrong content type

**Data protection**
- [ ] Patient names, phone numbers or message text in logs, metrics, error responses, exports, audit entries
- [ ] Erasure: confirm nothing identifying remains in any table, export file or log after a subject erasure
- [ ] Subject-access export: only the DPO can fetch it, and every fetch is audited
- [ ] Opt-out cannot be bypassed on any send path, including retries after the opt-out

**Messaging and webhooks**
- [ ] Provider webhooks without or with a wrong secret; replayed delivery receipts; forged inbound STOP
- [ ] Message content: discretion lint cannot be bypassed by template edits

**Platform**
- [ ] TLS configuration, HSTS, cookie flags (`Secure`, `HttpOnly`, `SameSite=Strict`), CORS from a hostile origin
- [ ] CSP: attempt script injection through every reflected or stored text field
- [ ] Container: runs as non-root, no secrets in the image or `docker history`
- [ ] Rate limits behave behind the real load balancer (client IP taken from the right header)
