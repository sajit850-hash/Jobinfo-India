DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Subscription_userId_fkey' AND conrelid = '"Subscription"'::regclass) THEN
    ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentTransaction_userId_fkey' AND conrelid = '"PaymentTransaction"'::regclass) THEN
    ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentTransaction_subscriptionId_fkey' AND conrelid = '"PaymentTransaction"'::regclass) THEN
    ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_subscriptionId_fkey"
      FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaxInvoice_userId_fkey' AND conrelid = '"TaxInvoice"'::regclass) THEN
    ALTER TABLE "TaxInvoice" ADD CONSTRAINT "TaxInvoice_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaxInvoice_paymentId_fkey' AND conrelid = '"TaxInvoice"'::regclass) THEN
    ALTER TABLE "TaxInvoice" ADD CONSTRAINT "TaxInvoice_paymentId_fkey"
      FOREIGN KEY ("paymentId") REFERENCES "PaymentTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaxInvoice_jobPostingPaymentId_fkey' AND conrelid = '"TaxInvoice"'::regclass) THEN
    ALTER TABLE "TaxInvoice" ADD CONSTRAINT "TaxInvoice_jobPostingPaymentId_fkey"
      FOREIGN KEY ("jobPostingPaymentId") REFERENCES "JobPostingTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "JobPostingTransaction" DROP CONSTRAINT IF EXISTS "JobPostingTransaction_userId_fkey";
ALTER TABLE "JobPostingTransaction" ADD CONSTRAINT "JobPostingTransaction_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
