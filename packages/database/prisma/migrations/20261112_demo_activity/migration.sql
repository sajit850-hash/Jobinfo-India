CREATE TABLE "ApplicationStatusHistory" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "previousStatus" "ApplicationStatus",
    "newStatus" "ApplicationStatus" NOT NULL,
    "note" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApplicationStatusHistory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ApplicationStatusHistory_applicationId_changedAt_idx" ON "ApplicationStatusHistory"("applicationId", "changedAt");
ALTER TABLE "ApplicationStatusHistory" ADD CONSTRAINT "ApplicationStatusHistory_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Interview" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "recruiterId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "mode" TEXT NOT NULL DEFAULT 'VIDEO',
    "location" TEXT,
    "meetingUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Interview_recruiterId_scheduledAt_idx" ON "Interview"("recruiterId", "scheduledAt");
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_recruiterId_fkey" FOREIGN KEY ("recruiterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CandidateProfileView" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "recruiterId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT,
    CONSTRAINT "CandidateProfileView_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CandidateProfileView_candidateId_viewedAt_idx" ON "CandidateProfileView"("candidateId", "viewedAt");
CREATE INDEX "CandidateProfileView_recruiterId_viewedAt_idx" ON "CandidateProfileView"("recruiterId", "viewedAt");
ALTER TABLE "CandidateProfileView" ADD CONSTRAINT "CandidateProfileView_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CandidateProfileView" ADD CONSTRAINT "CandidateProfileView_recruiterId_fkey" FOREIGN KEY ("recruiterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
