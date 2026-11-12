CREATE TABLE "AdminProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessLevel" TEXT NOT NULL,
    "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    CONSTRAINT "AdminProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminProfile_userId_key" ON "AdminProfile"("userId");
ALTER TABLE "AdminProfile" ADD CONSTRAINT "AdminProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "industry" TEXT,
    "size" TEXT,
    "description" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT NOT NULL DEFAULT 'India',
    "logoKey" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Company_name_key" ON "Company"("name");
ALTER TABLE "Employer" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Employer" ADD CONSTRAINT "Employer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "DemoSeedBatch" (
    "id" TEXT NOT NULL,
    "batchKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DemoSeedBatch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DemoSeedBatch_batchKey_key" ON "DemoSeedBatch"("batchKey");

CREATE TABLE "DemoDataRecord" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "DemoDataRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DemoDataRecord_batchId_recordType_recordId_key" ON "DemoDataRecord"("batchId", "recordType", "recordId");
CREATE INDEX "DemoDataRecord_batchId_recordType_idx" ON "DemoDataRecord"("batchId", "recordType");
CREATE INDEX "DemoDataRecord_userId_idx" ON "DemoDataRecord"("userId");
ALTER TABLE "DemoDataRecord" ADD CONSTRAINT "DemoDataRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "DemoSeedBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
