-- Phase 7: patient communications and consent.

ALTER TYPE "DeliveryStatus" ADD VALUE 'SENDING';
CREATE TYPE "InboundKind" AS ENUM ('OPT_OUT', 'RESTORE', 'CONFIRM', 'OTHER');

ALTER TABLE "Organization" ADD COLUMN "supportPhone" TEXT;

-- Phone numbers are stored encrypted (Patient.phoneEnc); this keyed hash lets an inbound reply find the patient.
ALTER TABLE "Patient" ADD COLUMN "phoneHash" TEXT;
CREATE INDEX "Patient_phoneHash_idx" ON "Patient"("phoneHash");

-- Templates: who approved, retirement, last edit.
ALTER TABLE "MessageTemplate"
  ADD COLUMN "approvedById" TEXT,
  ADD COLUMN "retiredAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "MessageTemplate" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CommsLog becomes a real delivery record. The old "sentAt" was really the request time, so it is renamed
-- and a true "sentAt" (provider acceptance) is added.
ALTER TABLE "CommsLog" RENAME COLUMN "sentAt" TO "requestedAt";
ALTER INDEX "CommsLog_orgId_sentAt_idx" RENAME TO "CommsLog_orgId_requestedAt_idx";
ALTER TABLE "CommsLog"
  ADD COLUMN "patientId" TEXT,
  ADD COLUMN "body" TEXT,
  ADD COLUMN "failureReason" TEXT,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "requestedById" TEXT,
  ADD COLUMN "sentAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "CommsLog" ALTER COLUMN "updatedAt" DROP DEFAULT;

UPDATE "CommsLog" l SET "patientId" = c."patientId" FROM "ReferralCase" c WHERE c.id = l."caseId";
UPDATE "CommsLog" SET "sentAt" = "requestedAt" WHERE status IN ('SENT', 'DELIVERED', 'READ');
ALTER TABLE "CommsLog" ALTER COLUMN "patientId" SET NOT NULL;

ALTER TABLE "CommsLog" ADD CONSTRAINT "CommsLog_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "CommsLog_patientId_requestedAt_idx" ON "CommsLog"("patientId", "requestedAt");
CREATE INDEX "CommsLog_status_nextAttemptAt_idx" ON "CommsLog"("status", "nextAttemptAt");

CREATE TABLE "InboundMessage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "caseId" TEXT,
    "providerMessageId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "kind" "InboundKind" NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InboundMessage_providerMessageId_patientId_key" ON "InboundMessage"("providerMessageId", "patientId");
CREATE INDEX "InboundMessage_orgId_receivedAt_idx" ON "InboundMessage"("orgId", "receivedAt");
ALTER TABLE "InboundMessage" ADD CONSTRAINT "InboundMessage_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InboundMessage" ADD CONSTRAINT "InboundMessage_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
