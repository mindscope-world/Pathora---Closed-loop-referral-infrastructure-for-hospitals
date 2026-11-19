-- Phase 4: audit trail & exports.

CREATE TYPE "ExportType" AS ENUM ('CASES_CSV', 'AUDIT_CSV');
ALTER TYPE "ExportStatus" ADD VALUE 'EXPIRED';

-- ExportJob was unused before this phase (nothing wrote to it), so it is rebuilt in place.
DELETE FROM "ExportJob";
ALTER TABLE "ExportJob"
  DROP COLUMN "type",
  ADD COLUMN "type" "ExportType" NOT NULL,
  ADD COLUMN "params" JSONB,
  ADD COLUMN "fileName" TEXT NOT NULL,
  ADD COLUMN "rowCount" INTEGER,
  ADD COLUMN "byteSize" INTEGER,
  ADD COLUMN "sha256" TEXT,
  ADD COLUMN "chainTip" TEXT,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "error" TEXT,
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "expiresAt" TIMESTAMP(3);

CREATE INDEX "ExportJob_status_createdAt_idx" ON "ExportJob"("status", "createdAt");
