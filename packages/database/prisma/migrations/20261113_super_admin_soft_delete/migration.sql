-- Preserve account and institution records while allowing admins to retire them.
ALTER TABLE "User"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletionReason" TEXT;

ALTER TABLE "Institution"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletionReason" TEXT;

CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");
CREATE INDEX "Institution_deletedAt_idx" ON "Institution"("deletedAt");

ALTER TABLE "Employer"
  ADD COLUMN "verificationStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "verificationReason" TEXT,
  ADD COLUMN "verificationUpdatedAt" TIMESTAMP(3);

ALTER TABLE "Institution"
  ADD COLUMN "verificationStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "verificationReason" TEXT,
  ADD COLUMN "verificationUpdatedAt" TIMESTAMP(3);

UPDATE "Employer" SET "verificationStatus" = 'APPROVED' WHERE "verified" = TRUE;
UPDATE "Institution" SET "verificationStatus" = 'APPROVED' WHERE "verified" = TRUE;
