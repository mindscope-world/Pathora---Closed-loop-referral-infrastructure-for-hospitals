-- Phase 8: scheduled funder / clinical-governance reports.
-- (The (orgId, stage|facilityId|slaDueAt|pathway) indexes the metrics queries rely on already exist from Phase 2.)

ALTER TYPE "ExportType" ADD VALUE 'GOVERNANCE_CSV';

CREATE TYPE "ReportFrequency" AS ENUM ('WEEKLY', 'MONTHLY');

CREATE TABLE "ReportSchedule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "type" "ExportType" NOT NULL,
    "frequency" "ReportFrequency" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReportSchedule_enabled_nextRunAt_idx" ON "ReportSchedule"("enabled", "nextRunAt");
CREATE INDEX "ReportSchedule_orgId_idx" ON "ReportSchedule"("orgId");

ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Only reports that make sense unattended; the audit trail export stays a deliberate, on-demand act.
ALTER TABLE "ReportSchedule" ADD CONSTRAINT reportschedule_type_allowed CHECK ("type" <> 'AUDIT_CSV');
