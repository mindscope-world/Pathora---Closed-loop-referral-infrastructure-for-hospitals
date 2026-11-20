-- Phase 5: team invitations.

CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "facilityId" TEXT,
    "invitedById" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Invite_tokenHash_key" ON "Invite"("tokenHash");
CREATE INDEX "Invite_orgId_createdAt_idx" ON "Invite"("orgId", "createdAt");
CREATE INDEX "Invite_orgId_email_idx" ON "Invite"("orgId", "email");

ALTER TABLE "Invite" ADD CONSTRAINT "Invite_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A facility focal must be tied to a facility (mirrors the rule on User).
ALTER TABLE "Invite" ADD CONSTRAINT invite_focal_has_facility CHECK (role <> 'FACILITY_FOCAL' OR "facilityId" IS NOT NULL);

-- At most one PENDING invitation per email per organisation. Re-inviting revokes the earlier one first.
CREATE UNIQUE INDEX invite_one_pending_per_email ON "Invite"("orgId", "email") WHERE "acceptedAt" IS NULL AND "revokedAt" IS NULL;
