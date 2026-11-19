# Operations runbook

## Deploying

One image serves the API and the built frontend. Build two targets from the same commit:

```bash
docker build --target runtime -t pathora:<version> .     # the app
docker build --target migrate -t pathora-migrate:<version> .   # applies database migrations
```

Release order: **run the migrate image first** (`docker run --rm -e DATABASE_URL=... pathora-migrate:<version>`), then roll out the
new app. Migrations are written to be applied before the old version stops serving.
CI (`.github/workflows/ci.yml`) type-checks, applies the migrations to a fresh database and fails if `schema.prisma` has
changes no migration creates, runs the tests, builds both targets and audits dependencies.

The container runs as a non-root user, listens on `PORT` (4000), serves `/healthz` (liveness) and `/readyz` (can reach the
database; use this for the load balancer). Terminate TLS at the platform load balancer and keep `trust proxy` accurate so
per-IP limits see client addresses.

## Configuration

Required: `DATABASE_URL`, `APP_URL` (**https** in production), `JWT_SECRET`, `COOKIE_SECRET` (different values),
`FIELD_ENCRYPTION_KEY` (base64, 32 bytes). **The server refuses to start in production** with placeholder values, a reused
JWT/cookie secret, or an http `APP_URL`.

Secrets from a secret manager: set `NAME_FILE=/path/to/mounted/secret` instead of `NAME` (works for any variable, e.g.
`JWT_SECRET_FILE`, `DATABASE_URL_FILE`, `AT_API_KEY_FILE`). Never bake secrets into the image; `.env*` is excluded from it.

Optional: `SMTP_URL`/`MAIL_FROM` (invitations, SLA emails, lead notifications), `LEADS_NOTIFY_EMAIL`, messaging provider
(`MESSAGING_PROVIDER=africastalking`, `AT_*`, `MESSAGING_WEBHOOK_SECRET`), `EXPORT_DIR` (mount an encrypted persistent volume),
`STATIC_DIR` (default `dist` in production), `METRICS_TOKEN` (enables `/metrics`; unset = endpoint does not exist).

## Monitoring

Scrape `GET /metrics` with `Authorization: Bearer $METRICS_TOKEN`. Suggested alerts:

| Signal | Alert when |
|---|---|
| `pathora_job_lag_seconds{job="sla_monitor"}` | > 600 for 10 min (breaches are not being detected) |
| `pathora_job_lag_seconds{job="message_worker"}` | > 300 for 10 min |
| `pathora_job_lag_seconds{job="retention_purge"}` | > 7200 |
| `pathora_messages_overdue_age_seconds` | > 600 (messages are not leaving the queue) |
| `pathora_messages_failed_24h` | sudden rise (provider or credentials problem) |
| `pathora_export_oldest_pending_age_seconds` | > 300 |
| `pathora_report_schedules_late` | > 0 for 15 min |
| `pathora_db_up` | = 0 |
| `rate(pathora_http_requests_total{status="5xx"}[5m])` | above your baseline |

A job's lag is measured from its last **successful** run and per process: with several instances, alert on the minimum.
Metrics carry no organisation, person, referral or facility identifiers. Logs are JSON on stdout (redacted; phone numbers and
emails are scrubbed from error text); ship them with the platform's collector.

## Backups and the restore drill

Use managed Postgres with point-in-time recovery, in a region your data-protection approval allows. Prove restores work:

```bash
DATABASE_URL=postgresql://user:pass@host:5432/pathora scripts/backup-restore-drill.sh
# local development (pg tools live in the docker container):
PG_DOCKER=pathora-postgres DATABASE_URL=postgresql://pathora:pathora@localhost:5432/pathora scripts/backup-restore-drill.sh
```

It dumps, restores into a scratch database, compares row counts, and **re-verifies every organisation's audit hash chain in
the restored copy**, then drops the scratch database. Run it on a schedule against a staging copy and keep the output.
`npx tsx scripts/verify-audit-chain.ts` (with `SCRATCH_DB_URL` or `DATABASE_URL`) can be run alone after any restore.

**After restoring a backup,** a person whose data was erased after that backup was taken will have their data back.
Before reopening access, re-apply every erasure recorded since the backup time: list the `PATIENT_DATA_ERASED` audit events
from the live system (or its log archive) and repeat each through `POST /api/privacy/patients/:code/erasure`.

## Data-subject requests (DPO)

1. Identify the person's programme patient code (search by name in the dashboard).
2. **Access:** `GET /api/privacy/patients/:code/export` returns everything held (JSON). Each call is audited.
3. **Erasure:** `POST /api/privacy/patients/:code/erasure` with `{ "reason": "..." }`. Refused while a referral is open
   (close it, or decide the matter with the clinical lead). Idempotent. The audit trail is not altered.
4. Record the request and your response in your own log; the system records that the action happened and who did it.

Retention is automatic (`retentionDays` per organisation, set in Settings). The job runs hourly and also clears expired
login-throttle and replay-key rows.

## Incident basics

- **Suspected key or token exposure:** revoke the facility API key (`DELETE /api/facilities/:id/api-keys/:keyId`); rotate
  `JWT_SECRET` to end every session; rotate `MESSAGING_WEBHOOK_SECRET` and the provider callback URLs.
- **Suspected tampering:** run `scripts/verify-audit-chain.ts`; a break names the organisation and event.
- **Personal-data breach:** start the 72-hour notification process (contacts in the DPIA open items).
