ALTER TABLE "User" ADD COLUMN "lastActiveAt" TIMESTAMP(3);
ALTER TABLE "Candidate"
  ADD COLUMN "currentDesignation" TEXT,
  ADD COLUMN "currentCompany" TEXT,
  ADD COLUMN "currentIndustry" TEXT,
  ADD COLUMN "currentSalary" INTEGER,
  ADD COLUMN "preferredShift" TEXT;

CREATE INDEX "Candidate_gender_experienceYears_idx" ON "Candidate"("gender", "experienceYears");
CREATE INDEX "Candidate_currentIndustry_currentSalary_idx" ON "Candidate"("currentIndustry", "currentSalary");
CREATE INDEX "User_lastActiveAt_idx" ON "User"("lastActiveAt");

DELETE FROM "CandidateProfileView" v
USING (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "candidateId", "recruiterId" ORDER BY "viewedAt" ASC, "id" ASC) AS row_num
  FROM "CandidateProfileView"
) duplicates
WHERE v."id" = duplicates."id" AND duplicates.row_num > 1;
CREATE UNIQUE INDEX "CandidateProfileView_candidateId_recruiterId_key" ON "CandidateProfileView"("candidateId", "recruiterId");

CREATE TABLE "CandidateRecruiterAction" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "recruiterId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'VIEWED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CandidateRecruiterAction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CandidateRecruiterAction_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CandidateRecruiterAction_recruiterId_fkey" FOREIGN KEY ("recruiterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CandidateRecruiterAction_candidateId_recruiterId_key" ON "CandidateRecruiterAction"("candidateId", "recruiterId");
CREATE INDEX "CandidateRecruiterAction_recruiterId_status_updatedAt_idx" ON "CandidateRecruiterAction"("recruiterId", "status", "updatedAt");

CREATE TABLE "CandidateRecruiterComment" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "recruiterId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CandidateRecruiterComment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CandidateRecruiterComment_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CandidateRecruiterComment_recruiterId_fkey" FOREIGN KEY ("recruiterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CandidateRecruiterComment_candidateId_recruiterId_createdAt_idx" ON "CandidateRecruiterComment"("candidateId", "recruiterId", "createdAt");

CREATE TABLE "CandidateSearchRecommendation" (
  "id" TEXT NOT NULL,
  "recruiterId" TEXT NOT NULL,
  "jdText" TEXT NOT NULL,
  "fileName" TEXT,
  "jdFileKey" TEXT,
  "criteria" JSONB NOT NULL,
  "results" JSONB NOT NULL,
  "aiProvider" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CandidateSearchRecommendation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CandidateSearchRecommendation_recruiterId_fkey" FOREIGN KEY ("recruiterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CandidateSearchRecommendation_recruiterId_createdAt_idx" ON "CandidateSearchRecommendation"("recruiterId", "createdAt");
