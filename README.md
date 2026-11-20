# Pathora

Closed-loop referral infrastructure for screening and preventive-care programmes. Pathora tracks every person referred
from a screening programme to a receiving facility, from referral to a **verified, documented outcome**, so that no
referral is lost: deadlines are enforced, facilities confirm each step, patients are reminded discreetly with their
consent, and every action is recorded in a tamper-evident audit trail.

## What it does

- **Referral lifecycle:** a state machine that never back-fills history, deadlines (SLAs) per pathway, escalation, named
  ownership, CSV import, search.
- **Pathway rules:** versioned rule packs approved by a clinical lead; each referral is pinned to the version it started under.
- **Patient communications:** SMS/WhatsApp from approved templates only, consent checked when a message is requested *and*
  again when it is sent, quiet hours, opt-out honoured on every send path.
- **Facility integration:** per-facility API keys, signed status-return callbacks, a FHIR R4 adapter and CSV pull/upload.
  See [`docs/facility-integration.md`](docs/facility-integration.md).
- **Reporting:** server-side dashboard metrics, CSV exports with signed expiring links, scheduled funder and
  clinical-governance reports.
- **Accountability and privacy:** an append-only, hash-chained audit trail; patient names and phone numbers encrypted at rest;
  automatic retention; subject-access and erasure tools for the data protection officer.

Roles: Programme Manager, Programme Coordinator, Receiving Facility Focal, Partner Clinical Lead, Data Protection Contact (DPO). What each can
do is defined once in [`shared/permissions.ts`](shared/permissions.ts) and enforced on the server.

## Stack

React 19 + Vite + Tailwind (frontend) · Express 4 + TypeScript (API) · Prisma 7 + PostgreSQL 16 · zod · vitest + supertest.
The API serves the built frontend in production, so there is one deployable.

```
src/       frontend            server/    API: modules/ (features), jobs/ (background work), db/ (schema, migrations)
shared/    types and the role/permission matrix used by both sides
docs/      guides (see below)  scripts/   backup/restore drill and audit-chain verifier
```

## Run it locally

You need **Node.js 22** and **Docker** (for Postgres).

```bash
cp .env.example .env
# Fill in the three secrets in .env. Generate each one:
#   openssl rand -base64 48     -> JWT_SECRET and COOKIE_SECRET (use two different values)
#   openssl rand -base64 32     -> FIELD_ENCRYPTION_KEY (must be exactly this: 32 bytes, base64)

npm install
npm run db:up        # starts Postgres in Docker
npm run db:deploy    # applies the database migrations
npm run db:seed      # demo organisation, users and referrals (local use only)
npm run dev:all      # web on http://localhost:3000, API on http://localhost:4000
```

The seed creates demo accounts for every role at `@demo.pathora.test` and prints a couple of logins when it finishes; the full
list and the demo password are in [`server/db/seed.ts`](server/db/seed.ts) (override the password with `SEED_PASSWORD`).
**Never run the seed against a real system.**

Useful commands:

| Command | Does |
|---|---|
| `npm test` | Runs the test suite (needs `npm run db:up`; it uses its own throwaway `pathora_test` database) |
| `npm run lint` / `npm run lint:server` | Type-checks the frontend / the server |
| `npm run build` / `npm run build:server` | Builds the frontend into `dist/` / bundles the server into `server.js` |
| `npm run db:studio` | Opens Prisma Studio on the database |

Continuous integration (`.github/workflows/ci.yml`) type-checks, checks the migrations match the schema, runs the tests, builds,
audits dependencies and builds the Docker images.

## Deploy on Railway

[`railway.json`](railway.json) tells Railway how to build and release the app: the `Dockerfile`, a migration step before each
release, and a health check. The service is one Docker web service (API + frontend) plus one Railway Postgres database, which
you add in the dashboard. The full walkthrough, with a check for each step, is
[`docs/railway-deployment.md`](docs/railway-deployment.md). In short:

**1. Decide first**
- **Region.** Railway has no African region, so where Kenyan patient data may be hosted is a data-protection decision. Settle it
  before real patient data goes in (see [`docs/dpia.md`](docs/dpia.md)). Put the service and database in the same region.
- **Always on.** Do not enable App Sleeping: the deadline monitor, message sender and retention job run inside the service, and a
  service that sleeps would silently stop them.
- **Messaging provider.** `africastalking` sends real SMS/WhatsApp; `mock` sends nothing (it only pretends).

**2. Prepare the encryption key** on your own machine and keep a copy **outside Railway** (a password manager):

```bash
openssl rand -base64 32
```

> If `FIELD_ENCRYPTION_KEY` is lost or changed, every encrypted patient name and phone number is permanently unreadable.
> There is no recovery and no key-rotation tool yet.

**3. Create it.** In Railway choose **New Project → Deploy from GitHub repo**, add a **PostgreSQL** database to the project, generate
a domain for the service, and set the variables listed in the guide (`DATABASE_URL`, generated `JWT_SECRET` and `COOKIE_SECRET`,
`FIELD_ENCRYPTION_KEY`, `APP_URL`, `MESSAGING_PROVIDER`, `TRUST_PROXY`). Railway builds the image, runs the database migrations
*before* the new version starts (a failed migration aborts the deploy), then starts it.

> **`APP_URL` must exactly match the address people type in the browser** (same scheme, host and port; `www` is not the bare
> domain). Requests from any other origin are refused with `403 CORS_DENIED`, so a wrong value makes **sign-in fail for
> everyone**. Generate the domain first and paste the real `https://…up.railway.app` address as `APP_URL`; if you later attach a custom domain, update `APP_URL` and redeploy.

**4. Check it works.**

```bash
curl -s https://YOUR-HOST/readyz     # {"status":"ready"}  (503 means it cannot reach the database)
```

Then open the site and sign up: that creates your organisation and its first Programme Manager. Do not run the demo seed.

**5. Verify the client address (before real traffic).** Per-IP rate limits depend on the app seeing each visitor's real
address, and how many proxies Railway puts in front of the service is something to confirm, not assume. Set a `METRICS_TOKEN`
and follow check 5 in the guide; it tells you whether to raise or lower `TRUST_PROXY`.

Optional afterwards: email (`SMTP_URL`), a real messaging provider, a custom domain (update `APP_URL`), a volume if exports must
survive deploys. Everything is in the guide.

## Configuration

All settings are environment variables, validated at startup; in production the server refuses to start on placeholder
secrets, a reused JWT/cookie secret, or an `http` `APP_URL`. Any variable can also be supplied as a file with `NAME_FILE=/path`
(for secret managers). [`.env.example`](.env.example) lists them with explanations; [`docs/operations.md`](docs/operations.md)
covers them for operators.

## Documentation

| | |
|---|---|
| [`docs/railway-deployment.md`](docs/railway-deployment.md) | Deploying on Railway, step by step, with post-deploy checks |
| [`docs/operations.md`](docs/operations.md) | Configuration, alerts and metrics, backups and the restore drill, data-subject requests, incidents |
| [`docs/facility-integration.md`](docs/facility-integration.md) | How a facility's system returns status and pulls referrals (API keys, signing, FHIR, CSV) |
| [`docs/security-checklist.md`](docs/security-checklist.md) | Security review against the OWASP Top 10, known gaps, penetration-test checklist |
| [`docs/dpia.md`](docs/dpia.md) | Draft data protection impact assessment (needs sign-off by people) |
| [`plan.md`](plan.md) | The build plan and what each phase delivered |

## Known gaps

No multi-factor authentication; no independent penetration test; no hosted SFTP drop or outbound push to facilities; exports are
written to local disk; no distributed tracing. The security checklist and the "Not built" notes in `plan.md` track these. The
Africa's Talking messaging adapter has only been exercised against the built-in mock provider.
