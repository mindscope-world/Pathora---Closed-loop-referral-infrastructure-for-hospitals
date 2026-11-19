-- Integrity rules Prisma's schema language cannot express.
-- Hand-written; keep in sync with plan.md §4.

-- ── Append-only tables ───────────────────────────────────────────────
-- Enforced in the database (not just the app) so even a compromised app credential or an ad-hoc
-- psql session cannot rewrite the audit trail. Retention/erasure (Phase 11) will redact payloads
-- through an explicit, audited procedure rather than by bypassing this.
CREATE OR REPLACE FUNCTION pathora_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% on "%" is not permitted: the table is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_append_only
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION pathora_reject_mutation();

CREATE TRIGGER audit_event_no_truncate
  BEFORE TRUNCATE ON "AuditEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION pathora_reject_mutation();

CREATE TRIGGER consent_append_only
  BEFORE UPDATE OR DELETE ON "Consent"
  FOR EACH ROW EXECUTE FUNCTION pathora_reject_mutation();

-- ── CHECK constraints ────────────────────────────────────────────────
ALTER TABLE "User"
  ADD CONSTRAINT user_facility_focal_has_facility
  CHECK (role <> 'FACILITY_FOCAL' OR "facilityId" IS NOT NULL);

ALTER TABLE "Organization"
  ADD CONSTRAINT organization_retention_positive CHECK ("retentionDays" > 0);

ALTER TABLE "RulePack"
  ADD CONSTRAINT rulepack_sla_positive
  CHECK ("ackSlaHours" > 0 AND "contactSlaHours" > 0 AND "evalTargetDays" > 0),
  ADD CONSTRAINT rulepack_version_positive CHECK (version > 0);

-- A case can only be Closed with a documented, attributed outcome.
ALTER TABLE "ReferralCase"
  ADD CONSTRAINT case_closed_requires_outcome
  CHECK (stage <> 'CLOSED'
         OR ("closedAt" IS NOT NULL AND "closureReason" IS NOT NULL AND "outcomeSource" IS NOT NULL)),
  ADD CONSTRAINT case_ack_due_after_issue CHECK ("ackDueAt" >= "issuedAt");

ALTER TABLE "RefSequence"
  ADD CONSTRAINT refsequence_non_negative CHECK ("lastValue" >= 0);

-- Encrypted blobs must at least contain the envelope header: version(1) + iv(12) + tag(16).
ALTER TABLE "Patient"
  ADD CONSTRAINT patient_name_envelope CHECK (octet_length("nameEnc") >= 29),
  ADD CONSTRAINT patient_phone_envelope CHECK ("phoneEnc" IS NULL OR octet_length("phoneEnc") >= 29);

ALTER TABLE "AuditEvent"
  ADD CONSTRAINT audit_hash_format
  CHECK (hash ~ '^[0-9a-f]{64}$' AND "prevHash" ~ '^[0-9a-f]{64}$');
