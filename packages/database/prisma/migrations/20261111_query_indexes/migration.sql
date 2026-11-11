ALTER TABLE "Candidate"
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Candidate" ALTER COLUMN "updatedAt" DROP DEFAULT;

CREATE INDEX IF NOT EXISTS "Candidate_searchable_updatedAt_idx"
  ON "Candidate"("searchable", "updatedAt");

CREATE INDEX IF NOT EXISTS "Application_candidateId_appliedAt_idx"
  ON "Application"("candidateId", "appliedAt");

CREATE INDEX IF NOT EXISTS "Application_jobId_appliedAt_idx"
  ON "Application"("jobId", "appliedAt");

CREATE INDEX IF NOT EXISTS "InstitutionStudent_recruiterVisible_passYear_dept_idx"
  ON "InstitutionStudent"("institutionId", "recruiterVisible", "passingYear", "department");
