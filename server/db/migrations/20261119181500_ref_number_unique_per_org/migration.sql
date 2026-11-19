-- Reference numbers (REF-YYYY-NNNN) are issued per organisation, so two organisations legitimately
-- both own a REF-2026-0001. Uniqueness must therefore be per organisation, not global.
DROP INDEX "ReferralCase_refNumber_key";
CREATE UNIQUE INDEX "ReferralCase_orgId_refNumber_key" ON "ReferralCase"("orgId", "refNumber");
