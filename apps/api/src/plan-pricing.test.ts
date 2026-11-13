import test from "node:test";
import assert from "node:assert/strict";
import { billingCycleDurationDays, calculatePlanPrice } from "./billing/plan-pricing";

test("cycle prices use the matching configured price", () => {
  const result = calculatePlanPrice({ amountPaise: 10000, prices: { MONTHLY: 10000, YEARLY: 90000 } }, "YEARLY");
  assert.equal(result.basePaise, 90000);
  assert.equal(result.subtotalPaise, 90000);
});

test("plan and stackable coupon discounts are calculated without going below zero", () => {
  const result = calculatePlanPrice({ amountPaise: 10000, discountType: "PERCENT", discountValue: 10 }, "MONTHLY", {
    discountType: "FIXED", discountValue: 9500, maxDiscountPaise: 9500, minimumPurchasePaise: 0, stackable: true,
  }, new Date("2026-11-13T00:00:00Z"));
  assert.equal(result.planDiscountPaise, 1000);
  assert.equal(result.couponDiscountPaise, 9000);
  assert.equal(result.subtotalPaise, 0);
});

test("non-stackable coupon selects the better of plan and coupon discounts", () => {
  const result = calculatePlanPrice({ amountPaise: 10000, discountType: "PERCENT", discountValue: 20 }, "MONTHLY", {
    discountType: "PERCENT", discountValue: 10, stackable: false,
  });
  assert.equal(result.planDiscountPaise, 2000);
  assert.equal(result.couponDiscountPaise, 0);
  assert.equal(result.subtotalPaise, 8000);
});

test("billing cycles resolve to supported subscription durations", () => {
  assert.equal(billingCycleDurationDays("QUARTERLY", 30), 90);
  assert.equal(billingCycleDurationDays("CUSTOM", 47), 47);
});
