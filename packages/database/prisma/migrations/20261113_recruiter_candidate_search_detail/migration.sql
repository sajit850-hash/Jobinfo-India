ALTER TABLE "CandidateProfileView" ADD COLUMN "companyId" TEXT;
CREATE INDEX "CandidateProfileView_companyId_viewedAt_idx" ON "CandidateProfileView"("companyId", "viewedAt");
ALTER TABLE "CandidateProfileView" ADD CONSTRAINT "CandidateProfileView_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Candidate" ADD COLUMN "careerObjective" TEXT;
ALTER TABLE "Education" ADD COLUMN "university" TEXT;
CREATE TABLE "CandidateTraining" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "provider" TEXT,
  "details" TEXT,
  "completionYear" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CandidateTraining_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CandidateTraining_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CandidateTraining_candidateId_completionYear_idx" ON "CandidateTraining"("candidateId", "completionYear");
