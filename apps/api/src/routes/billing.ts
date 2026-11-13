import { Router } from "express";
import { z } from "zod";
import { prisma, Prisma } from "@jobinfo/database";
import { requireAuth, userOf } from "../auth";
import { getPaymentProvider } from "../integrations/registry";
import { config } from "../config";
import { settlePayment, taxFor } from "../billing/settlement";
import { billingCycleDurationDays, billingCyclePrice, calculatePlanPrice } from "../billing/plan-pricing";
import { getPlanUsage } from "../billing/entitlements";

export const billingRouter = Router();
async function getValidCoupon(userId: string, plan: { code: string; audience: string }, rawCode: string, db: any = prisma) {
  const code = rawCode.trim().toUpperCase();
  const coupon = await db.planCoupon.findUnique({ where: { code } });
  if (!coupon || !coupon.active) return { ok: false as const, error: "Coupon code is invalid or inactive." };
  const now = new Date();
  if (coupon.startsAt && coupon.startsAt > now || coupon.endsAt && coupon.endsAt <= now) return { ok: false as const, error: "Coupon is outside its valid date range." };
  if (coupon.planCode && coupon.planCode !== plan.code || coupon.audience && coupon.audience !== plan.audience) return { ok: false as const, error: "Coupon is not valid for this plan." };
  const [totalUses, userUses] = await Promise.all([
    db.couponRedemption.count({ where: { couponId: coupon.id, status: { in: ["RESERVED", "REDEEMED"] } } }),
    db.couponRedemption.count({ where: { couponId: coupon.id, userId, status: { in: ["RESERVED", "REDEEMED"] } } }),
  ]);
  if (coupon.maxUses != null && coupon.maxUses > 0 && totalUses >= coupon.maxUses) return { ok: false as const, error: "Coupon usage limit has been reached." };
  if (userUses >= coupon.perUserLimit) return { ok: false as const, error: "You have already used this coupon the maximum number of times." };
  if (coupon.firstPurchaseOnly && await db.subscription.count({ where: { userId, status: { in: ["ACTIVE", "EXPIRED", "CANCELLED"] } } })) return { ok: false as const, error: "This coupon is for first-time subscribers only." };
  if (coupon.renewalOnly && !await db.subscription.findFirst({ where: { userId, planCode: plan.code, status: { in: ["ACTIVE", "EXPIRED"] } }, select: { id: true } })) return { ok: false as const, error: "This coupon is available for renewals only." };
  return { ok: true as const, coupon: { id: coupon.id, code: coupon.code, discountType: coupon.discountType, discountValue: coupon.discountValue, maxDiscountPaise: coupon.maxDiscountPaise, minimumPurchasePaise: coupon.minimumPurchasePaise, stackable: coupon.stackable } };
}

billingRouter.get("/plans", async (_req, res) => {
  const configured = await prisma.subscriptionPlan.findMany({ where: { active: true, status: "ACTIVE", visibility: "PUBLIC", currency: "INR" }, orderBy: [{ displayOrder: "asc" }, { amountPaise: "asc" }] });
  const now = new Date();
  const data = configured.map(plan => {
    const price = calculatePlanPrice(plan, plan.billingCycle, undefined, now);
    return { ...plan, originalAmountPaise: price.basePaise, planDiscountPaise: price.planDiscountPaise, amountPaise: price.subtotalPaise };
  });
  res.json({ data, currency: "INR", gstRateBps: taxFor(10000).rateBps, tax: "GST is calculated and added at checkout; invoices are issued after provider-verified payment." });
});

billingRouter.get("/usage", requireAuth("RECRUITER", "INSTITUTION"), async (req, res) => res.json(await getPlanUsage(userOf(req).id)));

const profileSchema = z.object({ legalName: z.string().trim().min(2).max(180), gstin: z.string().trim().toUpperCase().regex(/^[0-9A-Z]{15}$/).optional().or(z.literal("")), address: z.string().trim().min(5).max(300), city: z.string().trim().min(2).max(100), state: z.string().trim().min(2).max(100), postalCode: z.string().trim().min(4).max(12) });
billingRouter.get("/profile", requireAuth("RECRUITER", "INSTITUTION"), async (req, res) => res.json({ profile: await prisma.billingProfile.findUnique({ where: { userId: userOf(req).id } }) }));
billingRouter.put("/profile", requireAuth("RECRUITER", "INSTITUTION"), async (req, res) => {
  const p = profileSchema.safeParse(req.body); if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const profile = await prisma.billingProfile.upsert({ where: { userId: userOf(req).id }, create: { userId: userOf(req).id, ...p.data, gstin: p.data.gstin || null }, update: { ...p.data, gstin: p.data.gstin || null } });
  res.json({ profile });
});

billingRouter.post("/free", requireAuth("RECRUITER", "INSTITUTION"), async (req, res) => {
  const p = z.object({ planCode: z.string().min(3), billingCycle: z.string().max(30).optional() }).safeParse(req.body); if (!p.success) return res.status(400).json({ error: "Select a valid free plan" });
  const user = userOf(req); const configured = await prisma.subscriptionPlan.findUnique({ where: { code: p.data.planCode } });
  const audience = user.role === "INSTITUTION" ? "INSTITUTION" : (await prisma.employer.findUnique({ where: { userId: user.id }, select: { recruiterType: true } }))?.recruiterType;
  const plan = configured;
  const cycle = String(p.data.billingCycle || plan?.billingCycle || "MONTHLY").toUpperCase();
  if (!plan || !plan.active || plan.status !== "ACTIVE" || plan.visibility !== "PUBLIC" || billingCyclePrice(plan, cycle) + plan.setupFeePaise !== 0 || plan.audience !== audience) return res.status(404).json({ error: "Free plan is unavailable for this account type" });
  const now = new Date(); await prisma.subscription.updateMany({ where: { userId: user.id, status: "ACTIVE", endsAt: { lte: now } }, data: { status: "EXPIRED" } });
  const existing = await prisma.subscription.findFirst({ where: { userId: user.id, status: "ACTIVE", endsAt: { gt: now } } });
  if (existing) return res.status(409).json({ error: "An active subscription already exists" });
  const durationDays = billingCycleDurationDays(cycle, plan.durationDays);
  const snapshot = { code: plan.code, name: plan.name, audience: plan.audience, amountPaise: 0, currency: plan.currency, billingCycle: cycle, durationDays, features: plan.features, limits: plan.limits, version: plan.version };
  const subscription = await prisma.$transaction(async tx => {
    const created = await tx.subscription.create({ data: { userId: user.id, planCode: plan.code, audience, durationDays, billingCycle: plan.billingCycle, planVersion: plan.version, planSnapshot: snapshot as Prisma.InputJsonValue, limits: plan.limits as Prisma.InputJsonValue, listPricePaise: 0, amountPaise: 0, currency: plan.currency, status: "ACTIVE", startedAt: now, endsAt: new Date(now.getTime() + durationDays * 86400000) } });
    await tx.subscriptionEvent.create({ data: { subscriptionId: created.id, actorId: user.id, event: "FREE_PLAN_ACTIVATED", next: { planCode: plan.code, planVersion: plan.version } } });
    return created;
  });
  res.status(201).json({ subscription });
});

billingRouter.get("/mine", requireAuth("RECRUITER", "INSTITUTION"), async (req, res) => {
  const userId = userOf(req).id; const now = new Date();
  await prisma.subscription.updateMany({ where: { userId, status: "ACTIVE", endsAt: { lte: now } }, data: { status: "EXPIRED" } });
  const [data, invoices] = await Promise.all([prisma.subscription.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 }), prisma.taxInvoice.findMany({ where: { userId }, orderBy: { issuedAt: "desc" }, take: 50 })]);
  res.json({ data, invoices });
});

billingRouter.post("/validate-coupon", requireAuth("RECRUITER", "INSTITUTION"), async (req, res) => {
  const p = z.object({ planCode: z.string().min(2).max(50), billingCycle: z.string().max(30).optional(), couponCode: z.string().trim().min(3).max(40) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Choose a plan and enter a valid coupon code." });
  const user = userOf(req); const plan = await prisma.subscriptionPlan.findUnique({ where: { code: p.data.planCode } });
  const audience = user.role === "INSTITUTION" ? "INSTITUTION" : (await prisma.employer.findUnique({ where: { userId: user.id }, select: { recruiterType: true } }))?.recruiterType;
  if (!plan || !plan.active || plan.status !== "ACTIVE" || plan.visibility !== "PUBLIC" || plan.audience !== audience) return res.status(404).json({ error: "Plan is unavailable for this account." });
  const coupon = await getValidCoupon(user.id, plan, p.data.couponCode);
  if (!coupon.ok) return res.status(400).json({ error: coupon.error });
  const price = calculatePlanPrice(plan, p.data.billingCycle || plan.billingCycle, coupon.coupon);
  const tax = taxFor(price.subtotalPaise);
  return res.json({ valid: true, couponCode: coupon.coupon.code, basePaise: price.basePaise, planDiscountPaise: price.planDiscountPaise, couponDiscountPaise: price.couponDiscountPaise, subtotalPaise: price.subtotalPaise, gstPaise: tax.taxPaise, totalPaise: tax.totalPaise });
});

billingRouter.post("/checkout", requireAuth("RECRUITER", "INSTITUTION"), async (req, res) => {
  const p = z.object({ planCode: z.string().min(2).max(50), billingCycle: z.string().max(30).optional(), couponCode: z.string().trim().max(40).optional(), autoRenew: z.boolean().optional(), returnUrl: z.string().url().optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Select a valid subscription plan." });
  const user = userOf(req); const profile = await prisma.billingProfile.findUnique({ where: { userId: user.id } });
  if (!profile) return res.status(409).json({ error: "Add your billing name and address before checkout." });
  const configuredPlan = await prisma.subscriptionPlan.findUnique({ where: { code: p.data.planCode } });
  if (!configuredPlan || !configuredPlan.active || configuredPlan.status !== "ACTIVE" || configuredPlan.visibility !== "PUBLIC") return res.status(404).json({ error: "Plan is not currently available." });
  const plan = configuredPlan;
  const audience = user.role === "INSTITUTION" ? "INSTITUTION" : (await prisma.employer.findUnique({ where: { userId: user.id }, select: { recruiterType: true } }))?.recruiterType;
  if (!audience || plan.audience !== audience) return res.status(403).json({ error: "This plan is not available for your account type." });
  if (plan.currency !== "INR") return res.status(400).json({ error: "The configured payment gateway currently supports INR subscriptions only." });
  const cycle = String(p.data.billingCycle || plan.billingCycle).toUpperCase();
  const validCoupon = p.data.couponCode ? await getValidCoupon(user.id, plan, p.data.couponCode) : { ok: true as const, coupon: undefined };
  if (!validCoupon.ok) return res.status(400).json({ error: validCoupon.error });
  const price = calculatePlanPrice(plan, cycle, validCoupon.coupon);
  if (price.subtotalPaise === 0) return res.status(400).json({ error: "A zero-cost plan should be activated using the free plan action." });
  if (p.data.autoRenew && !plan.autoRenewAllowed) return res.status(400).json({ error: "Automatic renewal is not allowed for this plan." });
  const amount = taxFor(price.subtotalPaise); const now = new Date(); const durationDays = billingCycleDurationDays(cycle, plan.durationDays);
  await prisma.subscription.updateMany({ where: { userId: user.id, status: "ACTIVE", endsAt: { lte: now } }, data: { status: "EXPIRED" } });
  const planSnapshot = { code: plan.code, name: plan.name, audience: plan.audience, category: plan.category, amountPaise: price.basePaise, currency: plan.currency, billingCycle: cycle, durationDays, features: plan.features, limits: plan.limits, version: plan.version };
  let checkout: { subscription: any; transaction: any }; let checkoutValidationError = "";
  try {
    checkout = await prisma.$transaction(async tx => {
      if (validCoupon.coupon) {
        const rechecked = await getValidCoupon(user.id, plan, p.data.couponCode!, tx);
        if (!rechecked.ok) { checkoutValidationError = rechecked.error; throw new Error(rechecked.error); }
      }
      const subscription = await tx.subscription.create({ data: { userId: user.id, planCode: plan.code, audience, durationDays, billingCycle: cycle, planVersion: plan.version, planSnapshot: planSnapshot as Prisma.InputJsonValue, limits: plan.limits as Prisma.InputJsonValue, amountPaise: amount.totalPaise, listPricePaise: price.basePaise, discountPaise: price.planDiscountPaise + price.couponDiscountPaise, couponCode: validCoupon.coupon?.code || null, autoRenew: Boolean(p.data.autoRenew), currency: plan.currency, status: "PENDING" } });
      if (validCoupon.coupon) await tx.couponRedemption.create({ data: { couponId: validCoupon.coupon.id, userId: user.id, subscriptionId: subscription.id, discountPaise: price.couponDiscountPaise, status: "RESERVED" } });
      const transaction = await tx.paymentTransaction.create({ data: { userId: user.id, subscriptionId: subscription.id, provider: process.env.PAYMENT_PROVIDER || "unconfigured", amountPaise: amount.totalPaise, taxPaise: amount.taxPaise, currency: plan.currency, status: "CREATED" } });
      await tx.subscriptionEvent.create({ data: { subscriptionId: subscription.id, actorId: user.id, event: "CHECKOUT_STARTED", next: { planCode: plan.code, planVersion: plan.version, billingCycle: cycle, listPricePaise: price.basePaise, discountPaise: price.planDiscountPaise + price.couponDiscountPaise, couponCode: validCoupon.coupon?.code || null } } });
      return { subscription, transaction };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if ((error as any)?.code === "P2034") return res.status(409).json({ error: "This checkout conflicted with a simultaneous purchase. Retry checkout." });
    if (checkoutValidationError) return res.status(409).json({ error: checkoutValidationError });
    throw error;
  }
  const { subscription, transaction } = checkout;
  try {
    const provider = getPaymentProvider();
    const session = await provider.createCheckout({ transactionId: transaction.id, amountPaise: amount.totalPaise, currency: plan.currency, description: `Jobinfo India ${plan.name} subscription`, returnUrl: p.data.returnUrl || `${config.webOrigin}/recruiter/billing` });
    await prisma.paymentTransaction.update({ where: { id: transaction.id }, data: { provider: session.provider, providerRef: session.providerReference } });
    res.status(201).json({ subscriptionId: subscription.id, transactionId: transaction.id, checkoutUrl: session.checkoutUrl, mode: session.mode, subtotalPaise: price.subtotalPaise, listPricePaise: price.basePaise, planDiscountPaise: price.planDiscountPaise, couponDiscountPaise: price.couponDiscountPaise, gstPaise: amount.taxPaise, totalPaise: amount.totalPaise, currency: plan.currency });
  } catch (e) { await prisma.$transaction(async tx => { await tx.paymentTransaction.update({ where: { id: transaction.id }, data: { status: "PROVIDER_NOT_CONFIGURED" } }); await tx.subscription.update({ where: { id: subscription.id }, data: { status: "FAILED" } }); await tx.couponRedemption.updateMany({ where: { subscriptionId: subscription.id, status: "RESERVED" }, data: { status: "RELEASED" } }); }); res.status(503).json({ error: e instanceof Error ? e.message : "Payment provider is unavailable." }); }
});

billingRouter.get("/invoices/:id", requireAuth("RECRUITER", "INSTITUTION"), async (req, res) => {
  const invoice = await prisma.taxInvoice.findFirst({ where: { id: String(req.params.id), userId: userOf(req).id } });
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  res.json({ invoice });
});

billingRouter.post("/webhooks/payment", async (req, res) => {
  const rawBody = (req as any).rawBody as Buffer | undefined;
  if (!rawBody?.length) return res.status(400).json({ error: "Raw payment event is required" });
  try {
    const provider = getPaymentProvider();
    const verified = await provider.verifyWebhook({ rawBody, signature: req.get("x-payment-signature") || req.get("x-razorpay-signature") });
    const result = await settlePayment(verified);
    res.json(result);
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Payment event verification failed" }); }
});

if (!config.isProd) {
  billingRouter.post("/dev/confirm/:transactionId", requireAuth("RECRUITER", "INSTITUTION"), async (req, res) => {
    const tx = await prisma.paymentTransaction.findFirst({ where: { id: String(req.params.transactionId), userId: userOf(req).id, status: "CREATED", provider: "mock" } });
    if (!tx) return res.status(404).json({ error: "Test transaction not found." });
    try { await settlePayment({ transactionId: tx.id, providerReference: tx.providerRef || `test_${tx.id}`, status: "PAID" }); res.json({ ok: true, mode: "test", message: "Test payment confirmed. No real money was charged." }); }
    catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : "Could not confirm payment" }); }
  });
}
