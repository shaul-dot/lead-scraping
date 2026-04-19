-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "Source" AS ENUM ('FACEBOOK_ADS', 'INSTAGRAM', 'MANUAL_IMPORT');

-- CreateEnum
CREATE TYPE "SourceTier" AS ENUM ('TIER_1_API', 'TIER_2_MANAGED', 'TIER_3_INHOUSE');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('RAW', 'DEDUPING', 'DEDUPED_UNIQUE', 'DEDUPED_DUPLICATE', 'ENRICHING', 'ENRICHED', 'SCORING', 'SCORED_PASS', 'SCORED_FAIL', 'VALIDATING', 'NB_PASSED', 'VALIDATED_VALID', 'VALIDATED_INVALID', 'PERSONALIZING', 'PERSONALIZED', 'REVIEW_PENDING', 'READY_TO_UPLOAD', 'UPLOADED', 'REPLIED', 'BOOKED', 'UNSUBSCRIBED', 'AUTO_REMEDIATING', 'ESCALATED', 'ERROR');

-- CreateEnum
CREATE TYPE "EmailValidationResult" AS ENUM ('VALID', 'INVALID', 'CATCH_ALL', 'UNKNOWN', 'DO_NOT_MAIL_ROLE_BASED', 'DO_NOT_MAIL_OTHER');

-- CreateEnum
CREATE TYPE "ReplyClassification" AS ENUM ('DIRECT_INTEREST', 'INTEREST_OBJECTION', 'NOT_INTERESTED', 'OUT_OF_OFFICE', 'UNSUBSCRIBE', 'AGGRESSIVE', 'NOT_CLASSIFIED');

-- CreateEnum
CREATE TYPE "RemediationStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "DomainHealthStatus" AS ENUM ('HEALTHY', 'DEGRADED', 'BLACKLISTED', 'BURNED');

-- CreateEnum
CREATE TYPE "DomainReputation" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "InboxStatus" AS ENUM ('WARMING', 'STANDBY', 'ACTIVE', 'ROTATED_OUT', 'BURNED');

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "source" "Source" NOT NULL,
    "sourceTier" "SourceTier",
    "status" "LeadStatus" NOT NULL DEFAULT 'RAW',
    "companyName" TEXT NOT NULL,
    "companyNameNormalized" TEXT NOT NULL,
    "firstName" TEXT,
    "fullName" TEXT,
    "title" TEXT,
    "email" TEXT,
    "emailRoot" TEXT,
    "alternateEmails" JSONB,
    "sourceUrl" TEXT NOT NULL,
    "sourceHandle" TEXT,
    "adCreativeId" TEXT,
    "landingPageUrl" TEXT,
    "leadMagnetType" TEXT,
    "leadMagnetDescription" TEXT,
    "websiteUrl" TEXT,
    "linkedinUrl" TEXT,
    "instagramUrl" TEXT,
    "facebookUrl" TEXT,
    "phoneNumber" TEXT,
    "country" TEXT,
    "employeeCount" INTEGER,
    "employeeCountSource" TEXT,
    "icpScore" INTEGER,
    "icpPass" BOOLEAN,
    "icpReasoning" JSONB,
    "icpScoredAt" TIMESTAMP(3),
    "exaContext" JSONB,
    "duplicateOfId" TEXT,
    "neverbounceResult" "EmailValidationResult",
    "bouncebanResult" "EmailValidationResult",
    "bouncebanScore" INTEGER,
    "validatedAt" TIMESTAMP(3),
    "personalization" JSONB,
    "personalizedAt" TIMESTAMP(3),
    "instantlyCampaignId" TEXT,
    "instantlyLeadId" TEXT,
    "uploadedAt" TIMESTAMP(3),
    "emailSent" BOOLEAN NOT NULL DEFAULT false,
    "emailOpened" BOOLEAN NOT NULL DEFAULT false,
    "emailReplied" BOOLEAN NOT NULL DEFAULT false,
    "replyText" TEXT,
    "replyClassification" "ReplyClassification",
    "replyClassifiedAt" TIMESTAMP(3),
    "draftReply" JSONB,
    "meetingBooked" BOOLEAN NOT NULL DEFAULT false,
    "meetingBookedAt" TIMESTAMP(3),
    "isRoleBasedEmail" BOOLEAN NOT NULL DEFAULT false,
    "keywordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "errorLog" JSONB,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Remediation" (
    "id" TEXT NOT NULL,
    "leadId" TEXT,
    "trigger" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "status" "RemediationStatus" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "actor" TEXT NOT NULL,
    "reasoning" TEXT,
    "result" JSONB,
    "escalatedTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Remediation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapeJob" (
    "id" TEXT NOT NULL,
    "source" "Source" NOT NULL,
    "sourceTier" "SourceTier" NOT NULL,
    "keyword" TEXT NOT NULL,
    "country" TEXT,
    "status" TEXT NOT NULL,
    "leadsFound" INTEGER NOT NULL DEFAULT 0,
    "leadsAdded" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "externalJobId" TEXT,
    "externalJobUrl" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "errorLog" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScrapeJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Keyword" (
    "id" TEXT NOT NULL,
    "primary" TEXT NOT NULL,
    "secondary" TEXT,
    "source" "Source" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "totalYield" INTEGER NOT NULL DEFAULT 0,
    "icpPassRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bookingYield" INTEGER NOT NULL DEFAULT 0,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "discoveredBy" TEXT NOT NULL DEFAULT 'manual',
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Keyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" "Source" NOT NULL,
    "instantlyCampaignId" TEXT,
    "dailySendTarget" INTEGER NOT NULL DEFAULT 500,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sequenceTemplate" JSONB,
    "lastHealthCheckAt" TIMESTAMP(3),

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionCredential" (
    "id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "encryptedCookies" BYTEA,
    "encryptedUsername" BYTEA,
    "encryptedPassword" BYTEA,
    "totpSecret" BYTEA,
    "phoneNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastUsedAt" TIMESTAMP(3),
    "lastHealthCheckAt" TIMESTAMP(3),
    "lastReauthAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "SessionCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailValidationCache" (
    "email" TEXT NOT NULL,
    "neverbounce" "EmailValidationResult",
    "bounceban" "EmailValidationResult",
    "bbScore" INTEGER,
    "validatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailValidationCache_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "ApiCache" (
    "key" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiCache_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ExaSearchCache" (
    "queryHash" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "searchType" TEXT NOT NULL,
    "results" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExaSearchCache_pkey" PRIMARY KEY ("queryHash")
);

-- CreateTable
CREATE TABLE "SourceConfig" (
    "source" "Source" NOT NULL,
    "activeTier" "SourceTier" NOT NULL,
    "tier1Config" JSONB,
    "tier2Config" JSONB,
    "tier3Config" JSONB,
    "autoTierSwitch" BOOLEAN NOT NULL DEFAULT true,
    "tierHealth" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "scheduleDailyTarget" INTEGER NOT NULL DEFAULT 100,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceConfig_pkey" PRIMARY KEY ("source")
);

-- CreateTable
CREATE TABLE "PaperclipAction" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "inputContext" JSONB NOT NULL,
    "outputResult" JSONB NOT NULL,
    "humanFeedback" TEXT,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperclipAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyStats" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "leadsScraped" INTEGER NOT NULL DEFAULT 0,
    "leadsEnriched" INTEGER NOT NULL DEFAULT 0,
    "leadsPassedIcp" INTEGER NOT NULL DEFAULT 0,
    "leadsValidated" INTEGER NOT NULL DEFAULT 0,
    "leadsUploaded" INTEGER NOT NULL DEFAULT 0,
    "leadsReplied" INTEGER NOT NULL DEFAULT 0,
    "leadsBooked" INTEGER NOT NULL DEFAULT 0,
    "fbLeads" INTEGER NOT NULL DEFAULT 0,
    "igLeads" INTEGER NOT NULL DEFAULT 0,
    "apifyCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "phantombusterCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "enrichmentCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "validationCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "llmCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "exaCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "remediationsRun" INTEGER NOT NULL DEFAULT 0,
    "escalationsToHuman" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DailyStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "monthlyCapUsd" DOUBLE PRECISION NOT NULL,
    "alertAt80Pct" BOOLEAN NOT NULL DEFAULT true,
    "hardStopAt100" BOOLEAN NOT NULL DEFAULT true,
    "currentUsageUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monthResetAt" TIMESTAMP(3) NOT NULL,
    "autoSwitchTo" TEXT,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "actionTaken" TEXT,
    "context" JSONB NOT NULL,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Domain" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "provider" TEXT,
    "redirectUrl" TEXT,
    "healthStatus" "DomainHealthStatus" NOT NULL DEFAULT 'HEALTHY',
    "dkimOk" BOOLEAN NOT NULL DEFAULT false,
    "spfOk" BOOLEAN NOT NULL DEFAULT false,
    "dmarcOk" BOOLEAN NOT NULL DEFAULT false,
    "reputation" "DomainReputation" NOT NULL DEFAULT 'UNKNOWN',
    "blacklistTempCount" INTEGER NOT NULL DEFAULT 0,
    "blacklistPermCount" INTEGER NOT NULL DEFAULT 0,
    "lastDnsCheck" TIMESTAMP(3),
    "lastBlacklistCheck" TIMESTAMP(3),
    "lastReputationCheck" TIMESTAMP(3),
    "warmupEmailsSent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Domain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inbox" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "persona" TEXT,
    "handler" TEXT,
    "status" "InboxStatus" NOT NULL DEFAULT 'WARMING',
    "campaignId" TEXT,
    "dailyCampaignLimit" INTEGER NOT NULL DEFAULT 20,
    "warmupCap" INTEGER NOT NULL DEFAULT 10,
    "warmupIncrement" INTEGER NOT NULL DEFAULT 2,
    "replyRate" INTEGER NOT NULL DEFAULT 30,
    "warmupEmailsSent" INTEGER NOT NULL DEFAULT 0,
    "connectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suppression" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Lead_email_key" ON "Lead"("email");

-- CreateIndex
CREATE INDEX "Lead_source_status_idx" ON "Lead"("source", "status");

-- CreateIndex
CREATE INDEX "Lead_companyNameNormalized_idx" ON "Lead"("companyNameNormalized");

-- CreateIndex
CREATE INDEX "Lead_emailRoot_idx" ON "Lead"("emailRoot");

-- CreateIndex
CREATE INDEX "Lead_icpScore_idx" ON "Lead"("icpScore");

-- CreateIndex
CREATE INDEX "Remediation_status_trigger_idx" ON "Remediation"("status", "trigger");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_instantlyCampaignId_key" ON "Campaign"("instantlyCampaignId");

-- CreateIndex
CREATE INDEX "ApiCache_expiresAt_idx" ON "ApiCache"("expiresAt");

-- CreateIndex
CREATE INDEX "PaperclipAction_category_performedAt_idx" ON "PaperclipAction"("category", "performedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailyStats_date_key" ON "DailyStats"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_provider_key" ON "Budget"("provider");

-- CreateIndex
CREATE INDEX "Alert_acknowledged_severity_idx" ON "Alert"("acknowledged", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "Domain_domain_key" ON "Domain"("domain");

-- CreateIndex
CREATE INDEX "Domain_healthStatus_idx" ON "Domain"("healthStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Inbox_email_key" ON "Inbox"("email");

-- CreateIndex
CREATE INDEX "Inbox_status_campaignId_idx" ON "Inbox"("status", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_email_key" ON "Suppression"("email");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Remediation" ADD CONSTRAINT "Remediation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inbox" ADD CONSTRAINT "Inbox_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inbox" ADD CONSTRAINT "Inbox_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

