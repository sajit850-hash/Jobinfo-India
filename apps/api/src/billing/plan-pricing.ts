export type BillingPlan = {
  amountPaise: number;
  prices?: unknown;
  discountType?: string;
  discountValue?: number;
  discountStartsAt?: Date | null;
  discountEndsAt?: Date | null;
  discountMaxPaise?: number | null;
  setupFeePaise?: number;
};

export type CouponTerms = {
  discountType: string;
  discountValue: number;
  maxDiscountPaise?: number | null;
  minimumPurchasePaise?: number;
  stackable?: boolean;
};

export function billingCyclePrice(plan: BillingPlan, cycle?: string) {
  const key = String(cycle || "MONTHLY").toUpperCase();
  const prices = plan.prices && typeof plan.prices === "object" ? plan.prices as Record<string, unknown> : {};
  const configured = prices[key];
  return Number.isSafeInteger(configured) && Number(configured) >= 0 ? Number(configured) : plan.amountPaise;
}

function planDiscount(plan: BillingPlan, amount: number, now: Date) {
  if (plan.discountStartsAt && plan.discountStartsAt > now || plan.discountEndsAt && plan.discountEndsAt < now) return 0;
  const value = Math.max(0, Number(plan.discountValue) || 0);
  if (plan.discountType === "PERCENT") return Math.min(amount, Math.min(Math.floor(amount * Math.min(100, value) / 100), plan.discountMaxPaise ?? amount));
  if (plan.discountType === "FIXED") return Math.min(amount, plan.discountMaxPaise == null ? value : Math.min(value, plan.discountMaxPaise));
  return 0;
}

export function calculatePlanPrice(plan: BillingPlan, cycle?: string, coupon?: CouponTerms, now = new Date()) {
  const basePaise = billingCyclePrice(plan, cycle) + Math.max(0, plan.setupFeePaise || 0);
  const configuredDiscountPaise = planDiscount(plan, basePaise, now);
  const afterPlanDiscount = basePaise - configuredDiscountPaise;
  let couponDiscountPaise = 0;
  if (coupon && afterPlanDiscount >= (coupon.minimumPurchasePaise || 0)) {
    const couponBase = coupon.stackable ? afterPlanDiscount : basePaise;
    const value = Math.max(0, coupon.discountValue);
    const candidate = coupon.discountType === "PERCENT"
      ? Math.floor(couponBase * Math.min(100, value) / 100)
      : coupon.discountType === "FIXED" ? value : 0;
    couponDiscountPaise = Math.min(afterPlanDiscount, candidate, coupon.maxDiscountPaise ?? afterPlanDiscount);
    if (!coupon.stackable && configuredDiscountPaise >= couponDiscountPaise) couponDiscountPaise = 0;
    else if (!coupon.stackable) return { basePaise, planDiscountPaise: 0, couponDiscountPaise, subtotalPaise: basePaise - couponDiscountPaise };
  }
  return { basePaise, planDiscountPaise: configuredDiscountPaise, couponDiscountPaise, subtotalPaise: afterPlanDiscount - couponDiscountPaise };
}

export function billingCycleDurationDays(cycle: string, customDays: number) {
  switch (cycle.toUpperCase()) {
    case "DAILY": return 1;
    case "WEEKLY": return 7;
    case "MONTHLY": return 30;
    case "QUARTERLY": return 90;
    case "HALF_YEARLY": return 182;
    case "YEARLY": return 365;
    case "LIFETIME": return Math.max(3650, customDays);
    case "ONE_TIME": return Math.max(1, customDays);
    case "CUSTOM": return customDays;
    default: return customDays;
  }
}
