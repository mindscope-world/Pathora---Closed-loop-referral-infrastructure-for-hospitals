-- Phase 10: credentials for facility systems (status return + referral pull).
CREATE TABLE "FacilityApiKey" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "signingSecretEnc" BYTEA NOT NULL,
    "scopes" TEXT[],
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "FacilityApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FacilityApiKey_keyId_key" ON "FacilityApiKey"("keyId");
CREATE INDEX "FacilityApiKey_orgId_facilityId_idx" ON "FacilityApiKey"("orgId", "facilityId");

ALTER TABLE "FacilityApiKey" ADD CONSTRAINT "FacilityApiKey_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacilityApiKey" ADD CONSTRAINT "FacilityApiKey_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacilityApiKey" ADD CONSTRAINT "FacilityApiKey_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Only known scopes, and at least one.
ALTER TABLE "FacilityApiKey" ADD CONSTRAINT facilityapikey_scopes_valid
  CHECK (cardinality("scopes") >= 1 AND "scopes" <@ ARRAY['referrals:read', 'referrals:identify', 'status:write']::text[]);
