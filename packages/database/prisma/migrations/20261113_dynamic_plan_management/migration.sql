-- Extend the existing plan/subscription catalog with versioned terms and dynamic entitlements.
ALTER TABLE "SubscriptionPlan"
  ADD COLUMN "category" TEXT NOT NULL DEFAULT 'SUBSCRIPTION',
  ADD COLUMN "billingCycle" TEXT NOT NULL DEFAULT 'MONTHLY',
  ADD COLUMN "prices" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'INR',
  ADD COLUMN "displayOrder" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "recommended" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "customBadge" TEXT,
  ADD COLUMN "setupFeePaise" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "renewalAmountPaise" INTEGER,
  ADD COLUMN "trialDays" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "gracePeriodDays" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "autoRenewAllowed" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "discountType" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN "discountValue" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "discountLabel" TEXT,
  ADD COLUMN "discountStartsAt" TIMESTAMP(3),
  ADD COLUMN "discountEndsAt" TIMESTAMP(3),
  ADD COLUMN "discountMaxPaise" INTEGER,
  ADD COLUMN "changePolicy" TEXT NOT NULL DEFAULT 'NEW_ONLY',
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "archivedAt" TIMESTAMP(3);

ALTER TABLE "JobPostingPlan"
  ADD COLUMN "category" TEXT NOT NULL DEFAULT 'JOB_POSTING',
  ADD COLUMN "audience" TEXT NOT NULL DEFAULT 'ALL_RECRUITERS',
  ADD COLUMN "billingCycle" TEXT NOT NULL DEFAULT 'ONE_TIME',
  ADD COLUMN "prices" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'INR',
  ADD COLUMN "displayOrder" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "recommended" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "customBadge" TEXT,
  ADD COLUMN "setupFeePaise" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "gracePeriodDays" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "autoRenewAllowed" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "discountType" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN "discountValue" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "discountLabel" TEXT,
  ADD COLUMN "discountStartsAt" TIMESTAMP(3),
  ADD COLUMN "discountEndsAt" TIMESTAMP(3),
  ADD COLUMN "discountMaxPaise" INTEGER,
  ADD COLUMN "changePolicy" TEXT NOT NULL DEFAULT 'NEW_ONLY',
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "archivedAt" TIMESTAMP(3);

UPDATE "SubscriptionPlan" SET "status" = CASE WHEN "active" THEN 'ACTIVE' ELSE 'INACTIVE' END;
UPDATE "JobPostingPlan" SET "status" = CASE WHEN "active" THEN 'ACTIVE' ELSE 'INACTIVE' END;
UPDATE "SubscriptionPlan" SET "prices" = jsonb_build_object("billingCycle", "amountPaise");
UPDATE "JobPostingPlan" SET "prices" = jsonb_build_object("billingCycle", "pricePaise");

ALTER TABLE "Subscription"
  ADD COLUMN "planSnapshot" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "planVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "pendingPlanSnapshot" JSONB,
  ADD COLUMN "pendingPlanVersion" INTEGER,
  ADD COLUMN "billingCycle" TEXT NOT NULL DEFAULT 'MONTHLY',
  ADD COLUMN "discountPaise" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "listPricePaise" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "couponCode" TEXT,
  ADD COLUMN "autoRenew" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "pausedAt" TIMESTAMP(3);

CREATE TABLE "PlanVersion" (
  "id" TEXT NOT NULL,
  "subscriptionPlanId" TEXT,
  "jobPostingPlanId" TEXT,
  "version" INTEGER NOT NULL,
  "config" JSONB NOT NULL,
  "changePolicy" TEXT NOT NULL DEFAULT 'NEW_ONLY',
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlanVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlanVersion_subscriptionPlanId_fkey" FOREIGN KEY ("subscriptionPlanId") REFERENCES "SubscriptionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PlanVersion_jobPostingPlanId_fkey" FOREIGN KEY ("jobPostingPlanId") REFERENCES "JobPostingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PlanVersion_subscriptionPlanId_version_key" ON "PlanVersion"("subscriptionPlanId", "version");
CREATE UNIQUE INDEX "PlanVersion_jobPostingPlanId_version_key" ON "PlanVersion"("jobPostingPlanId", "version");
CREATE INDEX "PlanVersion_createdAt_idx" ON "PlanVersion"("createdAt");

CREATE TABLE "PlanCoupon" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "planCode" TEXT,
  "audience" TEXT,
  "discountType" TEXT NOT NULL,
  "discountValue" INTEGER NOT NULL,
  "maxDiscountPaise" INTEGER,
  "minimumPurchasePaise" INTEGER NOT NULL DEFAULT 0,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "maxUses" INTEGER,
  "perUserLimit" INTEGER NOT NULL DEFAULT 1,
  "firstPurchaseOnly" BOOLEAN NOT NULL DEFAULT FALSE,
  "renewalOnly" BOOLEAN NOT NULL DEFAULT FALSE,
  "stackable" BOOLEAN NOT NULL DEFAULT FALSE,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlanCoupon_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlanCoupon_code_key" ON "PlanCoupon"("code");
CREATE INDEX "PlanCoupon_active_startsAt_endsAt_idx" ON "PlanCoupon"("active", "startsAt", "endsAt");
CREATE INDEX "PlanCoupon_planCode_audience_idx" ON "PlanCoupon"("planCode", "audience");

CREATE TABLE "CouponRedemption" (
  "id" TEXT NOT NULL,
  "couponId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "discountPaise" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RESERVED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CouponRedemption_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CouponRedemption_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "PlanCoupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CouponRedemption_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CouponRedemption_couponId_subscriptionId_key" ON "CouponRedemption"("couponId", "subscriptionId");
CREATE INDEX "CouponRedemption_couponId_userId_idx" ON "CouponRedemption"("couponId", "userId");

CREATE TABLE "SubscriptionUsage" (
  "id" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "featureKey" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3),
  "quantityUsed" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SubscriptionUsage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SubscriptionUsage_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SubscriptionUsage_subscriptionId_featureKey_periodStart_key" ON "SubscriptionUsage"("subscriptionId", "featureKey", "periodStart");
CREATE INDEX "SubscriptionUsage_featureKey_periodStart_idx" ON "SubscriptionUsage"("featureKey", "periodStart");

CREATE TABLE "UsageTransaction" (
  "id" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "featureKey" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsageTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsageTransaction_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UsageTransaction_subscriptionId_featureKey_idempotencyKey_key" ON "UsageTransaction"("subscriptionId", "featureKey", "idempotencyKey");
CREATE INDEX "UsageTransaction_subscriptionId_featureKey_createdAt_idx" ON "UsageTransaction"("subscriptionId", "featureKey", "createdAt");

CREATE TABLE "SubscriptionEvent" (
  "id" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "actorId" TEXT,
  "event" TEXT NOT NULL,
  "previous" JSONB,
  "next" JSONB,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubscriptionEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SubscriptionEvent_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SubscriptionEvent_subscriptionId_createdAt_idx" ON "SubscriptionEvent"("subscriptionId", "createdAt");
CREATE INDEX "SubscriptionEvent_actorId_createdAt_idx" ON "SubscriptionEvent"("actorId", "createdAt");

INSERT INTO "PlanVersion" ("id", "subscriptionPlanId", "version", "config", "changePolicy")
SELECT 'sv_' || md5(p."id" || ':1'), p."id", 1, to_jsonb(p), p."changePolicy" FROM "SubscriptionPlan" p;
INSERT INTO "PlanVersion" ("id", "jobPostingPlanId", "version", "config", "changePolicy")
SELECT 'jv_' || md5(p."id" || ':1'), p."id", 1, to_jsonb(p), p."changePolicy" FROM "JobPostingPlan" p;

UPDATE "Subscription" s SET
  "listPricePaise" = s."amountPaise",
  "planSnapshot" = COALESCE((SELECT jsonb_build_object(
    'code', p."code", 'name', p."name", 'audience', p."audience", 'amountPaise', p."amountPaise",
    'currency', p."currency", 'billingCycle', p."billingCycle", 'durationDays', p."durationDays",
    'features', p."features", 'limits', p."limits", 'version', p."version"
  ) FROM "SubscriptionPlan" p WHERE p."code" = s."planCode"), jsonb_build_object('code', s."planCode", 'audience', s."audience", 'amountPaise', s."amountPaise", 'currency', s."currency", 'durationDays', s."durationDays", 'limits', s."limits", 'version', 1));
