ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "OtpCode_userId_purpose_createdAt_idx"
  ON "OtpCode"("userId", "purpose", "createdAt");
