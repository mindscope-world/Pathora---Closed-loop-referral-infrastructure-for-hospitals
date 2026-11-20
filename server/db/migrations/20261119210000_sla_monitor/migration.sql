-- Phase 6: rule-pack governance and the SLA monitor.

CREATE TYPE "SlaBreachKind" AS ENUM ('DEADLINE_PASSED', 'RED_FLAG_UNACKNOWLEDGED');

-- Structured red-flag rule (what the monitor enforces); the existing text column stays as display wording.
ALTER TABLE "RulePack"
  ADD COLUMN "redFlagPolicy" JSONB NOT NULL DEFAULT '{"unacknowledgedHours": null}',
  ADD COLUMN "editedById" TEXT;

-- Existing packs: carry the timers their wording already described.
--   Cancer: "…unacknowledged > 24h"      NCD: "…within 4 hours"
--   Male reproductive health / MCH describe routing, not a timer, so they stay null.
UPDATE "RulePack" SET "redFlagPolicy" = '{"unacknowledgedHours": 24}' WHERE key = 'RP-CANCER';
UPDATE "RulePack" SET "redFlagPolicy" = '{"unacknowledgedHours": 4}'  WHERE key = 'RP-NCD';

-- Consistency of a pack's own timers: the first contact window cannot be longer than the
-- acknowledgment window, and the evaluation target must fall after the acknowledgment deadline.
ALTER TABLE "RulePack"
  ADD CONSTRAINT rulepack_contact_within_ack CHECK ("contactSlaHours" <= "ackSlaHours"),
  ADD CONSTRAINT rulepack_eval_after_ack CHECK ("evalTargetDays" * 24 > "ackSlaHours");

CREATE TABLE "SlaBreach" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "kind" "SlaBreachKind" NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlaBreach_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SlaBreach_caseId_kind_deadline_key" ON "SlaBreach"("caseId", "kind", "deadline");
CREATE INDEX "SlaBreach_orgId_detectedAt_idx" ON "SlaBreach"("orgId", "detectedAt");
ALTER TABLE "SlaBreach" ADD CONSTRAINT "SlaBreach_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SlaBreach" ADD CONSTRAINT "SlaBreach_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ReferralCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "caseRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");
CREATE INDEX "Notification_orgId_createdAt_idx" ON "Notification"("orgId", "createdAt");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
