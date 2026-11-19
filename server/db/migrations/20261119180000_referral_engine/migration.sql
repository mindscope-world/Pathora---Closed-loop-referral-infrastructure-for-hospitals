-- Phase 3: referral engine.

-- ── ReferralCase.ackDueAt → slaDueAt ─────────────────────────────────
-- Hand-edited from the generated diff: a true RENAME keeps existing data, where Prisma's
-- generated DROP COLUMN / ADD COLUMN would discard it.
ALTER TABLE "ReferralCase" RENAME COLUMN "ackDueAt" TO "slaDueAt";
ALTER INDEX "ReferralCase_orgId_ackDueAt_idx" RENAME TO "ReferralCase_orgId_slaDueAt_idx";
ALTER TABLE "ReferralCase" RENAME CONSTRAINT case_ack_due_after_issue TO case_sla_due_after_issue;

-- ── Consent events (opt-out / restore are explicit, not inferred) ────
CREATE TYPE "ConsentEvent" AS ENUM ('CAPTURED', 'OPTED_OUT', 'RESTORED');
ALTER TABLE "Consent" ADD COLUMN "event" "ConsentEvent" NOT NULL DEFAULT 'CAPTURED';

-- ── Blind index for searching encrypted patient names ────────────────
ALTER TABLE "Patient" ADD COLUMN "nameTokens" TEXT[] DEFAULT ARRAY[]::TEXT[];
CREATE INDEX "Patient_nameTokens_idx" ON "Patient" USING GIN ("nameTokens");

-- ── Idempotency keys ─────────────────────────────────────────────────
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "statusCode" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IdempotencyKey_createdAt_idx" ON "IdempotencyKey"("createdAt");
CREATE UNIQUE INDEX "IdempotencyKey_orgId_userId_key_key" ON "IdempotencyKey"("orgId", "userId", "key");

-- Case ids are issued as REF-YYYY-NNNN; keep the format honest at the DB level too.
ALTER TABLE "ReferralCase"
  ADD CONSTRAINT case_ref_number_format CHECK ("refNumber" ~ '^REF-[0-9]{4}-[0-9]{4,}$' OR "isSynthetic");
