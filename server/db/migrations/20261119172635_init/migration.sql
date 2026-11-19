-- CreateEnum
CREATE TYPE "OrgType" AS ENUM ('PROGRAMME', 'FACILITY', 'CLINICAL_PARTNER');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('PROGRAMME_MANAGER', 'PROGRAMME_COORDINATOR', 'FACILITY_FOCAL', 'CLINICAL_LEAD', 'DPO');

-- CreateEnum
CREATE TYPE "FacilityType" AS ENUM ('PUBLIC_REFERRAL', 'FAITH_BASED', 'PRIVATE_SPECIALIST', 'COUNTY_DIAGNOSTIC');

-- CreateEnum
CREATE TYPE "InteropMethod" AS ENUM ('PORTAL_CSV', 'API_READY', 'STATUS_RETURN_DESK');

-- CreateEnum
CREATE TYPE "Pathway" AS ENUM ('CANCER_SCREENING', 'NCD_SCREENING', 'MALE_REPRODUCTIVE_HEALTH', 'MATERNAL_CHILD_HEALTH');

-- CreateEnum
CREATE TYPE "RulePackStatus" AS ENUM ('ACTIVE', 'CONFIGURED', 'COMING_SOON');

-- CreateEnum
CREATE TYPE "Stage" AS ENUM ('INTAKE', 'ASSIGNED', 'CONTACTED', 'HANDOFF_SENT', 'ACKNOWLEDGED', 'ATTENDED', 'ESCALATED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MilestoneType" AS ENUM ('REFERRAL_ISSUED', 'FACILITY_ACKNOWLEDGED', 'PATIENT_ATTENDED', 'EVALUATION_COMPLETED', 'OUTCOME_DOCUMENTED');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('SMS', 'WHATSAPP', 'VOICE');

-- CreateEnum
CREATE TYPE "Lang" AS ENUM ('ENGLISH', 'KISWAHILI');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'BLOCKED_OPTOUT', 'HUMAN_ROUTED');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('PENDING', 'RUNNING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OrgType" NOT NULL DEFAULT 'PROGRAMME',
    "retentionDays" INTEGER NOT NULL DEFAULT 365,
    "dpoContact" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "affiliation" TEXT,
    "facilityId" TEXT,
    "accessScope" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Facility" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FacilityType" NOT NULL,
    "city" TEXT NOT NULL,
    "interopMethod" "InteropMethod" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "patientCode" TEXT NOT NULL,
    "nameEnc" BYTEA NOT NULL,
    "phoneEnc" BYTEA,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "lawfulBasis" TEXT NOT NULL,
    "recordedById" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RulePack" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "pathway" "Pathway" NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "RulePackStatus" NOT NULL,
    "ackSlaHours" INTEGER NOT NULL,
    "contactSlaHours" INTEGER NOT NULL,
    "evalTargetDays" INTEGER NOT NULL,
    "clinicalOwnerId" TEXT,
    "redFlagRule" TEXT NOT NULL,
    "closureCriteria" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RulePack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralCase" (
    "id" TEXT NOT NULL,
    "refNumber" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "pathway" "Pathway" NOT NULL,
    "rulePackId" TEXT NOT NULL,
    "sourceProgram" TEXT NOT NULL,
    "coordinatorId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "stage" "Stage" NOT NULL,
    "redFlag" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT NOT NULL DEFAULT '',
    "closureReason" TEXT,
    "outcomeSource" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "ackDueAt" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "isSynthetic" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseMilestone" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" "MilestoneType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefSequence" (
    "orgId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RefSequence_pkey" PRIMARY KEY ("orgId","year")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pathway" "Pathway",
    "channel" "Channel" NOT NULL,
    "language" "Lang" NOT NULL,
    "body" TEXT NOT NULL,
    "reviewedBy" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommsLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "templateId" TEXT,
    "templateName" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL,
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommsLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" BIGSERIAL NOT NULL,
    "orgId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorLabel" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportJob" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'PENDING',
    "fileKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organization" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "pathway" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledAt" TIMESTAMP(3),

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_orgId_role_idx" ON "User"("orgId", "role");

-- CreateIndex
CREATE INDEX "User_facilityId_idx" ON "User"("facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "Facility_orgId_name_key" ON "Facility"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_orgId_patientCode_key" ON "Patient"("orgId", "patientCode");

-- CreateIndex
CREATE INDEX "Consent_patientId_channel_recordedAt_idx" ON "Consent"("patientId", "channel", "recordedAt");

-- CreateIndex
CREATE INDEX "RulePack_orgId_pathway_idx" ON "RulePack"("orgId", "pathway");

-- CreateIndex
CREATE UNIQUE INDEX "RulePack_orgId_key_version_key" ON "RulePack"("orgId", "key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCase_refNumber_key" ON "ReferralCase"("refNumber");

-- CreateIndex
CREATE INDEX "ReferralCase_orgId_stage_idx" ON "ReferralCase"("orgId", "stage");

-- CreateIndex
CREATE INDEX "ReferralCase_orgId_facilityId_idx" ON "ReferralCase"("orgId", "facilityId");

-- CreateIndex
CREATE INDEX "ReferralCase_orgId_coordinatorId_idx" ON "ReferralCase"("orgId", "coordinatorId");

-- CreateIndex
CREATE INDEX "ReferralCase_orgId_ackDueAt_idx" ON "ReferralCase"("orgId", "ackDueAt");

-- CreateIndex
CREATE INDEX "ReferralCase_orgId_pathway_idx" ON "ReferralCase"("orgId", "pathway");

-- CreateIndex
CREATE UNIQUE INDEX "CaseMilestone_caseId_type_key" ON "CaseMilestone"("caseId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_orgId_name_key" ON "MessageTemplate"("orgId", "name");

-- CreateIndex
CREATE INDEX "CommsLog_orgId_sentAt_idx" ON "CommsLog"("orgId", "sentAt");

-- CreateIndex
CREATE INDEX "CommsLog_caseId_idx" ON "CommsLog"("caseId");

-- CreateIndex
CREATE INDEX "CommsLog_providerMessageId_idx" ON "CommsLog"("providerMessageId");

-- CreateIndex
CREATE INDEX "AuditEvent_orgId_id_idx" ON "AuditEvent"("orgId", "id");

-- CreateIndex
CREATE INDEX "AuditEvent_orgId_resourceId_idx" ON "AuditEvent"("orgId", "resourceId");

-- CreateIndex
CREATE INDEX "AuditEvent_orgId_at_idx" ON "AuditEvent"("orgId", "at");

-- CreateIndex
CREATE INDEX "ExportJob_orgId_createdAt_idx" ON "ExportJob"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Facility" ADD CONSTRAINT "Facility_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RulePack" ADD CONSTRAINT "RulePack_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RulePack" ADD CONSTRAINT "RulePack_clinicalOwnerId_fkey" FOREIGN KEY ("clinicalOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCase" ADD CONSTRAINT "ReferralCase_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCase" ADD CONSTRAINT "ReferralCase_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCase" ADD CONSTRAINT "ReferralCase_rulePackId_fkey" FOREIGN KEY ("rulePackId") REFERENCES "RulePack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCase" ADD CONSTRAINT "ReferralCase_coordinatorId_fkey" FOREIGN KEY ("coordinatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCase" ADD CONSTRAINT "ReferralCase_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseMilestone" ADD CONSTRAINT "CaseMilestone_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ReferralCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseMilestone" ADD CONSTRAINT "CaseMilestone_recordedBy_fkey" FOREIGN KEY ("recordedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefSequence" ADD CONSTRAINT "RefSequence_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommsLog" ADD CONSTRAINT "CommsLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommsLog" ADD CONSTRAINT "CommsLog_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ReferralCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommsLog" ADD CONSTRAINT "CommsLog_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
