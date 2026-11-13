import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { prisma, Prisma } from "@jobinfo/database";
import { userOf } from "../auth";
import { notifyUser } from "../notifications/service";

type Audit = (req: any, action: string, entityType: string, entityId?: string, metadata?: any) => Promise<unknown>;
const feature = z.union([
  z.string().trim().min(1).max(200),
  z.object({ key: z.string().trim().regex(/^[a-z][a-z0-9_.-]{1,79}$/i), name: z.string().trim().min(1).max(100), description: z.string().max(500).optional(), type: z.enum(["BOOLEAN", "QUANTITY", "TEXT"]).default("BOOLEAN"), enabled: z.boolean().default(true), limit: z.number().int().min(-1).max(100000000).optional(), unlimited: z.boolean().default(false), period: z.enum(["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY", "BILLING_CYCLE", "LIFETIME", "ONE_TIME"]).default("BILLING_CYCLE"), unit: z.string().max(30).optional(), visible: z.boolean().default(true), roles: z.array(z.enum(["RECRUITER", "INSTITUTION", "CANDIDATE"])).default([]) }),
]);
const commonFields = z.object({
  code: z.string().trim().min(2).max(50).regex(/^[A-Z0-9_]+$/).optional(), name: z.string().trim().min(2).max(100), description: z.string().max(1000).nullable().optional(), audience: z.enum(["FREELANCE", "CORPORATE", "INSTITUTION", "ALL_RECRUITERS"]).default("FREELANCE"), category: z.string().trim().min(2).max(80).default("SUBSCRIPTION"),
  amountPaise: z.number().int().min(0).max(1000000000).optional(), pricePaise: z.number().int().min(0).max(1000000000).optional(), prices: z.record(z.string().regex(/^[A-Z_]+$/), z.number().int().min(0).max(1000000000)).default({}), billingCycle: z.enum(["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY", "LIFETIME", "ONE_TIME", "CUSTOM"]).default("MONTHLY"), durationDays: z.number().int().min(1).max(36500).default(30), currency: z.enum(["INR", "USD", "EUR", "GBP"]).default("INR"),
  features: z.array(feature).max(200).default([]), limits: z.record(z.string().regex(/^[a-z][a-z0-9_.-]{1,79}$/i), z.number().int().min(-1).max(100000000)).default({}), postingCredits: z.number().int().min(0).max(100000).default(1),
  active: z.boolean().optional(), status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]).optional(), visibility: z.enum(["PUBLIC", "PRIVATE", "ADMIN_ONLY"]).default("PUBLIC"), displayOrder: z.number().int().min(-100000).max(100000).default(0), featured: z.boolean().default(false), recommended: z.boolean().default(false), customBadge: z.string().trim().max(40).nullable().optional(),
  setupFeePaise: z.number().int().min(0).max(1000000000).default(0), renewalAmountPaise: z.number().int().min(0).max(1000000000).nullable().optional(), trialDays: z.number().int().min(0).max(365).default(0), gracePeriodDays: z.number().int().min(0).max(365).default(0), autoRenewAllowed: z.boolean().default(false),
  discountType: z.enum(["NONE", "PERCENT", "FIXED"]).default("NONE"), discountValue: z.number().int().min(0).max(1000000000).default(0), discountLabel: z.string().trim().max(100).nullable().optional(), discountStartsAt: z.coerce.date().nullable().optional(), discountEndsAt: z.coerce.date().nullable().optional(), discountMaxPaise: z.number().int().min(0).nullable().optional(), changePolicy: z.enum(["NEW_ONLY", "NEXT_RENEWAL", "IMMEDIATE"]).default("NEW_ONLY"), confirmImmediate: z.boolean().optional(), reason: z.string().trim().min(5).max(500).optional(),
});
const validatePlan = (value: z.infer<typeof commonFields>, ctx: z.RefinementCtx) => {
  if (value.discountType === "PERCENT" && value.discountValue > 100) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["discountValue"], message: "Percentage discount cannot exceed 100%" });
  if (value.discountStartsAt && value.discountEndsAt && value.discountEndsAt <= value.discountStartsAt) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["discountEndsAt"], message: "Discount end must be after its start" });
  const keys = value.features.flatMap(item => typeof item === "string" ? [] : [item.key]);
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["features"], message: "Feature keys must be unique within a plan" });
};
const common = commonFields.superRefine(validatePlan);

const couponSchema = z.object({ code: z.string().trim().min(3).max(40).regex(/^[A-Z0-9_-]+$/), name: z.string().trim().min(2).max(100), description: z.string().max(500).nullable().optional(), planCode: z.string().trim().max(50).nullable().optional(), audience: z.enum(["FREELANCE", "CORPORATE", "INSTITUTION"]).nullable().optional(), discountType: z.enum(["PERCENT", "FIXED"]), discountValue: z.number().int().min(1).max(1000000000), maxDiscountPaise: z.number().int().min(0).nullable().optional(), minimumPurchasePaise: z.number().int().min(0).default(0), startsAt: z.coerce.date().nullable().optional(), endsAt: z.coerce.date().nullable().optional(), maxUses: z.number().int().min(1).nullable().optional(), perUserLimit: z.number().int().min(1).max(10000).default(1), firstPurchaseOnly: z.boolean().default(false), renewalOnly: z.boolean().default(false), stackable: z.boolean().default(false), active: z.boolean().default(true) }).superRefine((value, ctx) => {
  if (value.discountType === "PERCENT" && value.discountValue > 100) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["discountValue"], message: "Percentage coupon cannot exceed 100%" });
  if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endsAt"], message: "Coupon end must be after its start" });
});

function planConfig(plan: any) { return JSON.parse(JSON.stringify(plan)); }
function featureConfig(features: unknown, limits: unknown) { return { features: features ?? [], limits: limits ?? {} }; }
function createAdminPlansRouter(permission: (name: string) => RequestHandler, audit: Audit) {
  const router = Router();
  const manage = permission("MANAGE_PRICING");
  const table = (kind: string) => kind === "posting" ? prisma.jobPostingPlan : prisma.subscriptionPlan;

  router.get("/", manage, async (_req, res) => {
    const [jobPostingPlans, subscriptionPlans, coupons, subscriptionCounts, usageEvents] = await Promise.all([
      prisma.jobPostingPlan.findMany({ orderBy: [{ displayOrder: "asc" }, { pricePaise: "asc" }] }),
      prisma.subscriptionPlan.findMany({ orderBy: [{ displayOrder: "asc" }, { audience: "asc" }, { amountPaise: "asc" }] }),
      prisma.planCoupon.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { _count: { select: { redemptions: true } } } }),
      prisma.subscription.groupBy({ by: ["planCode", "status"], _count: { _all: true } }),
      prisma.subscriptionUsage.aggregate({ _sum: { quantityUsed: true }, _count: { _all: true } }),
    ]);
    res.json({ jobPostingPlans: jobPostingPlans.map(plan => ({ ...plan, amountPaise: plan.pricePaise })), subscriptionPlans, coupons, subscriptionCounts, usage: usageEvents });
  });

  for (const kind of ["posting", "subscription"] as const) {
    const model = table(kind) as any;
    router.post(`/${kind}`, manage, async (req, res) => {
      const parsed = common.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid plan" });
      const input = parsed.data; const amountPaise = input.amountPaise ?? input.pricePaise ?? 0;
      const code = input.code || `${kind.toUpperCase()}_${input.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
      const prices = Object.keys(input.prices).length ? input.prices : { [input.billingCycle]: amountPaise };
      const status = input.status || (input.active === false ? "INACTIVE" : "ACTIVE");
      const base = { code, name: input.name, description: input.description || null, durationDays: input.durationDays, features: input.features as unknown as Prisma.InputJsonValue, active: status === "ACTIVE", audience: input.audience, category: input.category, billingCycle: input.billingCycle, prices: prices as Prisma.InputJsonValue, currency: input.currency, displayOrder: input.displayOrder, visibility: input.visibility, status, recommended: input.recommended, customBadge: input.customBadge || null, setupFeePaise: input.setupFeePaise, gracePeriodDays: input.gracePeriodDays, autoRenewAllowed: input.autoRenewAllowed, discountType: input.discountType, discountValue: input.discountValue, discountLabel: input.discountLabel || null, discountStartsAt: input.discountStartsAt || null, discountEndsAt: input.discountEndsAt || null, discountMaxPaise: input.discountMaxPaise ?? null, changePolicy: input.changePolicy, version: 1 };
      const createData = kind === "posting" ? { ...base, pricePaise: amountPaise, postingCredits: input.postingCredits, featured: input.featured } : { ...base, amountPaise, limits: input.limits as Prisma.InputJsonValue, featured: input.featured, renewalAmountPaise: input.renewalAmountPaise ?? null, trialDays: input.trialDays };
      try {
        const plan = await model.create({ data: createData });
        await prisma.planVersion.create({ data: { ...(kind === "posting" ? { jobPostingPlanId: plan.id } : { subscriptionPlanId: plan.id }), version: 1, config: planConfig(plan), changePolicy: input.changePolicy, createdById: userOf(req).id } });
        await audit(req, `${kind.toUpperCase()}_PLAN_CREATED`, kind === "posting" ? "JobPostingPlan" : "SubscriptionPlan", plan.id, { code, version: 1 });
        return res.status(201).json({ plan: kind === "posting" ? { ...plan, amountPaise: plan.pricePaise } : plan });
      } catch (error) { if ((error as any)?.code === "P2002") return res.status(409).json({ error: "Plan code is already in use" }); throw error; }
    });

    router.get(`/${kind}/:id/versions`, manage, async (req, res) => {
      const id = String(req.params.id);
      const versions = await prisma.planVersion.findMany({ where: kind === "posting" ? { jobPostingPlanId: id } : { subscriptionPlanId: id }, orderBy: { version: "desc" }, take: 100 });
      res.json({ data: versions });
    });

    router.patch(`/${kind}/:id`, manage, async (req, res) => {
      const parsed = commonFields.partial().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid plan changes" });
      const input = parsed.data;
      if (input.discountType === "PERCENT" && (input.discountValue ?? 0) > 100) return res.status(400).json({ error: "Percentage discount cannot exceed 100%" });
      if (input.discountStartsAt && input.discountEndsAt && input.discountEndsAt <= input.discountStartsAt) return res.status(400).json({ error: "Discount end must be after its start" });
      const current = await model.findUnique({ where: { id: String(req.params.id) } });
      if (!current) return res.status(404).json({ error: "Plan not found" });
      if (input.changePolicy === "IMMEDIATE" && (!input.confirmImmediate || !input.reason)) return res.status(400).json({ error: "Immediate changes require confirmation and a reason" });
      const version = current.version + 1;
      const { code: _code, confirmImmediate: _confirm, reason: _reason, amountPaise: _amount, pricePaise: _price, prices: _prices, ...fields } = input as any;
      const amountPaise = input.amountPaise ?? input.pricePaise;
      const cycle = input.billingCycle || current.billingCycle;
      const currentPrices = objectRecord(current.prices);
      const prices = input.prices ?? (amountPaise != null ? { ...currentPrices, [cycle]: amountPaise } : currentPrices);
      const status = input.status || (input.active === undefined ? current.status : input.active ? "ACTIVE" : "INACTIVE");
      const updateData: any = { ...fields, prices: prices as Prisma.InputJsonValue, status, active: status === "ACTIVE", ...(status === "ARCHIVED" ? { archivedAt: new Date() } : { archivedAt: null }), version };
      if (input.description !== undefined) updateData.description = input.description;
      if (input.discountLabel !== undefined) updateData.discountLabel = input.discountLabel;
      if (input.discountStartsAt !== undefined) updateData.discountStartsAt = input.discountStartsAt;
      if (input.discountEndsAt !== undefined) updateData.discountEndsAt = input.discountEndsAt;
      if (input.discountMaxPaise !== undefined) updateData.discountMaxPaise = input.discountMaxPaise;
      if (input.customBadge !== undefined) updateData.customBadge = input.customBadge;
      if (input.renewalAmountPaise !== undefined && kind === "subscription") updateData.renewalAmountPaise = input.renewalAmountPaise;
      if (input.trialDays !== undefined && kind === "subscription") updateData.trialDays = input.trialDays;
      if (amountPaise != null) updateData[kind === "posting" ? "pricePaise" : "amountPaise"] = amountPaise;
      const result = await prisma.$transaction(async tx => {
        const updated: any = kind === "posting"
          ? await tx.jobPostingPlan.update({ where: { id: current.id }, data: updateData })
          : await tx.subscriptionPlan.update({ where: { id: current.id }, data: updateData });
        await tx.planVersion.create({ data: { ...(kind === "posting" ? { jobPostingPlanId: current.id } : { subscriptionPlanId: current.id }), version, config: planConfig(updated), changePolicy: input.changePolicy || current.changePolicy, createdById: userOf(req).id } });
        if (kind === "subscription" && input.changePolicy === "NEXT_RENEWAL") await tx.subscription.updateMany({ where: { planCode: current.code, status: "ACTIVE" }, data: { pendingPlanSnapshot: featureConfig(updated.features, updated.limits), pendingPlanVersion: version } });
        if (kind === "subscription" && input.changePolicy === "IMMEDIATE") {
          const existing = await tx.subscription.findMany({ where: { planCode: current.code, status: "ACTIVE" }, select: { id: true, userId: true } });
          for (const subscriber of existing) {
            const activeSubscription = await tx.subscription.findUniqueOrThrow({ where: { id: subscriber.id }, select: { planSnapshot: true } });
            const oldSnapshot = activeSubscription.planSnapshot && typeof activeSubscription.planSnapshot === "object" && !Array.isArray(activeSubscription.planSnapshot) ? activeSubscription.planSnapshot as Record<string, unknown> : {};
            const effectiveLimits = kind === "subscription" ? updated.limits : oldSnapshot.limits || {};
            const snapshot = { ...oldSnapshot, features: updated.features, limits: effectiveLimits, version };
            await tx.subscription.update({ where: { id: subscriber.id }, data: { planSnapshot: snapshot as Prisma.InputJsonValue, limits: effectiveLimits as Prisma.InputJsonValue, planVersion: version, pendingPlanSnapshot: Prisma.JsonNull, pendingPlanVersion: null } });
            await tx.subscriptionEvent.create({ data: { subscriptionId: subscriber.id, actorId: userOf(req).id, event: "PLAN_TERMS_APPLIED_IMMEDIATELY", previous: { version: current.version }, next: { version }, reason: input.reason } });
            await tx.notification.create({ data: { userId: subscriber.userId, title: "Your subscription features changed", body: `An administrator updated plan entitlements. Reason: ${input.reason}` } });
          }
        }
        return updated;
      });
      await audit(req, `${kind.toUpperCase()}_PLAN_UPDATED`, kind === "posting" ? "JobPostingPlan" : "SubscriptionPlan", current.id, { previous: planConfig(current), next: planConfig(result), changePolicy: input.changePolicy || current.changePolicy, reason: input.reason || null });
      return res.json({ plan: kind === "posting" ? { ...result, amountPaise: result.pricePaise } : result });
    });

    router.post(`/${kind}/:id/duplicate`, manage, async (req, res) => {
      const source = await model.findUnique({ where: { id: String(req.params.id) } });
      if (!source) return res.status(404).json({ error: "Plan not found" });
      const suffix = `COPY_${Date.now().toString(36).toUpperCase()}`;
      const data = { ...source, id: undefined, code: `${source.code.slice(0, 30)}_${suffix}`, name: `${source.name} copy`, active: false, status: "INACTIVE", archivedAt: null, version: 1, createdAt: undefined, updatedAt: undefined, transactions: undefined, versions: undefined };
      const plan = await model.create({ data });
      await prisma.planVersion.create({ data: { ...(kind === "posting" ? { jobPostingPlanId: plan.id } : { subscriptionPlanId: plan.id }), version: 1, config: planConfig(plan), createdById: userOf(req).id } });
      await audit(req, `${kind.toUpperCase()}_PLAN_DUPLICATED`, kind === "posting" ? "JobPostingPlan" : "SubscriptionPlan", plan.id, { sourcePlanId: source.id });
      return res.status(201).json({ plan: kind === "posting" ? { ...plan, amountPaise: plan.pricePaise } : plan });
    });

    router.delete(`/${kind}/:id`, manage, async (req, res) => {
      const current = await model.findUnique({ where: { id: String(req.params.id) } });
      if (!current) return res.status(404).json({ error: "Plan not found" });
      const archived = await model.update({ where: { id: current.id }, data: { active: false, status: "ARCHIVED", archivedAt: new Date() } });
      await audit(req, `${kind.toUpperCase()}_PLAN_ARCHIVED`, kind === "posting" ? "JobPostingPlan" : "SubscriptionPlan", current.id, { code: current.code });
      return res.json({ plan: kind === "posting" ? { ...archived, amountPaise: archived.pricePaise } : archived });
    });
  }

  router.get("/coupons", manage, async (_req, res) => res.json({ data: await prisma.planCoupon.findMany({ orderBy: { createdAt: "desc" }, take: 500, include: { _count: { select: { redemptions: true } } } }) }));
  router.post("/coupons", manage, async (req, res) => {
    const parsed = couponSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid coupon" });
    try { const coupon = await prisma.planCoupon.create({ data: { ...parsed.data, code: parsed.data.code.toUpperCase(), createdById: userOf(req).id } }); await audit(req, "PLAN_COUPON_CREATED", "PlanCoupon", coupon.id, { code: coupon.code }); return res.status(201).json({ coupon }); }
    catch (error) { if ((error as any)?.code === "P2002") return res.status(409).json({ error: "Coupon code is already in use" }); throw error; }
  });
  router.patch("/coupons/:id", manage, async (req, res) => {
    const parsed = couponSchema.partial().safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid coupon changes" });
    const previous = await prisma.planCoupon.findUnique({ where: { id: String(req.params.id) } }); if (!previous) return res.status(404).json({ error: "Coupon not found" });
    const coupon = await prisma.planCoupon.update({ where: { id: previous.id }, data: { ...parsed.data, ...(parsed.data.code ? { code: parsed.data.code.toUpperCase() } : {}) } }); await audit(req, "PLAN_COUPON_UPDATED", "PlanCoupon", coupon.id, { previous: { active: previous.active, discountType: previous.discountType, discountValue: previous.discountValue }, next: parsed.data }); return res.json({ coupon });
  });
  router.delete("/coupons/:id", manage, async (req, res) => { const coupon = await prisma.planCoupon.update({ where: { id: String(req.params.id) }, data: { active: false } }); await audit(req, "PLAN_COUPON_DEACTIVATED", "PlanCoupon", coupon.id, { code: coupon.code }); return res.json({ coupon }); });

  return router;
}
function objectRecord(value: unknown): Record<string, number> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, number> : {}; }

export { createAdminPlansRouter };
