CREATE TABLE IF NOT EXISTS "CustomAiIntegration" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "endpointUrl" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "apiKeyCiphertext" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "updatedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomAiIntegration_pkey" PRIMARY KEY ("id")
);
