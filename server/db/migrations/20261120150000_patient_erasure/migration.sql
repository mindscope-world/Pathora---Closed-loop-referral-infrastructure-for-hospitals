-- Phase 11: erasing a person's personal data without deleting the rows the audit trail and history point to.
ALTER TABLE "Patient" ADD COLUMN "erasedAt" TIMESTAMP(3);
CREATE INDEX "Patient_orgId_erasedAt_idx" ON "Patient"("orgId", "erasedAt");
