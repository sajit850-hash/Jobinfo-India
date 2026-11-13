ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'CHANGES_REQUESTED';

CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "PlatformSetting_updatedById_idx" ON "PlatformSetting"("updatedById");

ALTER TABLE "PlatformSetting"
    ADD CONSTRAINT "PlatformSetting_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "PlatformSetting" ("key", "value")
VALUES ('job_posting_policy', '{"enabled":true,"freePostingEnabled":true,"requireApproval":true,"allowEditsAfterApproval":false,"allowRenewals":true,"maxActiveFreeJobs":3,"expiryDays":30,"maxOpenings":1000,"requireVerifiedRecruiter":false}'::jsonb)
ON CONFLICT ("key") DO NOTHING;
