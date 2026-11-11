ALTER TABLE "JobPostingTransaction"
  ADD COLUMN IF NOT EXISTS "taxPaise" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "providerPaymentRef" TEXT,
  ADD COLUMN IF NOT EXISTS "refundedPaise" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "PaymentTransaction"
  ADD COLUMN IF NOT EXISTS "taxPaise" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "providerPaymentRef" TEXT,
  ADD COLUMN IF NOT EXISTS "refundedPaise" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Subscription"
  ADD COLUMN IF NOT EXISTS "audience" TEXT NOT NULL DEFAULT 'CORPORATE',
  ADD COLUMN IF NOT EXISTS "durationDays" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "limits" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "SubscriptionPlan"
  ADD COLUMN IF NOT EXISTS "limits" JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS "BillingProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "legalName" TEXT NOT NULL,
  "gstin" TEXT,
  "address" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "postalCode" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BillingProfile_userId_key" ON "BillingProfile"("userId");
DO $$ BEGIN
  ALTER TABLE "BillingProfile" ADD CONSTRAINT "BillingProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "TaxInvoice" (
  "id" TEXT NOT NULL,
  "invoiceNumber" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "paymentId" TEXT,
  "jobPostingPaymentId" TEXT,
  "subtotalPaise" INTEGER NOT NULL,
  "gstRateBps" INTEGER NOT NULL,
  "gstPaise" INTEGER NOT NULL,
  "totalPaise" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "legalName" TEXT NOT NULL,
  "gstin" TEXT,
  "billingAddress" TEXT NOT NULL,
  "placeOfSupply" TEXT NOT NULL,
  "sellerLegalName" TEXT NOT NULL,
  "sellerGstin" TEXT,
  "sellerAddress" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaxInvoice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TaxInvoice_invoiceNumber_key" ON "TaxInvoice"("invoiceNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "TaxInvoice_paymentId_key" ON "TaxInvoice"("paymentId");
CREATE UNIQUE INDEX IF NOT EXISTS "TaxInvoice_jobPostingPaymentId_key" ON "TaxInvoice"("jobPostingPaymentId");
CREATE INDEX IF NOT EXISTS "TaxInvoice_userId_issuedAt_idx" ON "TaxInvoice"("userId", "issuedAt");
